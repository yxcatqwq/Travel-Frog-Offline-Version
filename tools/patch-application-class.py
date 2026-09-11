"""Rewrite the AndroidManifest application class name (binary XML string pool).

Used to restore ``com.ejoy.ejoysdk.EjoySDKApplication`` after the offline patch
replaced it with ``android.app.Application`` (which leaves the ejoy SDK without a
static Context and crashes the game on startup).

Usage:
    python tools/patch-application-class.py <in.apk> <out.apk> <new-class-name>
"""
from pathlib import Path
from struct import pack_into, unpack_from
import sys
import zipfile


def read_u16(data, offset):
    return unpack_from("<H", data, offset)[0]


def read_u32(data, offset):
    return unpack_from("<I", data, offset)[0]


def encode_utf8_length(value: int) -> bytes:
    if value < 0x80:
        return bytes((value,))
    if value < 0x8000:
        return bytes(((value >> 8) | 0x80, value & 0xFF))
    raise ValueError(f"utf-8 length too large: {value}")


def string_pool(data, chunk_offset):
    string_count = read_u32(data, chunk_offset + 8)
    flags = read_u32(data, chunk_offset + 16)
    strings_start = read_u32(data, chunk_offset + 20)
    offsets_start = chunk_offset + read_u16(data, chunk_offset + 2)
    utf8 = (flags & 0x100) != 0
    values = []
    for index in range(string_count):
        string_offset = chunk_offset + strings_start + read_u32(data, offsets_start + index * 4)
        if utf8:
            first = data[string_offset]
            string_offset += 1 if first < 0x80 else 2
            second = data[string_offset]
            string_offset += 1 if second < 0x80 else 2
            end = data.index(0, string_offset)
            values.append(bytes(data[string_offset:end]).decode("utf-8"))
        else:
            length = read_u16(data, string_offset)
            string_offset += 2
            values.append(bytes(data[string_offset:string_offset + length * 2]).decode("utf-16le"))
    return values


def patch_manifest(payload: bytes, old: str, new: str) -> bytes:
    data = bytearray(payload)
    if read_u16(data, 0) != 0x0003:
        raise RuntimeError("AndroidManifest.xml is not binary XML")
    pool_offset = read_u16(data, 2)
    if read_u16(data, pool_offset) != 0x0001:
        raise RuntimeError("AndroidManifest.xml string pool is missing")
    flags = read_u32(data, pool_offset + 16)
    strings_start = read_u32(data, pool_offset + 20)
    offsets_start = pool_offset + read_u16(data, pool_offset + 2)
    values = string_pool(data, pool_offset)
    matches = [index for index, value in enumerate(values) if value == old]
    if len(matches) != 1:
        if not matches and any(value == new for value in values):
            # The APK may already contain the requested class.  This makes
            # the helper safe to call after build-local-service.py, which
            # restores the original Application class during its own pass.
            return payload
        raise RuntimeError(f"expected exactly one '{old}', found {len(matches)}")
    index = matches[0]
    # 池内偏移可以任意排序；用“下一个条目的起点”作为当前条目的容量上界，
    # 这样可以原址写回不短于当前值的名称（旧名更长时）。
    offsets = [read_u32(data, offsets_start + i * 4) for i in range(len(values))]
    data_end = offsets_start + read_u32(data, pool_offset + 4)  # chunk size + chunk offset
    entry = pool_offset + strings_start + offsets[index]
    limits = [pool_offset + strings_start + value for value in offsets if value > offsets[index]]
    entry_end = min(limits) if limits else data_end
    if flags & 0x100:
        encoded = (
            encode_utf8_length(len(new))
            + encode_utf8_length(len(new.encode("utf-8")))
            + new.encode("utf-8")
            + b"\0"
        )
    else:
        old_length = read_u16(data, entry)
        prefix = 2 if old_length < 0x8000 else 4
        encoded = len(new).to_bytes(2, "little") + new.encode("utf-16le") + b"\0\0"
        del prefix
    capacity = entry_end - entry
    if len(encoded) > capacity:
        raise RuntimeError(f"new class name needs {len(encoded)} bytes, entry has {capacity}")
    data[entry:entry_end] = encoded + b"\0" * (capacity - len(encoded))
    return bytes(data)


def main() -> None:
    if len(sys.argv) < 4:
        raise SystemExit(__doc__)
    source, target, new_name = Path(sys.argv[1]), Path(sys.argv[2]), sys.argv[3]
    old_name = sys.argv[4] if len(sys.argv) > 4 else "android.app.Application"
    if target.exists():
        target.unlink()
    with zipfile.ZipFile(source) as src, zipfile.ZipFile(target, "w") as dst:
        for info in src.infolist():
            if info.filename.startswith("META-INF/"):
                continue
            payload = src.read(info)
            if info.filename == "AndroidManifest.xml":
                payload = patch_manifest(payload, old_name, new_name)
            cloned = zipfile.ZipInfo(info.filename, info.date_time)
            cloned.compress_type = zipfile.ZIP_STORED if info.filename == "resources.arsc" else zipfile.ZIP_DEFLATED
            cloned.external_attr = info.external_attr
            dst.writestr(cloned, payload)
    print(f"{target}: application class -> {new_name}")


if __name__ == "__main__":
    main()
