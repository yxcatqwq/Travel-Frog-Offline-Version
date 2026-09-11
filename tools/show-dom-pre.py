"""Print the contents of the ``<pre id="out">`` block from a dumped DOM file."""
from pathlib import Path
import re
import sys


def main() -> None:
    path = Path(sys.argv[1])
    text = path.read_text(encoding="utf-8", errors="replace")
    match = re.search(r'<pre id="out">(.*?)</pre>', text, re.S)
    print(match.group(1) if match else text[:2000])


if __name__ == "__main__":
    main()
