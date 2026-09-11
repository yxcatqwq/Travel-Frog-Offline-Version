"""Print the AndroidManifest application class name of an APK."""
from pathlib import Path
import importlib.util
import struct
import sys
import zipfile


ROOT = Path(__file__).resolve().parents[1]


def load_patch_module():
    spec = importlib.util.spec_from_file_location(
        "patch_application_class", ROOT / "tools" / "patch-application-class.py")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def main() -> None:
    module = load_patch_module()
    for target in sys.argv[1:]:
        with zipfile.ZipFile(target) as archive:
            payload = archive.read("AndroidManifest.xml")
        names = module.string_pool(payload, struct.unpack_from("<H", payload, 2)[0])
        candidates = [name for name in names if "pplication" in name and "." in name]
        print(f"{target}: {candidates}")


if __name__ == "__main__":
    main()
