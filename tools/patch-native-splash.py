from pathlib import Path
from struct import unpack_from, pack_into
from zipfile import ZIP_DEFLATED, ZIP_STORED, ZipFile, ZipInfo


root = Path(__file__).resolve().parents[1]
source = root / "offline_build" / "travel_frog_local_sync_unsigned.apk"
output = root / "offline_build" / "travel_frog_local_native_unsigned.apk"

manifest_old = b"httpRequest(manifestVersionName, function () {"
manifest_new = b"httpRequest(manifestName, function () {"
application_old = "com.ejoy.ejoysdk.EjoySDKApplication"
application_new = "android.app.Application"


def read_u16(data, offset):
    return unpack_from("<H", data, offset)[0]


def read_u32(data, offset):
    return unpack_from("<I", data, offset)[0]


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
            length_size = 2
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


def encode_utf8_length(value):
    if value < 0x80:
        return bytes((value,))
    if value < 0x8000:
        return bytes(((value >> 8) | 0x80, value & 0xFF))
    raise ValueError(f"UTF-8 string length is too large: {value}")


def patch_manifest_application(payload):
    data = bytearray(payload)
    if read_u16(data, 0) != 0x0003:
        raise RuntimeError("AndroidManifest.xml is not binary XML")

    pool_offset = read_u16(data, 2)
    if read_u16(data, pool_offset) != 0x0001:
        raise RuntimeError("AndroidManifest.xml string pool is missing")

    count = read_u32(data, pool_offset + 8)
    flags = read_u32(data, pool_offset + 16)
    strings_start = read_u32(data, pool_offset + 20)
    offsets_start = pool_offset + read_u16(data, pool_offset + 2)
    values = string_pool(data, pool_offset)
    matches = [index for index, value in enumerate(values) if value == application_old]
    if len(matches) != 1:
        raise RuntimeError(f"application class expected once, found {len(matches)}")

    index = matches[0]
    entry = pool_offset + strings_start + read_u32(data, offsets_start + index * 4)
    if flags & 0x100:
        cursor = entry
        first = data[cursor]
        cursor += 1 if first < 0x80 else 2
        second = data[cursor]
        cursor += 1 if second < 0x80 else 2
        end = data.index(0, cursor) + 1
        encoded = (
            encode_utf8_length(len(application_new))
            + encode_utf8_length(len(application_new.encode("utf-8")))
            + application_new.encode("utf-8")
            + b"\0"
        )
    else:
        old_length = read_u16(data, entry)
        prefix_size = 2 if old_length < 0x8000 else 4
        end = entry + prefix_size + (old_length & 0x7FFF) * 2 + 2
        encoded = len(application_new).to_bytes(2, "little") + application_new.encode("utf-16le") + b"\0\0"

    if len(encoded) > end - entry:
        raise RuntimeError("replacement application class does not fit in the string pool entry")
    data[entry:end] = encoded + b"\0" * (end - entry - len(encoded))
    return bytes(data)


def patch_layout(payload):
    data = bytearray(payload)
    if read_u16(data, 0) != 0x0003:
        raise RuntimeError("splash_in_game.xml is not binary XML")

    strings = None
    offset = read_u16(data, 2)
    while offset < len(data):
        chunk_type = read_u16(data, offset)
        chunk_size = read_u32(data, offset + 4)
        if chunk_type == 0x0001:
            strings = string_pool(data, offset)
        offset += chunk_size
    if strings is None:
        raise RuntimeError("binary XML string pool is missing")

    offset = read_u16(data, 2)
    changed = []
    while offset < len(data):
        chunk_type = read_u16(data, offset)
        chunk_size = read_u32(data, offset + 4)
        if chunk_type == 0x0102:
            name_ref = read_u32(data, offset + 20)
            element_name = strings[name_ref]
            attribute_start = read_u16(data, offset + 24)
            attribute_size = read_u16(data, offset + 26)
            attribute_count = read_u16(data, offset + 28)
            # attributeStart is relative to the ResXMLTree_attrExt, which follows
            # the 16-byte node header inside the start-element chunk.
            attributes = offset + 16 + attribute_start
            for index in range(attribute_count):
                attr = attributes + index * attribute_size
                attr_name = strings[read_u32(data, attr + 4)]
                if element_name == "ImageView" and attr_name in {"layout_width", "layout_height"}:
                    pack_into("<I", data, attr + 16, 0)
                    changed.append(f"ImageView.{attr_name}")
                elif element_name == "ProgressBar" and attr_name in {"layout_width", "layout_height"}:
                    pack_into("<I", data, attr + 16, 0)
                    changed.append(f"ProgressBar.{attr_name}")
        offset += chunk_size

    expected = {
        "ImageView.layout_width",
        "ImageView.layout_height",
        "ProgressBar.layout_width",
        "ProgressBar.layout_height",
    }
    if set(changed) != expected:
        raise RuntimeError(f"unexpected native splash patch set: {changed}")
    return bytes(data)


def copy_entry(out_zip, info, payload):
    cloned = ZipInfo(info.filename, info.date_time)
    cloned.comment = info.comment
    cloned.extra = info.extra
    cloned.create_system = info.create_system
    cloned.external_attr = info.external_attr
    cloned.internal_attr = info.internal_attr
    cloned.compress_type = ZIP_STORED if info.filename == "resources.arsc" else ZIP_DEFLATED
    out_zip.writestr(cloned, payload)


def patch_launcher(payload):
    hits = payload.count(manifest_old)
    if hits != 1:
        raise RuntimeError(f"offline launcher manifest request expected once, found {hits}")
    return payload.replace(manifest_old, manifest_new)


with ZipFile(source, "r") as source_zip, ZipFile(output, "w") as output_zip:
    for info in source_zip.infolist():
        if info.filename.startswith("META-INF/"):
            continue
        payload = source_zip.read(info)
        if info.filename == "AndroidManifest.xml":
            payload = patch_manifest_application(payload)
        if info.filename == "assets/game/launcher.js":
            payload = patch_launcher(payload)
        if info.filename == "res/layout/splash_in_game.xml":
            payload = patch_layout(payload)
        copy_entry(output_zip, info, payload)

print(f"Created {output}")
