"""Render scenery-only and finished compositions for selected templates.

python preview_scenery_layout.py 107 108 126 --out ../alignment_review/layout
"""
from __future__ import annotations

import argparse
import random
from pathlib import Path

from PIL import Image, ImageDraw

import generate_photo_composites as g


def plans_for(record):
    plans = [(record.get("frogPose", ""), traveler, g.FRIEND_SUFFIXES[i], i)
             for i, traveler in enumerate(record.get("travelerPose", [])) if traveler]
    solo = record.get("frogPose_s", "")
    if solo:
        plans.append(("s:" + solo, "", "", 0))
    elif not plans:
        plans.append((record.get("frogPose", ""), "", "", 0))
    return plans


def render(record, index, image_cache, plan=None):
    frog, traveler, suffix, position = plan if plan else ("", "", "cw", 0)
    image, _ = g._compose(record, record["type"], index, random.Random(0), position,
                          frog, traveler, g.FROG_SUFFIX, suffix or "cw", image_cache)
    return image


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("ids", nargs="+", type=int)
    parser.add_argument("--out", type=Path, default=g.ROOT / "alignment_review" / "layout")
    parser.add_argument("--cols", type=int, default=2)
    parser.add_argument("--characters", action="store_true")
    args = parser.parse_args()

    assets = g.load_config()
    records = {r["id"]: r for r in assets["Picture_json"]}
    index = g._index_images()
    cache: dict = {}
    args.out.mkdir(parents=True, exist_ok=True)

    for record_id in args.ids:
        record = records[record_id]
        sheet = Image.new("RGB", (1020, 700), "white")
        draw = ImageDraw.Draw(sheet)
        plans = plans_for(record)
        scatter = render(record, index, cache)
        full = render(record, index, cache, plans[-1])
        for i, (image, label) in enumerate(((scatter, "scenery"), (full, "characters"))):
            x, y = i % 2 * 510, 0
            cell = Image.new("RGBA", g.CANVAS, (150, 170, 190, 255))
            cell.alpha_composite(image)
            sheet.paste(cell.convert("RGB"), (x, y))
            draw.text((x + 3, y + 352), f"{record_id} {record['name']} {label}", fill="black")
        sheet.save(args.out / f"layout_{record_id}.png")
    print("wrote", len(args.ids), "files to", args.out)


if __name__ == "__main__":
    main()
