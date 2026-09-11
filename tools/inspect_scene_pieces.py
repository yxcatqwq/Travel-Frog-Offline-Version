"""Render each layer of selected picture templates at 1:1 for visual review.

Usage: python inspect_scene_pieces.py 107 108 126 --out ../alignment_review/pieces
"""
from __future__ import annotations

import argparse
import random
from pathlib import Path

from PIL import Image, ImageDraw

import generate_photo_composites as g


def collect(record, index):
    paths = []
    rng = random.Random(0)
    for name in record.get("backImage", []):
        path = g._resolve_background(name, record["type"], index, rng)
        paths.append(("back", name, path))
    for name in record.get("frontImage", []):
        path = g._resolve_front(name, record["type"], index)
        paths.append(("front", name, path))
    return paths


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("ids", nargs="+", type=int)
    parser.add_argument("--out", type=Path, default=g.ROOT / "alignment_review" / "pieces")
    args = parser.parse_args()

    assets = g.load_config()
    records = {r["id"]: r for r in assets["Picture_json"]}
    index = g._index_images()
    args.out.mkdir(parents=True, exist_ok=True)

    for record_id in args.ids:
        record = records[record_id]
        entries = collect(record, index)
        cols = 3
        rows = (len(entries) + cols - 1) // cols
        sheet = Image.new("RGB", (cols * 520, rows * 382), "white")
        draw = ImageDraw.Draw(sheet)
        for i, (kind, name, path) in enumerate(entries):
            cell = Image.new("RGBA", (500, 350), (205, 225, 235, 255))
            label = f"{record_id} {kind} {name}"
            if path is not None:
                layer = Image.open(path).convert("RGBA")
                cell.alpha_composite(layer, (0, 0))
                label += f" | {path.name} {layer.size} bbox={layer.getbbox()}"
            else:
                label += " | MISSING"
            x, y = i % cols * 520, i // cols * 382
            sheet.paste(cell.convert("RGB"), (x, y))
            draw.rectangle([x, y, x + 499, y + 349], outline="red")
            draw.text((x + 4, y + 354), label, fill="black")
        sheet.save(args.out / f"pieces_{record_id}.png")
        print("wrote", args.out / f"pieces_{record_id}.png")


if __name__ == "__main__":
    main()
