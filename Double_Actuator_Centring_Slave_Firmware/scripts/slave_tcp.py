#!/usr/bin/env python3
"""TCP client for Double Actuator Centring Slave terminal protocol.

Protocol: LF-terminated lines on TCP (default 192.168.10.55:8177).
On connect the slave sends READY then PING. Every command gets a STATUS line
(space-separated key=value, starts with u=). Motion stays on the same socket
until busy=0; send any line (PING) within 10 s or the link drops.

CLI examples:
  python3 scripts/slave_tcp.py PING
  python3 scripts/slave_tcp.py STATUS
  python3 scripts/slave_tcp.py -i
  python3 scripts/slave_tcp.py HOME
  python3 scripts/slave_tcp.py "SETCAL unit_01 1950 1100 1501 731"
"""

from __future__ import annotations

import argparse
import re
import socket
import sys
import time
from dataclasses import dataclass, field
from typing import Dict, List, Optional, Tuple

DEFAULT_HOST = "192.168.10.55"
DEFAULT_PORT = 8177
KEEPALIVE_S = 5.0
CONNECT_TIMEOUT_S = 5.0
RECV_TIMEOUT_S = 1.0

# Short SETCAL: calId + hu tu hl tl (A/B/C/soft ° optional; firmware defaults)
# u_HOME > u_TRAVEL; seeds near measured edges → STATUS cal=1
DEFAULT_SETCAL = "SETCAL unit_01 1950 1100 1501 731"

STATUS_RE = re.compile(r"\b([A-Za-z_][A-Za-z0-9_]*)=([^\s]+)")


@dataclass
class Status:
    raw: str
    fields: Dict[str, str] = field(default_factory=dict)

    @classmethod
    def parse(cls, line: str) -> "Status":
        fields = {m.group(1): m.group(2) for m in STATUS_RE.finditer(line)}
        return cls(raw=line, fields=fields)

    def get(self, key: str, default: str = "") -> str:
        return self.fields.get(key, default)

    def int(self, key: str, default: int = 0) -> int:
        try:
            return int(self.get(key, str(default)))
        except ValueError:
            return default

    def accepted(self) -> bool:
        return self.int("accepted") == 1

    def busy(self) -> bool:
        return self.int("busy") == 1

    @staticmethod
    def looks_like(line: str) -> bool:
        return "accepted=" in line and "lastCmd=" in line


class SlaveTcp:
    """Persistent TCP session with keepalive while waiting on motion."""

    def __init__(
        self,
        host: str = DEFAULT_HOST,
        port: int = DEFAULT_PORT,
        verbose: bool = True,
    ) -> None:
        self.host = host
        self.port = port
        self.verbose = verbose
        self._sock: Optional[socket.socket] = None
        self._buf = b""
        self._last_tx = 0.0
        self.greeting: List[str] = []

    def connect(self) -> List[str]:
        self.close()
        s = socket.create_connection((self.host, self.port), timeout=CONNECT_TIMEOUT_S)
        s.settimeout(RECV_TIMEOUT_S)
        self._sock = s
        self._buf = b""
        self._last_tx = time.monotonic()
        self.greeting = []
        deadline = time.monotonic() + 3.0
        while len(self.greeting) < 2 and time.monotonic() < deadline:
            line = self._readline(timeout=deadline - time.monotonic())
            if line is None:
                continue
            self.greeting.append(line)
            self._log(f"<< {line}")
        if len(self.greeting) < 2:
            raise TimeoutError("slave did not send READY/PING on connect")
        if self.greeting[0] != "READY" or self.greeting[1] != "PING":
            raise RuntimeError(f"unexpected greeting: {self.greeting!r}")
        return self.greeting

    def close(self) -> None:
        if self._sock is not None:
            try:
                self._sock.close()
            except OSError:
                pass
            self._sock = None
        self._buf = b""

    def __enter__(self) -> "SlaveTcp":
        self.connect()
        return self

    def __exit__(self, *_args) -> None:
        self.close()

    def _log(self, msg: str) -> None:
        if self.verbose:
            print(msg, flush=True)

    def _sock_req(self) -> socket.socket:
        if self._sock is None:
            raise RuntimeError("not connected")
        return self._sock

    def _readline(self, timeout: float = RECV_TIMEOUT_S) -> Optional[str]:
        s = self._sock_req()
        end = time.monotonic() + max(0.0, timeout)
        while True:
            if b"\n" in self._buf:
                raw, self._buf = self._buf.split(b"\n", 1)
                return raw.decode("ascii", errors="replace").rstrip("\r")
            remaining = end - time.monotonic()
            if remaining <= 0:
                return None
            s.settimeout(max(0.05, remaining))
            try:
                chunk = s.recv(4096)
            except socket.timeout:
                continue
            except OSError as e:
                raise ConnectionError(f"recv failed: {e}") from e
            if not chunk:
                raise ConnectionError("connection closed by slave")
            self._buf += chunk

    def drain(self, idle_s: float = 0.15) -> List[str]:
        lines: List[str] = []
        while True:
            line = self._readline(timeout=idle_s)
            if line is None:
                break
            self._log(f"<< {line}")
            lines.append(line)
        return lines

    def send_raw(self, text: str) -> None:
        payload = (text.rstrip("\r\n") + "\n").encode("ascii")
        self._log(f">> {text.rstrip()}")
        self._sock_req().sendall(payload)
        self._last_tx = time.monotonic()

    def keepalive_if_needed(self, every_s: float = KEEPALIVE_S) -> None:
        """Send PING only — reply is consumed by the caller read loop."""
        if time.monotonic() - self._last_tx >= every_s:
            self.send_raw("PING")

    def command(
        self,
        text: str,
        *,
        wait_busy: bool = True,
        timeout_s: float = 90.0,
    ) -> Tuple[Status, List[str], Optional[str]]:
        """Send one command; return (final_status, extras, cal_result_line)."""
        self.send_raw(text)
        accept: Optional[Status] = None
        final: Optional[Status] = None
        extras: List[str] = []
        cal_result: Optional[str] = None
        deadline = time.monotonic() + timeout_s

        while time.monotonic() < deadline:
            remaining = deadline - time.monotonic()
            if accept is not None and wait_busy and accept.busy():
                self.keepalive_if_needed()
            line = self._readline(timeout=min(1.0, max(0.05, remaining)))
            if line is None:
                if accept is not None and (not wait_busy or not accept.busy()):
                    break
                continue
            self._log(f"<< {line}")
            if line.startswith("CAL_RESULT"):
                cal_result = line
                extras.append(line)
                continue
            if Status.looks_like(line):
                st = Status.parse(line)
                if accept is None:
                    accept = st
                    final = st
                    if not wait_busy or not st.busy():
                        more = self.drain(0.05)
                        for m in more:
                            if m.startswith("CAL_RESULT"):
                                cal_result = m
                            elif Status.looks_like(m):
                                final = Status.parse(m)
                            extras.append(m)
                        assert final is not None
                        return final, extras, cal_result
                    continue
                extras.append(line)
                final = st
                accept = st
                if not st.busy():
                    return final, extras, cal_result
            else:
                extras.append(line)

        if final is None:
            raise TimeoutError(f"no STATUS for command: {text!r}")
        if wait_busy and final.busy():
            raise TimeoutError(f"still busy after {timeout_s:.0f}s: {text!r}")
        return final, extras, cal_result


