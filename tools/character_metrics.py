"""Report resolved character sprites and their foot lines for each template."""
from __future__ import annotations

import argparse
import random

from PIL import Image

import generate_photo_composites as g


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("ids", nargs="*", type=int)
    args = parser.parse_args()

    assets = g.load_config()
    index = g._index_images()
    for record in assets["Picture_json"]:
        if args.ids and record["id"] not in args.ids:
            continue
        plans = [(record.get("frogPose", ""), t, g.FRIEND_SUFFIXES[i], i)
                 for i, t in enumerate(record.get("travelerPose", [])) if t]
        if not plans:
            continue
        print("=== {} {} {}".format(record["id"], record["type"], record["name"]))
        for frog, traveler, suffix, position in plans:
            group = g._pose_group(frog, record["type"], index)
            frog_path = group.get(g.FROG_SUFFIX)
            traveler_group = g._pose_group(traveler, record["type"], index)
            traveler_path = traveler_group.get(suffix)
            frog_pos = record.get("frogPos", {})
            traveler_pos = (record.get("travelerPos") or [{}])[position]
            for label, path, pos in (("frog", frog_path, frog_pos), ("traveler", traveler_path, traveler_pos)):
                if path is None:
                    print("   {:8s} unresolved".format(label))
                    continue
                image = Image.open(path).convert("RGBA")
                x, y = g._layer_position(image, pos)
                box = image.getbbox()
                feet = y + box[3]
                print("   {:8s} {:26s} {:10s} pos=({:4d},{:4d}) feet_y={:3d} centre_x={:d}".format(
                    label, path.name, str(image.size), x, y, feet, x + (box[0] + box[2]) // 2))


if __name__ == "__main__":
    main()
