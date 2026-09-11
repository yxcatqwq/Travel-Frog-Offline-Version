#!/usr/bin/env python3
"""Rebuild travel photos from the game's Picture.json and PNG layers.

Goal/Unique records are enumerated. Normal/Tools records get reproducible
random samples. The output is intentionally kept outside the game resources.
"""

from __future__ import annotations

import argparse
import hashlib
import itertools
import json
import random
import re
import struct
from pathlib import Path
from typing import Any, Dict, Iterable, List, Optional, Sequence, Tuple

from PIL import Image, ImageStat

import photo_layout


ROOT = Path(__file__).resolve().parents[1]
RESOURCE_ROOT = ROOT / "offline_build" / "web_game" / "resource" / "China"
PICTURE_ROOT = RESOURCE_ROOT / "images" / "Picture"
CONFIG_EAB = RESOURCE_ROOT / "eab" / "config.eab"
CANVAS = (500, 350)
ROLE_SUFFIXES = ("bh", "cw", "qw", "yhc")
FROG_SUFFIX = "qw"
# Picture.travelerPose/travelerPos are indexed by species, not free positions.
FRIEND_SUFFIXES = ("bh", "cw", "yhc")

# These templates ship as a single flattened illustration that already contains
# every companion, so they are exported as-is instead of being re-composed.
GROUP_ART_IDS = ({3032, 3086, 3102} | set(range(3048, 3060)) |
                 set(range(3068, 3081)) | set(range(3148, 3180)))

# Templates whose artwork has the companion walking behind the frog. The two
# sprites overlap there, so the frog has to be composited last.
FROG_ON_TOP_IDS = {
    2003,  # guangzhou1
    2007,  # tianjin1
    2018,  # guangzhou2
    2020,  # guilin2
    2023,  # hangzhou3
    2024,  # suzhou2
    2077,  # chengdu5
    2078,  # hainan5
    2119,  # bwg_shanxi1
    2126,  # jilin1
    2148,  # guangzhou4
    105,   # back_n_branch1
    109,   # back_n_field1
    107,   # back_n_bamboo1
    108,   # back_n_bamboo2
}

# Templates dropped during review: the artwork is redundant (the same museum
# photo already ships as another template), so it is reported in
# skipped.jsonl instead of being exported.
REDUNDANT_IDS = {2120}  # bwg_shanxi2


def _strip_prefix(value: str, prefix: str) -> str:
    return value[len(prefix) :] if value.startswith(prefix) else value


