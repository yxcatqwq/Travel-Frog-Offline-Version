"""Build contact sheets of composed photos for layout review.

python review_layout.py --from-manifest ../generated_photos/manifest.jsonl
"""
from __future__ import annotations

import argparse
import json
import random
from pathlib import Path

from PIL import Image, ImageDraw

import generate_photo_composites as g


def build_sheets(entries, out_dir: Path, cols: int, per_sheet: int, cell=(480, 336)):
    out_dir.mkdir(parents=True, exist_ok=True)
    for start in range(0, len(entries), per_sheet):
        batch = entries[start:start + per_sheet]
        rows = (len(batch) + cols - 1) // cols
        sheet = Image.new("RGB", (cols * (cell[0] + 5), rows * (cell[1] + 22)), "white")
        draw = ImageDraw.Draw(sheet)
        for i, (label, image) in enumerate(batch):
            x, y = i % cols * (cell[0] + 5), i // cols * (cell[1] + 22)
            sheet.paste(image.convert("RGB").resize(cell, Image.Resampling.LANCZOS), (x, y))
            draw.rectangle([x, y, x + cell[0] - 1, y + cell[1] - 1], outline=(150, 150, 150))
            draw.text((x + 3, y + cell[1] + 4), label, fill="black")
        sheet.save(out_dir / "sheet_{:02d}.png".format(start // per_sheet + 1))
    return (len(entries) + per_sheet - 1) // per_sheet


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--ids", type=int, nargs="*")
    parser.add_argument("--category", nargs="*", default=None)
    parser.add_argument("--out", type=Path, default=g.ROOT / "alignment_review" / "review")
    parser.add_argument("--cols", type=int, default=3)
    parser.add_argument("--per-sheet", type=int, default=6)
    parser.add_argument("--variant", choices=("pair", "solo"), default="pair")
    args = parser.parse_args()

    assets = g.load_config()
    records = [r for r in assets["Picture_json"]]
    if args.ids:
        records = [r for r in records if r["id"] in args.ids]
    if args.category:
        records = [r for r in records if r["type"] in args.category]
    index = g._index_images()
    cache: dict = {}

    entries = []
    for record in records:
        plans = [(record.get("frogPose", ""), t, g.FRIEND_SUFFIXES[i], i)
                 for i, t in enumerate(record.get("travelerPose", [])) if t]
        solo = record.get("frogPose_s", "")
        if args.variant == "solo" and solo:
            plans.append(("s:" + solo, "", "", 0))
        plan = plans[-1] if plans else ("", "", "cw", 0)
        try:
            image, _ = g._compose(record, record["type"], index, random.Random(0),
                                  plan[3], plan[0], plan[1], g.FROG_SUFFIX, plan[2] or "cw", cache)
        except ValueError as exc:
            print("skip", record["id"], exc)
            continue
        entries.append(("{} {} {}".format(record["id"], record["type"], record["name"]), image))

    count = build_sheets(entries, args.out, args.cols, args.per_sheet)
    print("wrote {} sheets for {} templates to {}".format(count, len(entries), args.out))


if __name__ == "__main__":
    main()
