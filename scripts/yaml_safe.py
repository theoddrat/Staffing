"""Rewrite risky plain YAML scalars in content files as literal block scalars.

Plain (unquoted) YAML values break when they contain ': ' or ' #', or start
with characters such as '*', '`' or '"'. Authors can write naturally and run
this script to make the files safe:

    python scripts/yaml_safe.py content/lessons/*/*.yaml content/dictionary/*.yaml

The script understands block scalars (``key: |``) and never edits the text
inside them. It also repairs a mistake made by an earlier version of this
script, which inserted "- |-" lines into the middle of block text.
"""

import re
import sys
from pathlib import Path

LINE = re.compile(r"^(?P<indent>\s*)(?P<dash>- )?(?P<key>[A-Za-z_]+): (?P<val>.+)$")
ITEM = re.compile(r"^(?P<indent>\s*)- (?P<val>.+)$")
BLOCK_START = re.compile(r"^(?P<indent>\s*)(?P<dash>- )?(?:(?P<key>[A-Za-z_]+):\s*)?[|>][-+]?\s*$")
SPECIAL_START = set("*&!%@`|>")


def risky(val: str) -> bool:
    if val[0] in "[{":
        return False
    if val[0] in "'\"":
        q = val[0]
        return not (val.endswith(q) and len(val) > 1)
    if val[0] in SPECIAL_START:
        return not re.fullmatch(r"[|>][-+]?", val)
    return ": " in val or " #" in val or val.endswith(":")


def indent_of(line: str) -> int:
    return len(line) - len(line.lstrip(" "))


def fix(text: str) -> tuple[str, int]:
    lines = text.splitlines()
    out: list[str] = []
    n = 0
    block_parent: int | None = None  # column of the key/dash that owns the current block scalar
    i = 0
    while i < len(lines):
        line = lines[i]
        stripped = line.strip()
        if block_parent is not None:
            if not stripped or indent_of(line) > block_parent:
                # inside block text: repair the old "- |-" corruption, otherwise copy verbatim
                if stripped == "- |-" and i + 1 < len(lines) and indent_of(lines[i + 1]) == indent_of(line) + 2:
                    out.append(" " * indent_of(line) + "- " + lines[i + 1].strip())
                    n += 1
                    i += 2
                    continue
                km = re.fullmatch(r"(\s*)([A-Za-z_]+): \|-", line)
                if km and i + 1 < len(lines) and indent_of(lines[i + 1]) == indent_of(line) + 2:
                    out.append(f"{km.group(1)}{km.group(2)}: {lines[i + 1].strip()}")
                    n += 1
                    i += 2
                    continue
                out.append(line)
                i += 1
                continue
            block_parent = None

        b = BLOCK_START.match(line)
        if b:
            col = len(b.group("indent"))
            if b.group("dash") and b.group("key"):
                col += 2
            block_parent = col
            out.append(line)
            i += 1
            continue

        m = LINE.match(line)
        item = ITEM.match(line)
        if not m and item:
            val = item.group("val").rstrip()
            if risky(val):
                col = len(item.group("indent")) + 2
                out.append(f"{item.group('indent')}- |-")
                out.append(" " * col + val)
                block_parent = len(item.group("indent"))
                n += 1
                i += 1
                continue
        if m and risky(m.group("val").rstrip()):
            col = len(m.group("indent")) + (2 if m.group("dash") else 0)
            out.append(f"{m.group('indent')}{m.group('dash') or ''}{m.group('key')}: |-")
            out.append(" " * (col + 2) + m.group("val").rstrip())
            block_parent = col
            n += 1
            i += 1
            continue
        out.append(line)
        i += 1
    return "\n".join(out) + "\n", n


if __name__ == "__main__":
    for f in sys.argv[1:]:
        p = Path(f)
        new, n = fix(p.read_text())
        if n:
            p.write_text(new)
            print(f"{f}: fixed {n}")
