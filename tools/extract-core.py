"""Extract a core namespace block (``var core;!function(e){...}(core||(core={}))``)
that defines the requested member, e.g. ``SocketManage`` or ``Model``.

Usage:
    python tools/extract-core.py <main.min.js> <MemberName> [OutFile]
"""
from pathlib import Path
import sys


BLOCK_START = "var core;!function(e){"
BLOCK_END = "}(core||(core={}))"


def extract(source: str, member: str) -> str:
    marker = f"e.{member}="
    position = source.find(marker)
    if position < 0:
        raise SystemExit(f"member not found: {member}")
    start = source.rfind(BLOCK_START, 0, position)
    if start < 0:
        raise SystemExit(f"namespace block start not found for: {member}")
    end = source.find(BLOCK_END, position)
    if end < 0:
        raise SystemExit(f"namespace block end not found for: {member}")
    end += len(BLOCK_END)
    return source[start:end]


def main() -> None:
    if len(sys.argv) < 3:
        raise SystemExit(__doc__)
    bundle = Path(sys.argv[1]).read_text(encoding="utf-8")
    body = extract(bundle, sys.argv[2])
    if len(sys.argv) > 3:
        out = Path(sys.argv[3])
        out.parent.mkdir(parents=True, exist_ok=True)
        out.write_text(body, encoding="utf-8")
        print(f"{sys.argv[2]}: {len(body)} chars -> {out}")
    else:
        print(body)


if __name__ == "__main__":
    main()
