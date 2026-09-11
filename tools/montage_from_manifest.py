"""Tile generated photos selected from the manifest into one review image.

python montage_from_manifest.py --ids 102 103 104 --out ../alignment_review/_samples.png
"""
from __future__ import annotations

import argparse
import json
from pathlib import Path

from PIL import Image, ImageDraw


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--manifest", type=Path, default=Path("../generated_photos/manifest.jsonl"))
    parser.add_argument("--ids", type=int, nargs="*")
    parser.add_argument("--limit", type=int, default=12)
    parser.add_argument("--cols", type=int, default=3)
    parser.add_argument("--suffix", default=None)
    parser.add_argument("--out", type=Path, required=True)
    args = parser.parse_args()

    root = args.manifest.resolve().parent
    rows = []
    for line in args.manifest.read_text(encoding="utf-8").splitlines():
        row = json.loads(line)
        if args.ids and row["id"] not in args.ids:
            continue
        if args.suffix and row.get("traveler_suffix") != args.suffix:
            continue
        rows.append(row)
    rows = rows[-args.limit:]
    cols = args.cols
    sheet_rows = (len(rows) + cols - 1) // cols
    sheet = Image.new("RGB", (cols * 505, sheet_rows * 360), "white")
    draw = ImageDraw.Draw(sheet)
    for i, row in enumerate(rows):
        image = Image.open(root / row["file"]).convert("RGB")
        x, y = i % cols * 505, i // cols * 360
        sheet.paste(image, (x, y))
        draw.text((x + 3, y + 352), "{} {}".format(row["id"], Path(row["file"]).name), fill="black")
    sheet.save(args.out)
    print("wrote", args.out, len(rows), "photos")


if __name__ == "__main__":
    main()
