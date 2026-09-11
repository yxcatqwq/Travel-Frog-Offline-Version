"""Print a model's constructor defaults and selected methods from main.min.js.

Usage:
    python tools/model-probe.py <main.min.js> <ModelName> [method ...]
"""
from pathlib import Path
import re
import sys


def extract(source: str, name: str) -> str:
    marker = f"var {name}=function("
    start = source.find(marker)
    if start < 0:
        raise SystemExit(f"class not found: {name}")
    reflect = f'__reflect({name}.prototype,"{name}");'
    end = source.find(reflect, start)
    if end < 0:
        raise SystemExit(f"reflect marker not found for: {name}")
    return source[start:end + len(reflect)]


def main() -> None:
    bundle = Path(sys.argv[1]).read_text(encoding="utf-8")
    name = sys.argv[2]
    methods = sys.argv[3:] or ["isOpen", "checkRedot", "initModel"]
    body = extract(bundle, name)
    for method in methods:
        pattern = re.compile(r"prototype\." + re.escape(method) + r"=function")
        found = False
        for match in pattern.finditer(body):
            start = match.start()
            end = body.find("},t.prototype.", start + 10)
            if end < 0:
                end = min(len(body), start + 1200)
            print(f"===== {name}.{method} =====")
            print(body[start:end + 2])
            found = True
        if not found:
            print(f"===== {name}.{method}: not found =====")
    print("===== constructor =====")
    head = body[:body.find("__extends(t,e)") if "__extends(t,e)" in body else 1500]
    print(head)


if __name__ == "__main__":
    main()
