"""Print resolved layer positions for every multi-layer photo template."""
from __future__ import annotations

import argparse
import random

from PIL import Image

import generate_photo_composites as g
import photo_layout


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--only", type=int, nargs="*")
    args = parser.parse_args()

    assets = g.load_config()
    index = g._index_images()
    for record in assets["Picture_json"]:
        if args.only and record["id"] not in args.only:
            continue
        layers = [("back", n) for n in record.get("backImage", [])]
        layers += [("front", n) for n in record.get("frontImage", [])]
        if len(layers) <= 1:
            continue
        print("=== {} {} {}".format(record["id"], record["type"], record["name"]))
        for kind, name in layers:
            rng = random.Random(0)
            path = (g._resolve_background(name, record["type"], index, rng) if kind == "back"
                    else g._resolve_front(name, record["type"], index))
            if path is None:
                print("    {:5s} {:24s} MISSING".format(kind, name))
                continue
            image = Image.open(path).convert("RGBA")
            pos = photo_layout.scenery_position(record["id"], path.stem, image)
            auto = photo_layout.auto_position(image)
            flag = "" if pos == auto else "  <- reviewed"
            print("    {:5s} {:24s} {:26s} {:12s} pos={!s:14s} auto={}{}".format(
                kind, name, path.name, str(image.size), pos, auto, flag))


if __name__ == "__main__":
    main()
