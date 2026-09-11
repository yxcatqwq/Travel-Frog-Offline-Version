"""Report brace-balance deltas per local_service module (rough syntax sanity check)."""
from pathlib import Path


def depth_delta(path: Path) -> int:
    source = path.read_text(encoding="utf-8")
    index = 0
    length = len(source)
    depth = 0
    string = None
    line_comment = False
    block_comment = False
    while index < length:
        char = source[index]
        following = source[index + 1] if index + 1 < length else ""
        if line_comment:
            if char == "\n":
                line_comment = False
        elif block_comment:
            if char == "*" and following == "/":
                block_comment = False
                index += 1
        elif string:
            if char == "\\":
                index += 1
            elif char == string:
                string = None
        else:
            if char == "/" and following == "/":
                line_comment = True
                index += 1
            elif char == "/" and following == "*":
                block_comment = True
                index += 1
            elif char in "'\"":
                string = char
            elif char == "{":
                depth += 1
            elif char == "}":
                depth -= 1
        index += 1
    return depth


def main() -> None:
    total = 0
    for path in sorted(Path("tools/local_service").glob("*.js")):
        delta = depth_delta(path)
        total += delta
        print(f"{path.name:24s} delta={delta:4d} cumulative={total:4d}")


if __name__ == "__main__":
    main()