def add_common_args(p: argparse.ArgumentParser) -> None:
    p.add_argument("--host", default=DEFAULT_HOST, help="slave IP (default %(default)s)")
    p.add_argument(
        "--port", type=int, default=DEFAULT_PORT, help="TCP port (default %(default)s)"
    )
    p.add_argument("-q", "--quiet", action="store_true", help="less I/O logging")


def coalesce_cli_commands(tokens: List[str]) -> List[str]:
    """Join argv splits like MOVEBOTHMM 20 30 into one protocol line.

    Without this, ``python3 scripts/slave_tcp.py MOVEBOTHMM 20 30`` sends three
    lines (parse/unknown) and never moves the jaws.
    """
    verbs = {
        "PING",
        "STATUS",
        "SETMECHOFF",
        "CLEARESTOP",
        "HOME",
        "HOME_UPPER",
        "HOME_LOWER",
        "SEEK_TRAVEL",
        "SEEK_TRAVEL_UPPER",
        "SEEK_TRAVEL_LOWER",
        "SETCAL",
        "CALDRV",
        "KILL",
        "MOVEBOTHMM",
        "MOVE_UPPERMM",
        "MOVE_LOWERMM",
    }
    out: List[str] = []
    i = 0
    while i < len(tokens):
        parts = [tokens[i]]
        i += 1
        while i < len(tokens) and tokens[i] not in verbs:
            parts.append(tokens[i])
            i += 1
        out.append(" ".join(parts))
    return out


def main_oneshot(argv: Optional[List[str]] = None) -> int:
    p = argparse.ArgumentParser(
        description="Send LF-terminated commands to centring slave over TCP"
    )
    add_common_args(p)
    p.add_argument(
        "commands",
        nargs="*",
        help="commands to send (each becomes one line). Default: PING",
    )
    p.add_argument(
        "-i",
        "--interactive",
        action="store_true",
        help="REPL: type commands until EOF / quit",
    )
    p.add_argument(
        "--no-wait",
        action="store_true",
        help="do not wait for busy=0 after motion commands",
    )
    p.add_argument(
        "--timeout",
        type=float,
        default=90.0,
        help="seconds to wait for busy clear (default %(default)s)",
    )
    args = p.parse_args(argv)
    raw = args.commands or (["PING"] if not args.interactive else [])
    cmds = coalesce_cli_commands(raw)

    try:
        with SlaveTcp(args.host, args.port, verbose=not args.quiet) as client:
            for cmd in cmds:
                client.command(cmd, wait_busy=not args.no_wait, timeout_s=args.timeout)
            if args.interactive:
                print("(interactive — empty line / quit / Ctrl-D to exit)", flush=True)
                while True:
                    try:
                        line = input("> ").strip()
                    except EOFError:
                        print()
                        break
                    if not line or line.lower() in ("quit", "exit", "q"):
                        break
                    client.command(
                        line, wait_busy=not args.no_wait, timeout_s=args.timeout
                    )
    except (OSError, TimeoutError, RuntimeError, ConnectionError) as e:
        print(f"ERROR: {e}", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main_oneshot())
