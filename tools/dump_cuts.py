"""Print the hard-cut borders of scenery layers (used to place them by hand)."""
from __future__ import annotations

import argparse
import random

import numpy as np
from PIL import Image

import generate_photo_composites as g


def cuts(image: Image.Image, level: int = 40) -> dict:
    alpha = np.asarray(image.convert("RGBA").split()[3])
    return {
        "top": round(float((alpha[0, :] > level).mean()), 2),
        "bottom": round(float((alpha[-1, :] > level).mean()), 2),
        "left": round(float((alpha[:, 0] > level).mean()), 2),
        "right": round(float((alpha[:, -1] > level).mean()), 2),
    }


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("names", nargs="+")
    parser.add_argument("--category", default="Normal")
    args = parser.parse_args()
    for name in args.names:
        for category in (args.category, "Tools", "Goal", "Unique"):
            path = g.PICTURE_ROOT / category / (name + ".png")
            if path.exists():
                image = Image.open(path).convert("RGBA")
                info = cuts(image)
                print("{:28s} {:12s} bbox={!s:22s} t={top:<5} b={bottom:<5} l={left:<5} r={right:<5}".format(
                    name, str(image.size), image.getbbox(), **info))
                break
        else:
            print("{:28s} MISSING".format(name))


if __name__ == "__main__":
    main()
