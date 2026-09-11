"""Print a one-line summary of the device-side LocalFrog state (for quick inspection)."""
import json
import urllib.request


def main() -> None:
    status = json.load(urllib.request.urlopen("http://127.0.0.1:8799/status", timeout=8))
    save = json.load(urllib.request.urlopen("http://127.0.0.1:8799/save", timeout=8))
    diagnostics = status.get("diagnostics", {})
    view = diagnostics.get("viewSample") or {}
    client = (save.get("settings") or {}).get("client") or {}
    print(json.dumps({
        "rev": status.get("revision"),
        "clover": status.get("wallet"),
        "guideFurniture": client.get("guideFurniture"),
        "guideFurnitureView": view.get("guideFurnitureView"),
        "eventsDisposeComplete": view.get("eventsDisposeComplete"),
        "cloverOnField": view.get("cloverOnField"),
        "compostSource": view.get("compostSource"),
        "benchVisible": view.get("benchVisible"),
        "lastError": diagnostics.get("lastError"),
        "lastReload": diagnostics.get("lastReload"),
        "recentRequests": [item.get("cmd") for item in (diagnostics.get("recentRequests") or [])][-5:],
    }, ensure_ascii=False))


if __name__ == "__main__":
    main()
