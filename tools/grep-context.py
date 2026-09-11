"""Print context windows around literal matches inside a bundled script.

Usage:
    python tools/grep-context.py <file> <literal> [--before N] [--after N] [--limit N]
"""
from pathlib import Path
import argparse


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("file")
    parser.add_argument("literal")
    parser.add_argument("--before", type=int, default=120)
    parser.add_argument("--after", type=int, default=200)
    parser.add_argument("--limit", type=int, default=5)
    args = parser.parse_args()

    source = Path(args.file).read_text(encoding="utf-8", errors="replace")
    offset = 0
    count = 0
    while count < args.limit:
        index = source.find(args.literal, offset)
        if index < 0:
            break
        window = source[max(0, index - args.before):index + args.after]
        print(f"--- {index} ---")
        print(window.replace("\n", " "))
        offset = index + len(args.literal)
        count += 1
    if count == 0:
        print(f"no match: {args.literal}")


if __name__ == "__main__":
    main()
