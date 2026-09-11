"""List character sprites whose artwork would fall outside the 500x350 frame."""
from __future__ import annotations

from PIL import Image

import generate_photo_composites as g


def main() -> None:
    assets = g.load_config()
    index = g._index_images()
    for record in assets["Picture_json"]:
        plans = [(record.get("frogPose", ""), t, g.FRIEND_SUFFIXES[i], i)
                 for i, t in enumerate(record.get("travelerPose", [])) if t]
        solo = record.get("frogPose_s", "")
        if solo:
            plans.append(("s:" + solo, "", "", 0))
        elif not plans:
            plans.append((record.get("frogPose", ""), "", "", 0))
        for frog, traveler, suffix, position in plans:
            entries = []
            if frog:
                group = g._pose_group(frog[2:] if frog.startswith("s:") else frog, record["type"], index)
                entries.append(("frog", group.get(g.FROG_SUFFIX),
                                record.get("frogPos_s" if frog.startswith("s:") else "frogPos", {})))
            if traveler:
                group = g._pose_group(traveler, record["type"], index)
                positions = record.get("travelerPos", [])
                entries.append(("traveler", group.get(suffix),
                                positions[position] if position < len(positions) else {}))
            for label, path, pos in entries:
                if path is None:
                    print("{} {} {} {} UNRESOLVED".format(record["id"], record["type"], record["name"], label))
                    continue
                image = Image.open(path).convert("RGBA")
                box = image.getbbox()
                x, y = g._layer_position(image, pos)
                if box[3] + y > 351 or box[1] + y < -1 or box[0] + x < -1 or box[2] + x > 501:
                    print("{} {:22s} {:8s} {:22s} {:10s} pos=({:4d},{:4d}) box=({},{},{},{}) out_of_frame".format(
                        record["id"], record["name"], label, path.name, str(image.size), x, y, *box))


if __name__ == "__main__":
    main()
