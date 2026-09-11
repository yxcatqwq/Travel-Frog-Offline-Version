"""Extract a top-level class/object definition from the client's main.min.js.

Usage:
    python tools/extract-class.py <main.min.js> <ClassName> [OutFile]

The client bundles every class as

    var Name=function(e){...}(Base);__reflect(Name.prototype,"Name");

so the class body can be recovered by scanning from ``var Name=`` to the
matching ``__reflect(Name.prototype`` marker.
"""
from pathlib import Path
import sys


def extract(source: str, name: str) -> str:
    marker = f"var {name}="
    start = source.find(marker)
    if start < 0:
        raise SystemExit(f"class not found: {name}")
    reflect = f'__reflect({name}.prototype,"{name}");'
    end = source.find(reflect, start)
    if end < 0:
        raise SystemExit(f"reflect marker not found for: {name}")
    return source[start:end + len(reflect)]


def main() -> None:
    if len(sys.argv) < 3:
        raise SystemExit(__doc__)
    bundle = Path(sys.argv[1]).read_text(encoding="utf-8")
    name = sys.argv[2]
    body = extract(bundle, name)
    if len(sys.argv) > 3:
        out = Path(sys.argv[3])
        out.parent.mkdir(parents=True, exist_ok=True)
        out.write_text(body, encoding="utf-8")
        print(f"{name}: {len(body)} chars -> {out}")
    else:
        print(body)


if __name__ == "__main__":
    main()
