"""Assemble the local service bundle and inject it into the offline APK.

Steps
-----
1. Concatenate ``tools/local_service/*.js`` (sorted by name) into one ES5 bundle.
2. Write it to ``offline_build/web_game/js/local_service.js`` and register it in
   ``offline_build/web_game/manifest.json`` so the browser harness can load it.
3. Copy the APK's game assets, add ``assets/game/js/local_service.js`` and append
   it to ``assets/game/manifest.json`` "game" list (loaded after main.min.js).
4. Optionally zipalign + sign to produce an installable APK.

Usage:
    python tools/build-local-service.py [--input APK] [--output APK] [--no-sign]
"""
from pathlib import Path
import argparse
import json
import shutil
import subprocess
import sys
import zipfile
import os
import struct


ROOT = Path(__file__).resolve().parents[1]
SOURCE_DIR = ROOT / "tools" / "local_service"
WEB_DIR = ROOT / "offline_build" / "web_game"
BUILD_DIR = ROOT / "offline_build"
BUILD_TOOLS = ROOT / "tools" / "build-tools-extract" / "android-14"
DEFAULT_INPUT = BUILD_DIR / "travel_frog_local_native.apk"
DEFAULT_UNSIGNED = BUILD_DIR / "travel_frog_local_service_unsigned.apk"
DEFAULT_ALIGNED = BUILD_DIR / "travel_frog_local_service_aligned.apk"
DEFAULT_SIGNED = BUILD_DIR / "travel_frog_local_service.apk"
KEYSTORE = BUILD_DIR / "offline-debug.jks"
LOCAL_KEYSTORE = BUILD_DIR / "local-service-debug.jks"
GAME_ENTRY = "assets/game/js/local_service.js"


def assemble() -> str:
    parts = []
    for path in sorted(SOURCE_DIR.glob("*.js")):
        parts.append(f"/* ---- {path.name} ---- */\n" + path.read_text(encoding="utf-8"))
    bundle = "\n".join(parts)
    if "(function (global) {" not in bundle or "})(typeof window" not in bundle:
        raise SystemExit("bundle is missing its IIFE wrapper (00_header/99_footer)")
    return bundle


def update_manifest(payload: bytes, entry: str) -> bytes:
    manifest = json.loads(payload.decode("utf-8"))
    game = manifest.setdefault("game", [])
    game[:] = [item for item in game if item != entry]
    game.append(entry)
    return json.dumps(manifest, ensure_ascii=False, separators=(",", ":")).encode("utf-8")


def write_web_bundle(bundle: str) -> None:
    js_dir = WEB_DIR / "js"
    js_dir.mkdir(parents=True, exist_ok=True)
    (js_dir / "local_service.js").write_text(bundle, encoding="utf-8")
    manifest_path = WEB_DIR / "manifest.json"
    manifest_path.write_bytes(update_manifest(manifest_path.read_bytes(), "js/local_service.js"))
    print(f"web bundle -> {js_dir / 'local_service.js'} ({len(bundle)} bytes)")


def inject_apk(bundle: str, source: Path, target: Path) -> None:
    if source.resolve() == target.resolve():
        raise SystemExit("input and unsigned output must be different files")
    if target.exists():
        target.unlink()
    with zipfile.ZipFile(source, "r") as src, zipfile.ZipFile(target, "w") as dst:
        for info in src.infolist():
            if info.filename.startswith("META-INF/") or info.filename == GAME_ENTRY:
                continue
            payload = src.read(info)
            if info.filename == "assets/game/manifest.json":
                payload = update_manifest(payload, "js/local_service.js")
            if info.filename == "AndroidManifest.xml":
                payload = restore_application_class(payload)
            cloned = zipfile.ZipInfo(info.filename, info.date_time)
            cloned.compress_type = zipfile.ZIP_STORED if info.filename == "resources.arsc" else zipfile.ZIP_DEFLATED
            cloned.external_attr = info.external_attr
            dst.writestr(cloned, payload)
        entry = zipfile.ZipInfo(GAME_ENTRY)
        entry.compress_type = zipfile.ZIP_DEFLATED
        dst.writestr(entry, bundle.encode("utf-8"))
    print(f"apk bundle -> {target}")


