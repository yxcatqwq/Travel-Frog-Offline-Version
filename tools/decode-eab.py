"""Decode the client's ``*.eab`` config bundles into plain JSON files.

Container layout (see ``decodeEAB`` in ``assets/game/js/main.min.js``):

    [8-byte header: 0x89 'E' 'A' 'B' 13 10 26 10]
    [uint32 little-endian: length of the JSON index]
    [JSON index: [{"f": name, "s": size, "t": "json"|"bin", "i": source}, ...]]
    [payload bytes, in index order]

Usage:
    python tools/decode-eab.py <bundle.eab> <output-dir>
"""
from pathlib import Path
import argparse
import json
import struct


HEADER = bytes((0x89, 0x45, 0x41, 0x42, 0x0D, 0x0A, 0x1A, 0x0A))


def decode(payload: bytes) -> dict:
    if not payload.startswith(HEADER):
        raise ValueError("not an EAB container")
    cursor = len(HEADER)
    (index_length,) = struct.unpack_from("<I", payload, cursor)
    cursor += 4
    index = json.loads(payload[cursor:cursor + index_length].decode("utf-8"))
    cursor += index_length
    entries = {}
    for item in index:
        size = item["s"]
        chunk = payload[cursor:cursor + size]
        cursor += size
        kind = item.get("t", "json")
        name = item.get("n") or item.get("f")
        if kind == "json":
            entries[name] = json.loads(chunk.decode("utf-8"))
        else:
            entries[name] = chunk
    return entries


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("bundle")
    parser.add_argument("output")
    args = parser.parse_args()

    entries = decode(Path(args.bundle).read_bytes())
    out_dir = Path(args.output)
    out_dir.mkdir(parents=True, exist_ok=True)
    manifest = []
    for name, value in entries.items():
        if isinstance(value, bytes):
            target = out_dir / f"{name}.bin"
            target.parent.mkdir(parents=True, exist_ok=True)
            target.write_bytes(value)
            manifest.append({"name": name, "type": "bin", "size": len(value)})
        else:
            target = out_dir / f"{name}.json"
            target.parent.mkdir(parents=True, exist_ok=True)
            target.write_text(json.dumps(value, ensure_ascii=False, indent=2), encoding="utf-8")
            manifest.append({
                "name": name,
                "type": "json",
                "entries": len(value) if isinstance(value, list) else None,
                "size": target.stat().st_size,
            })
    (out_dir / "_manifest.json").write_text(
        json.dumps(manifest, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"decoded {len(entries)} entries -> {out_dir}")


if __name__ == "__main__":
    main()
