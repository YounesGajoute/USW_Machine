"""Patch njh/EtherCard so PlatformIO -DETHERCARD_* build flags are respected."""
import re
from pathlib import Path

Import("env")

FLAGS = (
    "ETHERCARD_DHCP",
    "ETHERCARD_TCPCLIENT",
    "ETHERCARD_UDPSERVER",
    "ETHERCARD_STASH",
)


def patch_ethercard_h(path: Path) -> bool:
    text = path.read_text(encoding="utf-8", errors="replace")
    changed = False
    for name in FLAGS:
        pat = rf"^#define {name} 1\s*$"
        repl = f"#ifndef {name}\n#define {name} 1\n#endif"
        new_text, n = re.subn(pat, repl, text, count=1, flags=re.MULTILINE)
        if n:
            text = new_text
            changed = True
    if changed:
        path.write_text(text, encoding="utf-8")
    return changed


def patch_all(project_dir: Path) -> int:
    libdeps = project_dir / ".pio" / "libdeps"
    if not libdeps.is_dir():
        return 0
    n = 0
    for h in libdeps.glob("*/EtherCard/src/EtherCard.h"):
        if patch_ethercard_h(h):
            print(f"patch_ethercard: patched {h}")
            n += 1
    return n


def before_build(source, target, env):
    patch_all(Path(env["PROJECT_DIR"]))


patch_all(Path(env["PROJECT_DIR"]))
env.AddPreAction("buildprog", before_build)
