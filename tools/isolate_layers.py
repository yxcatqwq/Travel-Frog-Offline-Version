"""Render a template one layer at a time (plus the previous layers) for review.

python isolate_layers.py 206 207 --out ../alignment_review/isolate
"""
from __future__ import annotations

import argparse
import random
from pathlib import Path

from PIL import Image, ImageDraw

import generate_photo_composites as g


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("ids", nargs="+", type=int)
    parser.add_argument("--out", type=Path, default=g.ROOT / "alignment_review" / "isolate")
    args = parser.parse_args()

    assets = g.load_config()
    records = {r["id"]: r for r in assets["Picture_json"]}
    index = g._index_images()
    args.out.mkdir(parents=True, exist_ok=True)

    for record_id in args.ids:
        record = records[record_id]
        canvas = Image.new("RGBA", g.CANVAS, (0, 0, 0, 0))
        steps = []
        rng = random.Random(0)
        for kind, names in (("back", record.get("backImage", [])), ("front", record.get("frontImage", []))):
            for name in names:
                path = (g._resolve_background(name, record["type"], index, rng) if kind == "back"
                        else g._resolve_front(name, record["type"], index))
                layer = Image.open(path).convert("RGBA")
                pos = g._scenery_position(record, path, layer)
                canvas = canvas.copy()
                g._paste(canvas, layer, *pos)
                steps.append(("{} {} {} @{}".format(kind, path.name, layer.size, pos), canvas.copy()))
        cols = 2
        rows = (len(steps) + 1) // 2
        sheet = Image.new("RGB", (cols * 505, rows * 360), "white")
        draw = ImageDraw.Draw(sheet)
        for i, (label, image) in enumerate(steps):
            cell = Image.new("RGBA", g.CANVAS, (170, 190, 205, 255))
            cell.alpha_composite(image)
            x, y = i % cols * 505, i // cols * 360
            sheet.paste(cell.convert("RGB"), (x, y))
            draw.text((x + 3, y + 352), label, fill="black")
        sheet.save(args.out / "isolate_{}.png".format(record_id))
        print("wrote", args.out / "isolate_{}.png".format(record_id))


if __name__ == "__main__":
    main()
