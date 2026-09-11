"""List every ``SocketManage.send("protocol"`` call site in a bundle.

Usage:
    python tools/list-send-sites.py <main.min.js> [--filter TEXT]
"""
from pathlib import Path
import argparse
import re


CALL = re.compile(r'\.send\("([a-z0-9_]+)"')


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("bundle")
    parser.add_argument("--filter", default="")
    args = parser.parse_args()

    source = Path(args.bundle).read_text(encoding="utf-8")
    counts = {}
    for match in CALL.finditer(source):
        name = match.group(1)
        if args.filter and args.filter not in name:
            continue
        counts[name] = counts.get(name, 0) + 1
    for name in sorted(counts):
        print(f"{counts[name]:3d}  {name}")
    print(f"total protocols with send sites: {len(counts)}")


if __name__ == "__main__":
    main()
