"""Report which scenery layers still rely on the automatic placement rule."""
from __future__ import annotations

import collections
import random

from PIL import Image

import generate_photo_composites as g
import photo_layout


def main() -> None:
    assets = g.load_config()
    index = g._index_images()
    auto_used = collections.OrderedDict()
    reviewed = 0
    for record in assets["Picture_json"]:
        if record["type"] not in ("Normal", "Tools", "Goal", "Unique"):
            continue
        for kind, names in (("back", record.get("backImage", [])), ("front", record.get("frontImage", []))):
            for name in names:
                rng = random.Random(0)
                path = (g._resolve_background(name, record["type"], index, rng) if kind == "back"
                        else g._resolve_front(name, record["type"], index))
                if path is None:
                    continue
                image = Image.open(path).convert("RGBA")
                key = path.stem.lower()
                if key in photo_layout.SCENERY_POSITIONS.get(record["id"], {}):
                    reviewed += 1
                    continue
                auto = photo_layout.auto_position(image)
                if image.size == photo_layout.CANVAS:
                    continue
                auto_used.setdefault((record["id"], record["name"], path.name, image.size, auto), []).append(name)
    print("reviewed layers:", reviewed)
    print("layers using auto placement:", sum(len(v) for v in auto_used.values()))
    for (record_id, record_name, file_name, size, auto), names in auto_used.items():
        print("  {:4d} {:24s} {:26s} {:12s} auto={!s:12s} names={}".format(
            record_id, record_name, file_name, str(size), auto, names))


if __name__ == "__main__":
    main()
