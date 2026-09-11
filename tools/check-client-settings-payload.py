"""Show the guideFurniture value inside the most recent client_set_client payloads."""
from pathlib import Path
import json
import re


def main() -> None:
    report = json.loads(Path("offline_build/diag/report.json").read_text(encoding="utf-8"))
    for entry in (report.get("logs") or [])[-15:]:
        message = str(entry.get("msg"))
        data = entry.get("data")
        payload = json.dumps(data, ensure_ascii=False)
        match = re.search(r'"guideFurniture":\s*(-?\d+)', payload)
        if "client_set_client" in message or match:
            print(f"{entry.get('level')}\t{match.group(1) if match else 'n/a'}\t{message[:60]}")
        else:
            print(f"{entry.get('level')}\t-\t{message[:60]}")


if __name__ == "__main__":
    main()
