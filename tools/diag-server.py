"""Host-side endpoint for the LocalFrog remote diagnostics bridge (acceptance tests).

The client (emulator/real device) posts its authoritative save + status here and
polls for commands. Used by tools/run-device-acceptance.ps1.

    python tools/diag-server.py [--port 8799] [--out offline_build/diag]

Endpoints
---------
POST /report    client -> host: {status, save, selftest, logs}
GET  /command   client <- host: queued commands, cleared after delivery
POST /command   host   -> queue: {"op": "...", "arg": ...}
GET  /status    latest status JSON (for test scripts)
GET  /save      latest save JSON
"""
from pathlib import Path
import argparse
import json
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer


ROOT = Path(__file__).resolve().parents[1]
STATE = {
    "queue": [],
    "reports": 0,
    "last_report": None,
    "last_status": None,
    "lock": threading.Lock(),
}


class Handler(BaseHTTPRequestHandler):
    def log_message(self, *args):  # silence default logging
        pass

    def _send(self, payload, status=200):
        body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        # 游戏页面来自 http://localhost，跨域读取响应需要 CORS 头
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
        self.send_header("Cache-Control", "no-store")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_OPTIONS(self):
        self._send({"ok": True})

    def do_POST(self):
        length = int(self.headers.get("Content-Length", "0"))
        raw = self.rfile.read(length) if length else b"{}"
        try:
            payload = json.loads(raw.decode("utf-8"))
        except ValueError:
            payload = {"raw": raw.decode("utf-8", "replace")}

        if self.path.startswith("/report"):
            with STATE["lock"]:
                STATE["reports"] += 1
                STATE["last_report"] = payload
                STATE["last_status"] = payload.get("status")
            out_dir.mkdir(parents=True, exist_ok=True)
            (out_dir / "report.json").write_text(
                json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")
            save = payload.get("save")
            if save is not None:
                (out_dir / "save.json").write_text(
                    json.dumps(save, ensure_ascii=False, indent=2), encoding="utf-8")
            status = payload.get("status") or {}
            print(
                f"[report #{STATE['reports']}] rev={status.get('revision')} "
                f"clover={status.get('wallet', {}).get('clover')} "
                f"source={status.get('source')} "
                f"selftest={(payload.get('selftest') or {}).get('ok')}",
                flush=True,
            )
            self._send({"ok": True})
            return

        if self.path.startswith("/probe"):
            print(f"[probe] {json.dumps(payload, ensure_ascii=False)[:600]}", flush=True)
            self._send({"ok": True})
            return

        if self.path.startswith("/command"):
            with STATE["lock"]:
                STATE["queue"].append(payload)
            print(f"[command queued] {payload}", flush=True)
            self._send({"ok": True})
            return

        self._send({"error": "unknown endpoint"}, 404)

    def do_GET(self):
        if self.path.startswith("/command"):
            with STATE["lock"]:
                queued = STATE["queue"]
                STATE["queue"] = []
            if queued:
                print(f"[command delivered] {queued}", flush=True)
            self._send(queued)
            return
        if self.path.startswith("/status"):
            self._send(STATE["last_status"] or {})
            return
        if self.path.startswith("/save"):
            report = STATE["last_report"] or {}
            self._send(report.get("save") or {})
            return
        self._send({"error": "unknown endpoint"}, 404)


def main() -> None:
    global out_dir
    parser = argparse.ArgumentParser()
    parser.add_argument("--port", type=int, default=8799)
    parser.add_argument("--out", default=str(ROOT / "offline_build" / "diag"))
    args = parser.parse_args()
    out_dir = Path(args.out)
    out_dir.mkdir(parents=True, exist_ok=True)
    server = ThreadingHTTPServer(("0.0.0.0", args.port), Handler)
    print(f"diag server listening on 0.0.0.0:{args.port} -> {out_dir}", flush=True)
    server.serve_forever()


out_dir = ROOT / "offline_build" / "diag"


if __name__ == "__main__":
    main()
