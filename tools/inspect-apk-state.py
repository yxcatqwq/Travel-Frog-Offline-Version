"""Report which offline patches each candidate APK already contains."""
from pathlib import Path
import re
import sys
import zipfile


ROOT = Path(__file__).resolve().parents[1]

CHECKS = {
    "launcher-offline": ("assets/game/launcher.js", b"Offline build: load only the manifest bundled in this APK"),
    "index-offline": ("assets/game/index.html", b'loadSingleScript("launcher.js")'),
    "package-renamed": ("AndroidManifest.xml", "com.offline.frog.appx".encode("utf-16le")),
    "app-original": ("AndroidManifest.xml", "com.ejoy.ejoysdk.EjoySDKApplication".encode("utf-16le")),
    "app-patched": ("AndroidManifest.xml", "android.app.Application".encode("utf-16le")),
    "login-shim": ("assets/game/js/main.min.js", b"this.syncComplete=!0,e&&e()"),
    "season-fix": ("assets/game/js/main.min.js", b'getSeasonKey=function(){return"31"}'),
    "local-service": ("assets/game/js/local_service.js", b"LocalFrog"),
}


def main() -> None:
    targets = sys.argv[1:] or [
        str(ROOT / "efdf573b14b794a0_release_1.0.20_22_20240115113657_aab21a715fac91ec35975f5eba01b7a7_cp_1722332574958.apk.1"),
        str(ROOT / "offline_build" / "travel_frog_local_update.apk"),
        str(ROOT / "offline_build" / "travel_frog_local_sync.apk"),
        str(ROOT / "offline_build" / "travel_frog_local_native.apk"),
        str(ROOT / "offline_build" / "travel_frog_local_service.apk"),
    ]
    for target in targets:
        path = Path(target)
        if not path.is_file():
            print(f"{path.name}: missing")
            continue
        with zipfile.ZipFile(path) as archive:
            names = set(archive.namelist())
            flags = []
            for label, (entry, needle) in CHECKS.items():
                if entry not in names:
                    flags.append(f"{label}=NOENTRY")
                    continue
                payload = archive.read(entry)
                flags.append(f"{label}={'yes' if needle in payload else 'no'}")
            manifest = archive.read("assets/game/manifest.json").decode("utf-8") if "assets/game/manifest.json" in names else ""
            game = re.search(r'"game":\[(.*?)\]', manifest)
            print(f"== {path.name}")
            print("   " + " ".join(flags))
            print(f"   game={game.group(1) if game else 'n/a'}")


if __name__ == "__main__":
    main()
