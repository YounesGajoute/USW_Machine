# Flash-size helper: stub EthernetENC DNS + enforce UDP-off / TCP-server-only sizing.
# Re-applies after PlatformIO refreshes libdeps.
Import("env")
from pathlib import Path
import re

# C++-only flags (avoid cc1 warnings on .c files)
env.Append(CXXFLAGS=["-fno-threadsafe-statics", "-fno-exceptions"])

MARKER = "/* FLASH_OPT_STUB"
UDP_MARKER = "/* FLASH_OPT_UDP"
ACTIVE_MARKER = "/* FLASH_OPT_NO_ACTIVE_OPEN"
CONNECT_MARKER = "/* FLASH_OPT_NO_CONNECT"

stub_src = Path(env["PROJECT_DIR"]) / "scripts" / "Dns_stub.cpp"
eth_root = (
    Path(env["PROJECT_LIBDEPS_DIR"]) / env["PIOENV"] / "EthernetENC" / "src"
)
eth_dns = eth_root / "Dns.cpp"
eth_cpp = eth_root / "Ethernet.cpp"
eth_client = eth_root / "EthernetClient.cpp"
eth_conf = eth_root / "utility" / "uipethernet-conf.h"
uipopt = eth_root / "utility" / "uipopt.h"

if eth_dns.exists() and stub_src.exists():
    text = eth_dns.read_text(encoding="utf-8", errors="ignore")
    if MARKER not in text:
        eth_dns.write_text(stub_src.read_text(encoding="utf-8"), encoding="utf-8")
        print("flash_opt: installed EthernetENC Dns.cpp stub")

if eth_cpp.exists():
    text = eth_cpp.read_text(encoding="utf-8", errors="ignore")
    if "FLASH_OPT_HOSTBYNAME" not in text and "hostByName" in text:
        new_text, n = re.subn(
            r"int\s+UIPEthernetClass::hostByName\s*\([^)]*\)\s*\{.*?\n\}",
            "int UIPEthernetClass::hostByName(const char* /*hostname*/, IPAddress& /*result*/)\n"
            "{\n"
            "  /* FLASH_OPT_HOSTBYNAME */\n"
            "  return 0;\n"
            "}",
            text,
            count=1,
            flags=re.S,
        )
        if n:
            eth_cpp.write_text(new_text, encoding="utf-8")
            print("flash_opt: patched EthernetENC hostByName")

if eth_conf.exists():
    text = eth_conf.read_text(encoding="utf-8", errors="ignore")
    if UDP_MARKER not in text:
        patched = text
        patched = re.sub(
            r"(#ifndef UIP_SOCKET_NUMPACKETS\n#define UIP_SOCKET_NUMPACKETS\s+)\d+",
            r"\g<1>2",
            patched,
            count=1,
        )
        patched = re.sub(
            r"(#ifndef UIP_CONF_MAX_CONNECTIONS\n#define UIP_CONF_MAX_CONNECTIONS\s+)\d+",
            r"\g<1>2",
            patched,
            count=1,
        )
        patched = re.sub(
            r"(#ifndef UIP_CONF_UDP\n#define UIP_CONF_UDP\s+)\d+",
            r"\g<1>0",
            patched,
            count=1,
        )
        if patched != text:
            patched = patched.replace(
                "#define UIPETHERNET_CONF_H\n",
                "#define UIPETHERNET_CONF_H\n" + UDP_MARKER + " */\n",
                1,
            )
            eth_conf.write_text(patched, encoding="utf-8")
            print("flash_opt: patched uipethernet-conf.h (UDP=0, conn=2, pkts=2)")

# Slave is TCP server only — drop uIP active-open / client connect paths.
if uipopt.exists():
    text = uipopt.read_text(encoding="utf-8", errors="ignore")
    if ACTIVE_MARKER not in text:
        new_text, n = re.subn(
            r"#define UIP_ACTIVE_OPEN\s+1",
            ACTIVE_MARKER + " */\n#define UIP_ACTIVE_OPEN 0",
            text,
            count=1,
        )
        if n:
            uipopt.write_text(new_text, encoding="utf-8")
            print("flash_opt: UIP_ACTIVE_OPEN=0")

