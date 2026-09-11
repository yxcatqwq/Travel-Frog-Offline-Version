"""Print harness LOGS / STATUS / PAGE_ERRORS lines from the dumped DOM."""
from pathlib import Path
import json
import re
import sys


def main() -> None:
    text = Path(sys.argv[1] if len(sys.argv) > 1 else "offline_build/harness-dom.txt").read_text(
        encoding="utf-8", errors="replace")
    match = re.search(r'<pre id="out">(.*?)</pre>', text, re.S)
    body = match.group(1) if match else text[:2000]
    for line in body.splitlines():
        if not line.startswith(("LOGS", "STATUS", "PAGE_ERRORS")):
            continue
        label, _, payload = line.partition(" ")
        try:
            data = json.loads(payload)
            print(label)
            print(json.dumps(data, ensure_ascii=False, indent=1)[:2500])
        except ValueError:
            print(line[:400])


if __name__ == "__main__":
    main()