def _words(data: bytes, with_length: bool = False) -> List[int]:
    count = (len(data) + 3) // 4 + (1 if with_length else 0)
    values = [0] * count
    for index, value in enumerate(data):
        values[index // 4] |= value << ((index % 4) * 8)
    if with_length:
        values[-1] = len(data)
    return values


def _bytes(values: Sequence[int], with_length: bool = False) -> Optional[bytes]:
    count = len(values) * 4
    if with_length:
        length = values[-1]
        count -= 4
        if length < count - 3 or length > count:
            return None
        count = length
    return bytes((values[index // 4] >> ((index % 4) * 8)) & 0xFF for index in range(count))


def _xxtea_mix(total: int, y: int, z: int, index: int, extra: int, key: Sequence[int]) -> int:
    mask = 0xFFFFFFFF
    first = (((z >> 5) ^ ((y << 2) & mask)) + ((y >> 3) ^ ((z << 4) & mask))) & mask
    second = ((total ^ y) + (key[(3 & index) ^ extra] ^ z)) & mask
    return (first ^ second) & mask


def _xxtea_decrypt(data: bytes, key: bytes) -> bytes:
    mask = 0xFFFFFFFF
    values = _words(data)
    key_values = _words(key)
    if len(values) < 2:
        return data
    last = len(values) - 1
    total = ((6 + 52 // len(values)) * 0x9E3779B9) & mask
    y = values[0]
    while total:
        extra = (total >> 2) & 3
        for index in range(last, 0, -1):
            z = values[index - 1]
            values[index] = (values[index] - _xxtea_mix(total, y, z, index, extra, key_values)) & mask
            y = values[index]
        z = values[last]
        values[0] = (values[0] - _xxtea_mix(total, y, z, 0, extra, key_values)) & mask
        y = values[0]
        total = (total - 0x9E3779B9) & mask
    result = _bytes(values, with_length=True)
    if result is None:
        raise ValueError("Invalid XXTEA payload")
    return result


def load_config() -> Dict[str, Any]:
    """Decode the current EAB format used by the bundled web game."""
    payload = CONFIG_EAB.read_bytes()
    if payload[:8] != bytes((137, 69, 65, 66, 13, 10, 27, 10)):
        raise ValueError(f"Unexpected config.eab header: {payload[:8].hex()}")
    plain = _xxtea_decrypt(payload[8:], b"ejoyassetbundle")
    meta_length = struct.unpack_from("<I", plain, 0)[0]
    metadata = json.loads(plain[4 : 4 + meta_length].decode("utf-8"))
    offset = 4 + meta_length
    assets: Dict[str, Any] = {}
    for asset in metadata:
        raw = plain[offset : offset + asset["s"]]
        if asset["t"] == "json":
            assets[asset["n"]] = json.loads(raw.decode("utf-8"))
        offset += asset["s"]
    return assets


def _index_images() -> Dict[str, Dict[str, Path]]:
    index: Dict[str, Dict[str, Path]] = {}
    for category in ("Goal", "Unique", "Normal", "Tools"):
        paths = {path.stem.lower(): path for path in (PICTURE_ROOT / category).glob("*.png")}
        index[category] = paths
    return index


def _category_order(category: str) -> List[str]:
    return [category] + [name for name in ("Normal", "Tools", "Goal", "Unique") if name != category]


def _group_images(paths: Dict[str, Path], prefix: str) -> Dict[str, Path]:
    """Find role variants for a logical pose prefix."""
    prefix = prefix.lower()
    found: Dict[str, Path] = {}
    for stem, path in paths.items():
        for suffix in ROLE_SUFFIXES:
            if stem == f"{prefix}_{suffix}" or stem == f"{prefix}{suffix}":
                found[suffix] = path
            # Fenglingmu uses pose_bh_h / pose_bh_z.
            if stem.startswith(f"{prefix}_pose_{suffix}_"):
                found[suffix] = path
            if stem == f"{prefix}_pose_{suffix}":
                found[suffix] = path
    return found


GOAL_ALIASES = {
    "shanghai": "SH",
    "beijing": "BJ", "chengdu": "CD", "chongqing": "CQ", "fujian": "FJ",
    "guangzhou": "GZ", "guilin": "GL", "hangzhou": "HZ", "suzhou": "SZ",
    "tianjin": "TJ", "wuhan": "WH", "xian": "XA", "xianggang": "XG",
    "yunnan": "YN", "jiangxi": "JX", "jiangmen": "JM", "jiuquan": "JQ",
    "liaoning": "LN", "lasa": "LS", "luoyang": "LY", "ningxia": "NX",
    "qingdao": "QD", "zhangjiajie": "ZJJ", "anhui": "AH", "guizhou": "GUIZ",
    "hainan": "HN", "haerbin": "HEB",
    "aomen": "g_aomen", "hebei": "g_hebei", "jilin": "g_jilin",
    "qinghai": "g_qinghai", "shanxi": "g_shanxi",
}


def _goal_pose_prefix(logical: str, paths: Dict[str, Path]) -> str:
    base = _strip_prefix(_strip_prefix(logical, "pose_"), "rnd_")
    base = {"shifen": "TWSF", "kengding": "TWKD", "jingan": "TWJA",
            "lanyu": "TWLY", "tiandeng": "TWTD", "zuinandian": "TWZND"}.get(base, base)
    exact = _group_images(paths, base)
    if exact:
        return base
    if base == "gz_alone":
        return "GZ_alone"
    if base == "ld_guqin":
        return "ld_guqin"
    if base.startswith("bwg_"):
        match = re.fullmatch(r"bwg_([a-z]+)(\d*)", base)
        museum = {"jiangxi": "JX", "nanyuewang": "NYW", "shandong": "SD", "shanxi": "SX", "wuwenhua": "WWH"}
        if match:
            city, number = match.groups()
            return "BWG_" + museum.get(city, city.upper()) + number
    if base.startswith("tw_"):
        return {"tw_jingan": "TWJA", "tw_lanyu": "TWLY", "tw_tiandeng": "TWTD", "tw_zuinandian": "TWZND", "tw_shifen": "TWSF", "tw_kending": "TWKD"}.get(base, base)
    match = re.match(r"^(?:g_)?([a-z]+?)(\d+)$", base)
    if match:
        city, number = match.groups()
        return GOAL_ALIASES.get(city, city).upper() + number
    match = re.match(r"^([a-z]+)_(\d+)$", base)
    if match:
        city, number = match.groups()
        return GOAL_ALIASES.get(city, city).upper() + number
    return base


def _pose_group(logical: str, category: str, index: Dict[str, Dict[str, Path]]) -> Dict[str, Path]:
    base = _strip_prefix(logical, "rnd_")
    pose_base = _strip_prefix(base, "pose_")
    # Explicit resource families; never substitute a different species.
    if pose_base == "gz_alone":
        return {"qw": index["Goal"]["gz_alone"]}
    if re.fullmatch(r"(?:wet|dry|fuza)[0-3]", pose_base):
        family = pose_base.rstrip("0123")
        companion = {"wet": "yhc", "dry": "cw", "fuza": "bh"}[family]
        return {"qw": index["Tools"][pose_base], companion: index["Tools"][family + "_" + companion]}
    if pose_base in ("fenglingmu_h", "fenglingmu_z"):
        variant = pose_base[-1]
        return {s: index["Normal"]["fenglingmu_pose_" + s + ("_" + variant if s in ("bh", "cw") else "")] for s in ROLE_SUFFIXES}
    for source in _category_order(category):
        paths = index[source]
        compact = re.sub(r"_(\d+)$", r"\1", pose_base)
        for candidate in (pose_base, compact, "u_" + pose_base):
            group = _group_images(paths, candidate)
            if group:
                return group
        if source == "Goal":
            group = _group_images(paths, _goal_pose_prefix(base, paths))
        else:
            pose_base = _strip_prefix(base, "pose_")
            # The logical data name for these families omits the literal "_pose".
            if pose_base in ("chuisihaitang", "chuisihaitang_mt", "fenglingmu_h", "fenglingmu_z"):
                group = _group_images(paths, pose_base + "_pose")
            else:
                group = _group_images(paths, pose_base)
                # Some files use a role suffix without an underscore, e.g. beach1_2qw.
                if not group:
                    for suffix in ROLE_SUFFIXES:
                        candidates = [p for stem, p in paths.items() if stem.startswith(pose_base.lower()) and stem.endswith(suffix)]
                        if candidates:
                            group[suffix] = sorted(candidates, key=lambda p: len(p.stem))[0]
        if group:
            return group
    return {}


def _resolve_background(name: str, category: str, index: Dict[str, Dict[str, Path]], rng: random.Random) -> Optional[Path]:
    if name.startswith("mumianhua_mid_"):
        name = name.replace("mumianhua_mid_", "mumianhua_xyn_mid")
    logical = _strip_prefix(_strip_prefix(name, "back_"), "rnd_").lower()
    for source in _category_order(category):
        paths = index[source]
        if name.startswith("rnd_"):
            candidates = [p for stem, p in paths.items() if stem.startswith(logical)]
            if candidates:
                return rng.choice(sorted(candidates, key=lambda p: p.name))
        direct = paths.get(logical)
        if direct:
            return direct
        candidates = [p for stem, p in paths.items() if stem.startswith(logical)]
        if candidates:
            return sorted(candidates, key=lambda p: len(p.stem))[0]
    return None


def _resolve_front(name: str, category: str, index: Dict[str, Dict[str, Path]]) -> Optional[Path]:
    if name.startswith("mumianhua_front_"):
        name = name.replace("mumianhua_front_", "mumianhua_xyn_front")
    for source in _category_order(category):
        paths = index[source]
        direct = paths.get(name.lower())
        if direct:
            return direct
        candidates = [p for stem, p in paths.items() if stem.startswith(name.lower())]
        if candidates:
            return sorted(candidates, key=lambda p: len(p.stem))[0]
    return None


def _paste(canvas: Image.Image, layer: Image.Image, x: int, y: int) -> None:
    layer = layer.convert("RGBA")
    canvas.alpha_composite(layer, (x, y))


def _layer_position(layer: Image.Image, pos: Dict[str, int]) -> Tuple[int, int]:
    """Convert centered, Y-up artwork coordinates to a PNG's top-left corner.

    Keep transparent padding: it is part of the sprite's registration frame.
    A 500x350 registered layer at (0, 0) naturally maps to the canvas origin.
    """
    return (round((CANVAS[0] - layer.width) / 2 + pos.get("x", 0)),
            round((CANVAS[1] - layer.height) / 2 - pos.get("y", 0)))


def _scenery_position(record: Dict[str, Any], path: Path, layer: Image.Image) -> Tuple[int, int]:
    """Place one scenery layer inside the 500x350 photo frame.

    Coordinates are reconstructed offline (see photo_layout) because the
    service-side table is not part of the client package.
    """
    return photo_layout.scenery_position(record['id'], path.stem, layer)


def _is_placeholder(image: Image.Image) -> bool:
    stats = ImageStat.Stat(image.convert('RGB'))
    return min(stats.mean) > 245 and max(stats.stddev) < 2


def _compose(record: Dict[str, Any], category: str, index: Dict[str, Dict[str, Path]], rng: random.Random,
             traveler_index: int, frog_logical: str = "", traveler_logical: str = "",
             frog_suffix: str = FROG_SUFFIX, traveler_suffix: str = "cw",
             image_cache: Optional[Dict[Path, Image.Image]] = None) -> Tuple[Image.Image, List[str]]:
    image = Image.new("RGBA", CANVAS, (0, 0, 0, 0))
    used: List[str] = []

    def load(path: Path) -> Image.Image:
        if image_cache is not None and path in image_cache:
            return image_cache[path]
        loaded = Image.open(path).convert("RGBA")
        if image_cache is not None:
            image_cache[path] = loaded
        return loaded

    for name in record.get("backImage", []):
        path = _resolve_background(name, category, index, rng)
        if path:
            layer = load(path)
            if path.stem.lower().startswith('sky') and layer.height < CANVAS[1]:
                layer = layer.resize((layer.width, CANVAS[1]), Image.Resampling.LANCZOS)
            _paste(image, layer, *_scenery_position(record, path, layer)); used.append(path.name)
        else:
            raise ValueError(f"Missing background: {name}")

    def add_pose(logical: str, suffix: str, pos: Dict[str, int]) -> None:
        if not logical:
            return
        group = _pose_group(logical, category, index)
        path = group.get(suffix)
        if path:
            layer = load(path)
            x, y = (0, 0) if layer.size == CANVAS else _layer_position(layer, pos)
            _paste(image, layer, x, y)
            used.append(path.name)
        else:
            raise ValueError(f"Missing character: {logical}/{suffix}")

    # Character layers are above the scenery and below the listed foreground.
    frog_is_s = frog_logical.startswith("s:")
    if frog_suffix != FROG_SUFFIX or (traveler_logical and traveler_suffix != FRIEND_SUFFIXES[traveler_index]):
        raise ValueError("Character identity does not match its configured position")
    if frog_is_s and traveler_logical:
        raise ValueError("Solo frog artwork must not be combined with a companion")
    frog_logical = frog_logical[2:] if frog_is_s else frog_logical
    frog_plan = (frog_logical, frog_suffix, record.get("frogPos_s" if frog_is_s else "frogPos", {}))
    traveler_plan = None
    if traveler_logical:
        positions = record.get("travelerPos", [])
        traveler_plan = (traveler_logical, traveler_suffix,
                         positions[traveler_index] if traveler_index < len(positions) else {})
    if traveler_plan and record["id"] in FROG_ON_TOP_IDS:
        add_pose(*traveler_plan)
        add_pose(*frog_plan)
    else:
        add_pose(*frog_plan)
        if traveler_plan:
            add_pose(*traveler_plan)
    # Foreground must be above the characters.
    for name in record.get("frontImage", []):
        path = _resolve_front(name, category, index)
        if path:
            layer = load(path)
            _paste(image, layer, *_scenery_position(record, path, layer))
            used.append(path.name)
        else:
            raise ValueError(f"Missing foreground: {name}")
    if _is_placeholder(image):
        raise ValueError("blank source placeholder")
    return image, used


def _save(image: Image.Image, path: Path) -> str:
    path.parent.mkdir(parents=True, exist_ok=True)
    image.convert("RGB").save(path, "PNG", optimize=False, compress_level=1)
    return hashlib.sha256(path.read_bytes()).hexdigest()


def generate(output: Path, samples: int, seed: int) -> Dict[str, int]:
    assets = load_config()
    records = assets["Picture_json"]
    index = _index_images()
    rng = random.Random(seed)
    image_cache: Dict[Path, Image.Image] = {}
    counts = {"Goal": 0, "Unique": 0, "Normal": 0, "Tools": 0}
    manifest_path = output / "manifest.jsonl"
    output.mkdir(parents=True, exist_ok=True)
    skipped_path = output / "skipped.jsonl"
    written: List[Path] = []
    with manifest_path.open("w", encoding="utf-8") as manifest, skipped_path.open("w", encoding="utf-8") as skipped_file:
        for category in ("Goal", "Unique", "Normal", "Tools"):
            for record in (item for item in records if item.get("type") == category):
                if record["id"] in REDUNDANT_IDS:
                    skipped_file.write(json.dumps({"category": category, "id": record["id"], "name": record["name"], "reason": "redundant template (dropped on review)"}, ensure_ascii=False) + "\n")
                    continue
                plans = []
                for i, traveler in enumerate(record.get("travelerPose", [])):
                    if traveler:
                        plans.append((record.get("frogPose", ""), traveler, FRIEND_SUFFIXES[i], i))
                solo = record.get("frogPose_s", "")
                if solo:
                    plans.append(("s:" + solo, "", "", 0))
                elif not plans:
                    plans.append((record.get("frogPose", ""), "", "", 0))
                if category in ("Normal", "Tools"):
                    options = plans
                    plans = [options[i % len(options)] for i in range(max(len(options), samples))]
                # A character sprite without its scene background is not a
                # recoverable photograph; some stale config records refer to
                # assets removed from the bundled resource set.
                probe_rng = random.Random(0)
                if not any(_resolve_background(name, category, index, probe_rng) for name in record.get("backImage", [])):
                    skipped_file.write(json.dumps({"category": category, "id": record["id"], "name": record["name"], "reason": "missing background layer"}, ensure_ascii=False) + "\n")
                    continue
                produced = 0
                seen_images: set = set()
                for frog, traveler, traveler_suffix, traveler_index in plans:
                    try:
                        image, used = _compose(record, category, index, rng, traveler_index, frog, traveler, FROG_SUFFIX, traveler_suffix or "cw", image_cache)
                    except ValueError as exc:
                        skipped_file.write(json.dumps({"category": category, "id": record["id"], "name": record["name"], "traveler_suffix": traveler_suffix, "reason": str(exc)}, ensure_ascii=False) + "\n")
                        continue
                    if not used:
                        skipped_file.write(json.dumps({"category": category, "id": record["id"], "name": record["name"], "reason": "no local image layers"}, ensure_ascii=False) + "\n")
                        continue
                    # Normal/Tools are resampled from a small set of poses; do not
                    # export byte-identical photographs twice.
                    digest = hashlib.sha256(image.tobytes()).hexdigest()
                    if digest in seen_images:
                        continue
                    seen_images.add(digest)
                    produced += 1
                    stem = f"{record['id']}_{record['name']}"
                    if category in ("Normal", "Tools"):
                        stem += f"__sample{produced:03d}"
                    else:
                        stem += f"__pos{traveler_index + 1}_{traveler_suffix}" if traveler else "__solo"
                    if frog.startswith("s:"):
                        stem += "_frog_s"
                    path = output / category / f"{stem}.png"
                    digest = _save(image, path)
                    written.append(path)
                    manifest.write(json.dumps({"category": category, "id": record["id"], "name": record["name"], "file": str(path.relative_to(output)), "layers": used, "frog": frog[2:] if frog.startswith("s:") else frog, "frog_suffix": FROG_SUFFIX if frog else "", "frog_variant": "s" if frog.startswith("s:") else "standard", "traveler": traveler, "traveler_index": traveler_index if traveler else None, "traveler_suffix": traveler_suffix, "sha256": digest}, ensure_ascii=False) + "\n")
                    counts[category] += 1
    # A re-run must not leave photographs from an earlier layout behind.
    keep = {path.resolve() for path in written}
    for stale in output.rglob("*.png"):
        if stale.resolve() not in keep:
            stale.unlink()
    return counts


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output", type=Path, default=ROOT / "generated_photos", help="output directory")
    parser.add_argument("--samples", type=int, default=8, help="Normal/Tools samples per record")
    parser.add_argument("--seed", type=int, default=20260910, help="random seed")
    args = parser.parse_args()
    counts = generate(args.output, max(1, args.samples), args.seed)
    print(json.dumps({"output": str(args.output), "counts": counts, "total": sum(counts.values())}, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