if eth_client.exists():
    text = eth_client.read_text(encoding="utf-8", errors="ignore")
    if CONNECT_MARKER not in text:
        new_text, n = re.subn(
            r"int\s*\nUIPClient::connect\(IPAddress ip, uint16_t port\)\s*\n\{.*?\n\}",
            "int\nUIPClient::connect(IPAddress /*ip*/, uint16_t /*port*/)\n"
            "{\n"
            "  " + CONNECT_MARKER + " */\n"
            "  return 0;\n"
            "}",
            text,
            count=1,
            flags=re.S,
        )
        if n:
            eth_client.write_text(new_text, encoding="utf-8")
            print("flash_opt: stubbed EthernetClient::connect(IPAddress)")

# uip-conf.h hardcodes listen ports without #ifndef — force 1 for single-port slave.
uip_conf = eth_root / "utility" / "uip-conf.h"
LISTEN_MARKER = "/* FLASH_OPT_LISTENPORTS"
if uip_conf.exists():
    text = uip_conf.read_text(encoding="utf-8", errors="ignore")
    if LISTEN_MARKER not in text:
        new_text, n = re.subn(
            r"#define UIP_CONF_MAX_LISTENPORTS\s+\d+",
            LISTEN_MARKER + " */\n#define UIP_CONF_MAX_LISTENPORTS 1",
            text,
            count=1,
        )
        if n:
            uip_conf.write_text(new_text, encoding="utf-8")
            print("flash_opt: UIP_CONF_MAX_LISTENPORTS=1")

# Production slave is TCP-only (no USB Serial diagnostics). LTO still pulls
# HardwareSerial via serialEventRun — strip those archive members before link.
def _strip_hardware_serial(source, target, env):  # noqa: ARG001
    import subprocess

    ar = Path(env.subst("$BUILD_DIR")) / "libFrameworkArduino.a"
    if not ar.exists():
        return
    plat = env.PioPlatform()
    tool_bin = Path(plat.get_package_dir("toolchain-atmelavr")) / "bin"
    # Must use gcc-ar with LTO plugin — plain avr-ar corrupts the archive.
    avr_ar = tool_bin / "avr-gcc-ar"
    if not avr_ar.exists():
        avr_ar = tool_bin / "avr-ar"
    members = (
        "HardwareSerial.cpp.o",
        "HardwareSerial0.cpp.o",
        "HardwareSerial1.cpp.o",
        "HardwareSerial2.cpp.o",
        "HardwareSerial3.cpp.o",
    )
    removed = []
    for m in members:
        rc = subprocess.call(
            [str(avr_ar), "d", str(ar), m],
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
        )
        if rc == 0:
            removed.append(m)
    if removed:
        print("flash_opt: stripped from libFrameworkArduino.a: " + ", ".join(removed))


env.AddPreAction("$BUILD_DIR/${PROGNAME}.elf", _strip_hardware_serial)

# IPAddress::printTo pulls Print::printNumber (~300 B). Slave never prints IPs.
def _stub_ipaddress_print_to():
    plat = env.PioPlatform()
    ip_cpp = (
        Path(plat.get_package_dir("framework-arduino-avr"))
        / "cores"
        / "arduino"
        / "IPAddress.cpp"
    )
    if not ip_cpp.exists():
        return
    text = ip_cpp.read_text(encoding="utf-8", errors="ignore")
    if "FLASH_OPT_IP_PRINTTO" in text:
        return
    new_text, n = re.subn(
        r"size_t\s+IPAddress::printTo\s*\(\s*Print\s*&\s*p\s*\)\s*const\s*\{.*?^\}\s*",
        "size_t IPAddress::printTo(Print& /*p*/) const\n"
        "{\n"
        "  /* FLASH_OPT_IP_PRINTTO */\n"
        "  return 0;\n"
        "}\n",
        text,
        count=1,
        flags=re.S | re.M,
    )
    if n:
        ip_cpp.write_text(new_text, encoding="utf-8")
        print("flash_opt: stubbed IPAddress::printTo")


_stub_ipaddress_print_to()
