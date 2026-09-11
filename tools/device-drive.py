"""Drive the running game on a device/emulator through the LocalFrog diagnostics bridge.

Usage:
    python tools/device-drive.py status
    python tools/device-drive.py save            # full save JSON (pretty)
    python tools/device-drive.py tap 540 1200    # adb tap
    python tools/device-drive.py guide           # tap around until the furniture guide advances
    python tools/device-drive.py cmd view        # run a diag command over the file channel
    python tools/device-drive.py cmd protocol {"cmd":"item_buy","data":{"shop_id":1}}
    python tools/device-drive.py shot out.png

The command channel writes ``lf_command.json`` next to the status file reported by
the client (adb root is required, which the offline emulator allows).
"""
from pathlib import Path
import argparse
import base64
import json
import subprocess
import sys
import time
import urllib.request


ROOT = Path(__file__).resolve().parents[1]
ADB = ROOT / "tools" / "platform-tools" / "adb.exe"
SERIAL = "emulator-5554"
DIAG = "http://127.0.0.1:8799"
SEQ = int(time.time() * 1000)  # 每次运行从当前毫秒开始，避免与上一轮 seq 冲突被去重


def adb(*args, check=False):
    return subprocess.run([str(ADB), "-s", SERIAL, *args], capture_output=True, text=True, check=check)


def http_json(path, timeout=8):
    try:
        return json.load(urllib.request.urlopen(f"{DIAG}{path}", timeout=timeout))
    except Exception:
        return {}


def status():
    return http_json("/status")


def save():
    return http_json("/save")


def command_path():
    st = status()
    path = ((st.get("diagnostics") or {}).get("statusFile") or {}).get("path")
    if not path:
        return None
    return path.replace("lf_status.json", "lf_command.json")


def send_command(op, arg=None, wait=25):
    global SEQ
    SEQ += 1
    seq = SEQ
    payload = json.dumps({"op": op, "arg": arg, "seq": seq}).encode()
    b64 = base64.b64encode(payload).decode()
    path = command_path()
    deadline = time.time() + wait
    while time.time() < deadline:
        if path:
            adb("shell", f"echo {b64} | base64 -d > {path}; chmod 666 {path}")
        for _ in range(5):
            time.sleep(1)
            st = status()
            if (st.get("diagnostics") or {}).get("lastExecutedSeq", 0) >= seq:
                return st
    return None


def tap(x, y):
    adb("shell", "input", "tap", str(x), str(y))
    time.sleep(1.5)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("action")
    parser.add_argument("args", nargs="*")
    options = parser.parse_args()

    if options.action == "status":
        st = status()
        print(json.dumps({
            "revision": st.get("revision"),
            "source": st.get("source"),
            "wallet": st.get("wallet"),
            "clover": st.get("clover"),
            "furniture": st.get("furniture"),
            "compost": st.get("compost"),
            "guide": {
                "guideFurniture": ((save().get("settings") or {}).get("client") or {}).get("guideFurniture"),
            },
            "lastError": (st.get("diagnostics") or {}).get("lastError"),
            "view": (st.get("diagnostics") or {}).get("viewSample"),
        }, ensure_ascii=False, indent=1))
        return
    if options.action == "save":
        print(json.dumps(save(), ensure_ascii=False, indent=1))
        return
    if options.action == "tap":
        tap(int(options.args[0]), int(options.args[1]))
        st = save()
        print("guideFurniture", ((st.get("settings") or {}).get("client") or {}).get("guideFurniture"))
        return
    if options.action == "cmd":
        op = options.args[0]
        arg = json.loads(options.args[1]) if len(options.args) > 1 else None
        st = send_command(op, arg)
        print(json.dumps((st or {}).get("diagnostics", {}), ensure_ascii=False, indent=1)[:3000])
        return
    if options.action == "guide":
        for point in [(1000, 200), (540, 300), (200, 2000), (900, 2200), (540, 1200)]:
            tap(*point)
            client = (save().get("settings") or {}).get("client") or {}
            value = client.get("guideFurniture")
            print(f"tap {point} -> guideFurniture={value}")
            if value not in (0, None):
                return
        return
    if options.action == "shot":
        name = options.args[0] if options.args else "device-shot.png"
        adb("shell", "screencap", "-p", "/sdcard/lf-drive.png")
        adb("pull", "/sdcard/lf-drive.png", str(ROOT / "offline_build" / name))
        print(f"saved offline_build/{name}")
        return
    raise SystemExit(f"unknown action: {options.action}")


if __name__ == "__main__":
    main()