def restore_application_class(payload: bytes) -> bytes:
    """把被离线补丁替换成 android.app.Application 的启动类还原。

    原始包使用 com.ejoy.ejoysdk.EjoySDKApplication 初始化 SDK 静态 Context；
    换成 android.app.Application 后 ejoy SDK 会在启动时 NPE（表现为黑屏/崩溃），
    因此构建阶段固定还原，避免再产出不可启动的包。
    """
    import importlib.util

    module_path = ROOT / "tools" / "patch-application-class.py"
    spec = importlib.util.spec_from_file_location("patch_application_class", module_path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    try:
        return module.patch_manifest(
            payload, "android.app.Application", "com.ejoy.ejoysdk.EjoySDKApplication")
    except RuntimeError as error:
        # 已经是原始启动类，或清单结构与预期不同：保持原样并提示
        print(f"warning: AndroidManifest application class not patched ({error})")
        return payload


def run(command, env=None):
    result = subprocess.run(command, capture_output=True, text=True, env=env)
    if result.returncode != 0:
        raise SystemExit(f"command failed ({command}):\n{result.stdout}\n{result.stderr}")
    return result.stdout


def align_and_sign(unsigned: Path, aligned: Path, signed: Path, keystore: Path,
                   store_pass: str, key_pass: str, alias: str) -> None:
    zipalign = BUILD_TOOLS / "zipalign.exe"
    apksigner = BUILD_TOOLS / "apksigner.bat"
    if aligned.exists():
        aligned.unlink()
    if signed.exists():
        signed.unlink()
    run([str(zipalign), "-f", "-p", "4", str(unsigned), str(aligned)])
    java_home = os.environ.get("JAVA_HOME", "")
    env = dict(os.environ)
    if not java_home:
        java = shutil.which("java")
        if java:
            env["JAVA_HOME"] = str(Path(java).resolve().parents[1])
    run([
        str(apksigner), "sign",
        "--ks", str(keystore),
        "--ks-pass", f"pass:{store_pass}",
        "--key-pass", f"pass:{key_pass}",
        "--ks-key-alias", alias,
        "--out", str(signed), str(aligned)
    ], env=env)
    print(f"signed apk -> {signed}")


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--input", default=str(DEFAULT_INPUT))
    parser.add_argument("--unsigned", default=str(DEFAULT_UNSIGNED))
    parser.add_argument("--aligned", default=str(DEFAULT_ALIGNED))
    parser.add_argument("--output", default=str(DEFAULT_SIGNED))
    parser.add_argument("--no-sign", action="store_true")
    parser.add_argument("--web-only", action="store_true")
    parser.add_argument("--keystore", default=str(LOCAL_KEYSTORE))
    parser.add_argument("--store-pass", default="android")
    parser.add_argument("--key-pass", default="android")
    parser.add_argument("--alias", default="androiddebugkey")
    parser.add_argument(
        "--diag-endpoint",
        default="",
        help="启用远程诊断桥（验收构建用），例如 http://10.0.2.2:8799",
    )
    parser.add_argument(
        "--diag-file",
        action="store_true",
        help="启用设备文件状态快照（验收构建用，写入 core.PlatformFile 目录）",
    )
    args = parser.parse_args()

    bundle = assemble()
    prefix = []
    if args.diag_endpoint or args.diag_file:
        preset = ["verboseLog: true"]
        if args.diag_file:
            preset.append("diagFile: true")
        if args.diag_endpoint:
            preset.append(f'diagEndpoint: "{args.diag_endpoint}"')
        prefix.append(
            "\n/* 验收构建：预置开关（脚本本体加载前生效） */\n"
            "(function () {\n"
            "    window.LocalFrog = window.LocalFrog || {};\n"
            "    var preset = window.LocalFrog.flags || {};\n"
            f"    var values = {{{', '.join(preset)}}};\n"
            "    for (var key in values) { if (Object.prototype.hasOwnProperty.call(values, key)) { preset[key] = values[key]; } }\n"
            "    window.LocalFrog.flags = preset;\n"
            "})();\n"
        )
    if args.diag_endpoint:
        endpoint = args.diag_endpoint
        # 前置探针：脚本是否加载、是否有未捕获异常，都会立刻上报（验收构建专用）。
        probe = f"""
/* 验收构建探针：脚本加载与错误上报 */
(function () {{
    var endpoint = "{endpoint}";
    function send(path, body) {{
        try {{
            var request = new XMLHttpRequest();
            request.open("POST", endpoint + path, true);
            request.setRequestHeader("Content-Type", "application/json");
            request.send(JSON.stringify(body));
        }} catch (error) {{}}
    }}
    window.__lfProbe = send;
    send("/probe", {{stage: "script-load", href: String(location.href), ua: String(navigator.userAgent)}});
    window.addEventListener("error", function (event) {{
        send("/probe", {{stage: "window-error", message: String(event.message), source: String(event.filename), line: event.lineno}});
    }});
    window.addEventListener("unhandledrejection", function (event) {{
        send("/probe", {{stage: "unhandled-rejection", reason: String(event.reason && event.reason.message ? event.reason.message : event.reason)}});
    }});
    var originalError = console.error;
    console.error = function () {{
        send("/probe", {{stage: "console-error", message: Array.prototype.slice.call(arguments).map(String).join(" ")}});
        if (originalError) {{ originalError.apply(console, arguments); }}
    }};
    var originalLog = console.log;
    console.log = function () {{
        var text = Array.prototype.slice.call(arguments).map(String).join(" ");
        if (text.indexOf("[LF]") === 0 || text.indexOf("LocalFrog") >= 0) {{
            send("/probe", {{stage: "log", message: text.slice(0, 2000)}});
        }}
        if (originalLog) {{ originalLog.apply(console, arguments); }}
    }};
    window.__lfFlag = true;
}})();
"""
        prefix.append(probe)
    if prefix:
        bundle = "".join(prefix) + bundle
    if args.diag_endpoint:
        endpoint = args.diag_endpoint
        bundle += (
            "\n/* 验收构建：启用远程诊断桥 */\n"
            f'(function () {{ if (window.LocalFrog) {{ window.LocalFrog.connectDiagnostics("{endpoint}"); }} }})();\n'
        )
        print(f"diag bridge enabled -> {args.diag_endpoint}")
    if args.diag_file:
        bundle += (
            "\n/* 验收构建：启用设备文件状态快照 */\n"
            "(function () { if (window.LocalFrog) { window.LocalFrog.flags.diagFile = true; } })();\n"
        )
        print("diag file snapshot enabled")
    write_web_bundle(bundle)
    if args.web_only:
        return

    source = Path(args.input)
    if not source.is_file():
        raise SystemExit(f"input APK not found: {source}")
    unsigned = Path(args.unsigned)
    inject_apk(bundle, source, unsigned)
    if args.no_sign:
        return
    align_and_sign(
        unsigned, Path(args.aligned), Path(args.output),
        Path(args.keystore), args.store_pass, args.key_pass, args.alias,
    )


if __name__ == "__main__":
    main()
