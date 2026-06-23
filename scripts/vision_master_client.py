#!/usr/bin/env python3
"""
Control a Vision Inspection slave Raspberry Pi from a master over Ethernet.

REST (programs, master image, templates, one-shot inspection):
  Base URL: http://VISION_PI:5000/api  (from backend/.env VISION_URL)

Socket.IO (continuous inspection, live frames):
  sio.connect("http://VISION_PI:5000", socketio_path="/socket.io/")

Environment (backend/.env loaded automatically):
  VISION_URL             Host base (e.g. http://192.168.10.2:5000)
  VISION_SLAVE_URL       Optional REST prefix override
  VISION_REMOTE_KEY      X-Vision-Remote-Key (/api/remote/*)
  VISION_LOCAL_KEY       X-Vision-Local-Key (/api/camera/*, /master-image, /tool-templates, /programs)
"""

from __future__ import annotations

import argparse
import base64
import json
import mimetypes
import os
import re
import sys
import tempfile
import time
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple

try:
    import requests
except ImportError:
    print("Install requests: pip install -r scripts/requirements-master-client.txt", file=sys.stderr)
    sys.exit(1)

_VISION_ENV_FROM_FILE = frozenset({
    "VISION_URL",
    "VISION_SLAVE_URL",
    "VISION_REMOTE_KEY",
    "VISION_REMOTE_API_KEY",
    "VISION_LOCAL_KEY",
    "VISION_LOCAL_API_KEY",
})


def _find_repo_root() -> Path:
    here = Path(__file__).resolve().parent
    for candidate in (here.parent, here):
        if (candidate / "backend" / ".env").is_file():
            return candidate
    return here.parent


def _load_backend_dotenv() -> None:
    """Load backend/.env; vision keys from the file override stale shell exports."""
    env_path = _find_repo_root() / "backend" / ".env"
    if not env_path.is_file():
        return
    for line in env_path.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if not line or line.startswith("#"):
            continue
        m = re.match(r"([A-Za-z_][A-Za-z0-9_]*)=(.*)$", line)
        if not m:
            continue
        key, raw = m.group(1), m.group(2).strip()
        if key in _VISION_ENV_FROM_FILE or key not in os.environ:
            if len(raw) >= 2 and raw[0] == raw[-1] and raw[0] in "\"'":
                raw = raw[1:-1]
            os.environ[key] = raw


def _default_base_url() -> str:
    slave = os.environ.get("VISION_SLAVE_URL")
    if slave:
        return slave.rstrip("/")
    host = os.environ.get("VISION_URL", "http://192.168.10.2:5000").rstrip("/")
    if host.endswith("/api") or host.endswith("/api/v1"):
        return host
    return f"{host}/api"


def _default_remote_key() -> Optional[str]:
    return os.environ.get("VISION_REMOTE_KEY") or os.environ.get("VISION_REMOTE_API_KEY") or None


def _default_local_key() -> Optional[str]:
    return os.environ.get("VISION_LOCAL_KEY") or os.environ.get("VISION_LOCAL_API_KEY") or None


def _remote_headers(key: Optional[str]) -> Dict[str, str]:
    h = {"Content-Type": "application/json"}
    if key:
        h["X-Vision-Remote-Key"] = key
    return h


def _local_headers(key: Optional[str], json_body: bool = True) -> Dict[str, str]:
    h: Dict[str, str] = {}
    if json_body:
        h["Content-Type"] = "application/json"
    if key:
        h["X-Vision-Local-Key"] = key
    return h


def _explain_connection_error(base: str, err: BaseException) -> None:
    host = base.split("://", 1)[-1].split("/", 1)[0]
    print(f"\nCannot reach vision slave at {base}", file=sys.stderr)
    if host.startswith("127.0.0.1") or host.startswith("localhost"):
        print(
            "  Wrong host: use backend/.env VISION_URL, not 127.0.0.1 on the master.",
            file=sys.stderr,
        )
    else:
        print(
            f"  Check vision Pi power, cable, IP {host.split(':')[0]}, Flask on :5000.",
            file=sys.stderr,
        )
        print("  See docs/MASTER_VISION_CONNECTIVITY.md", file=sys.stderr)
    print(f"  backend/.env VISION_URL={os.environ.get('VISION_URL', '(unset)')}", file=sys.stderr)
    print(f"  {err}\n", file=sys.stderr)


def _decode_image_payload(data: Dict[str, Any]) -> Tuple[bytes, str]:
    """Extract image bytes from /camera/capture JSON (base64 fields)."""
    for key in ("image", "imageData", "data", "frame"):
        val = data.get(key)
        if isinstance(val, str) and val:
            return base64.b64decode(val), data.get("format") or data.get("imageFormat") or "png"
    raise ValueError(f"No image field in capture response: {list(data.keys())}")


def _load_tools_file(path: Path) -> List[Dict[str, Any]]:
    raw = json.loads(path.read_text(encoding="utf-8"))
    if isinstance(raw, list):
        return raw
    if isinstance(raw, dict) and isinstance(raw.get("tools"), list):
        return raw["tools"]
    raise ValueError(f"{path}: expected a JSON array of tools or {{\"tools\": [...]}}")


def cmd_ping(base: str) -> None:
    r = requests.get(f"{base}/health", timeout=15)
    r.raise_for_status()
    print(json.dumps(r.json(), indent=2))


def cmd_check(base: str, key: Optional[str]) -> None:
    r = requests.get(f"{base}/remote/info", headers=_remote_headers(key), timeout=15)
    r.raise_for_status()
    print(json.dumps(r.json(), indent=2))
    print(f"OK {r.status_code} {base}/remote/info", file=sys.stderr)


def cmd_info(base: str, key: Optional[str]) -> None:
    cmd_check(base, key)


def cmd_programs(base: str, remote_key: Optional[str], local_key: Optional[str]) -> None:
    hdr = _local_headers(local_key) if local_key else _remote_headers(remote_key)
    r = requests.get(f"{base}/programs?active_only=true", headers=hdr, timeout=30)
    r.raise_for_status()
    data = r.json()
    for p in data.get("programs", []):
        print(f"{p.get('id')}\t{p.get('name')}")


def cmd_capture(base: str, local_key: Optional[str], out_path: Path) -> None:
    r = requests.post(
        f"{base}/camera/capture",
        headers=_local_headers(local_key),
        json={},
        timeout=60,
    )
    if r.status_code != 200:
        print(r.text, file=sys.stderr)
        r.raise_for_status()
    data = r.json()
    raw, fmt = _decode_image_payload(data)
    suffix = f".{fmt.lower().lstrip('.')}" if fmt else ".png"
    if out_path.suffix.lower() not in (".png", ".jpg", ".jpeg", ".bmp"):
        out_path = out_path.with_suffix(suffix)
    out_path.write_bytes(raw)
    print(json.dumps({"path": str(out_path), "bytes": len(raw), "format": fmt}, indent=2))


def cmd_register_master(
    base: str,
    local_key: Optional[str],
    program_id: int,
    image_path: Optional[Path],
) -> None:
    temp_path: Optional[Path] = None
    try:
        if image_path is not None:
            src = image_path
        else:
            fd, tmp = tempfile.mkstemp(suffix=".png")
            os.close(fd)
            temp_path = Path(tmp)
            cmd_capture(base, local_key, temp_path)
            src = temp_path

        mime, _ = mimetypes.guess_type(str(src))
        mime = mime or "image/png"
        with src.open("rb") as f:
            r = requests.post(
                f"{base}/master-image",
                headers=_local_headers(local_key, json_body=False),
                data={"programId": str(program_id)},
                files={"file": (src.name, f, mime)},
                timeout=120,
            )
        if r.status_code not in (200, 201):
            print(r.text, file=sys.stderr)
            r.raise_for_status()
        print(json.dumps(r.json(), indent=2))
    finally:
        if temp_path is not None and temp_path.is_file():
            temp_path.unlink(missing_ok=True)


def cmd_create_template(
    base: str,
    local_key: Optional[str],
    name: str,
    tools_path: Path,
    description: Optional[str],
) -> None:
    tools = _load_tools_file(tools_path)
    body: Dict[str, Any] = {"name": name, "tools": tools}
    if description:
        body["description"] = description
    r = requests.post(
        f"{base}/tool-templates",
        headers=_local_headers(local_key),
        json=body,
        timeout=60,
    )
    if r.status_code not in (200, 201):
        print(r.text, file=sys.stderr)
        r.raise_for_status()
    data = r.json()
    print(json.dumps(data, indent=2))
    tpl = data.get("template") or data
    tid = tpl.get("id") if isinstance(tpl, dict) else None
    if tid is not None:
        print(f"Created template id={tid}", file=sys.stderr)


def cmd_recover(
    base: str,
    key: Optional[str],
    stop_live_feeds: bool,
    probe_capture: bool,
) -> None:
    body: Dict[str, Any] = {
        "stopLiveFeeds": stop_live_feeds,
        "probeCapture": probe_capture,
    }
    r = requests.post(
        f"{base}/remote/camera/recover",
        headers=_remote_headers(key),
        json=body,
        timeout=120,
    )
    if r.status_code != 200:
        print(r.text, file=sys.stderr)
        r.raise_for_status()
    data = r.json()
    print(json.dumps(data, indent=2))
    ok = data.get("ok", data.get("success"))
    if ok is not False:
        print("Camera recover OK", file=sys.stderr)
    else:
        print(f"Camera recover reported failure: {data.get('error', data)}", file=sys.stderr)


def cmd_delete_program(
    base: str,
    remote_key: Optional[str],
    local_key: Optional[str],
    program_id: int,
) -> None:
    r = requests.delete(
        f"{base}/remote/programs/{program_id}",
        headers=_remote_headers(remote_key),
        timeout=120,
    )
    if r.status_code in (401, 403) and local_key:
        r = requests.delete(
            f"{base}/programs/{program_id}",
            headers=_local_headers(local_key),
            timeout=120,
        )
    if r.status_code not in (200, 204, 404):
        print(r.text, file=sys.stderr)
        r.raise_for_status()
    if r.text.strip():
        try:
            print(json.dumps(r.json(), indent=2))
        except ValueError:
            print(r.text)
    print(f"Deleted program #{program_id}", file=sys.stderr)


def cmd_run_once(base: str, key: Optional[str], program_id: int, no_image: bool) -> None:
    body: Dict[str, Any] = {
        "programId": program_id,
        "triggerType": "remote",
        "includeImage": not no_image,
    }
    r = requests.post(
        f"{base}/remote/inspection/run-once",
        headers=_remote_headers(key),
        json=body,
        timeout=120,
    )
    if r.status_code != 200:
        print(r.text, file=sys.stderr)
        r.raise_for_status()
    data = r.json()
    img = data.pop("image", None)
    print(json.dumps(data, indent=2))
    status = data.get("status") or data.get("result")
    if status:
        print(f"Result: {status}", file=sys.stderr)
    if img and not no_image:
        out = f"inspection_p{program_id}_{int(time.time())}.jpg"
        raw = base64.b64decode(img)
        Path(out).write_bytes(raw)
        print(f"Saved image: {out}", file=sys.stderr)


def cmd_socket_loop(base_http: str, key: Optional[str], program_id: int, continuous: bool, fps: int) -> None:
    try:
        import socketio
    except ImportError:
        print("Install: pip install -r scripts/requirements-master-client.txt", file=sys.stderr)
        sys.exit(1)

    root = base_http.rstrip("/")
    if root.endswith("/api") or root.endswith("/api/v1"):
        root = root.rsplit("/", 1)[0]

    sio = socketio.Client(logger=False, engineio_logger=False)

    @sio.event
    def connect():
        print("Socket.IO connected", file=sys.stderr)

    @sio.event
    def disconnect():
        print("Socket.IO disconnected", file=sys.stderr)

    @sio.on("inspection_result")
    def on_result(data: Dict[str, Any]):
        d = dict(data)
        if "image" in d and len(str(d.get("image", ""))) > 80:
            d["image"] = f"<base64 len={len(str(data.get('image')))}>"
        print("inspection_result:", json.dumps(d, indent=2))

    @sio.on("live_frame")
    def on_frame(data: Dict[str, Any]):
        print(
            "live_frame",
            data.get("frameNumber"),
            "fps",
            data.get("fps"),
            "latencyMs",
            data.get("latencyMs"),
            file=sys.stderr,
        )

    @sio.on("error")
    def on_error(data: Dict[str, Any]):
        print("error:", data, file=sys.stderr)

    hdr: Dict[str, str] = {}
    if key:
        hdr["X-Vision-Remote-Key"] = key
    connect_kw: Dict[str, Any] = {
        "socketio_path": "/socket.io/",
        "transports": ["websocket", "polling"],
    }
    if hdr:
        connect_kw["headers"] = hdr
    if key:
        connect_kw["auth"] = {"remoteKey": key}
    sio.connect(root, **connect_kw)

    sio.emit("start_inspection", {"programId": program_id, "continuous": continuous})
    sio.emit("subscribe_live_feed", {"fps": max(1, min(60, fps))})

    try:
        if continuous:
            print("Running until Ctrl+C (continuous inspection + live feed)...", file=sys.stderr)
            sio.wait()
        else:
            print("Waiting for single inspection + frames (10 s)...", file=sys.stderr)
            time.sleep(10.0)
    except KeyboardInterrupt:
        pass
    finally:
        sio.emit("unsubscribe_live_feed")
        sio.emit("stop_inspection")
        sio.disconnect()


def main(argv: Optional[List[str]] = None) -> int:
    _load_backend_dotenv()
    default_base = _default_base_url()

    p = argparse.ArgumentParser(description="Vision inspection slave — remote master client")
    p.add_argument(
        "--base-url",
        default=default_base,
        help=f"REST prefix (default {default_base})",
    )
    p.add_argument(
        "--key",
        default=_default_remote_key(),
        help="X-Vision-Remote-Key (VISION_REMOTE_KEY)",
    )
    p.add_argument(
        "--local-key",
        default=_default_local_key(),
        help="X-Vision-Local-Key (VISION_LOCAL_KEY) for capture / master-image / templates",
    )
    sub = p.add_subparsers(dest="cmd", required=True)

    sub.add_parser("ping", help="GET /health")
    sub.add_parser("check", help="GET /remote/info (connectivity + remote auth)")
    sub.add_parser("info", help="Alias for check")
    sub.add_parser("programs", help="List programs")

    cap = sub.add_parser("capture", help="POST /camera/capture")
    cap.add_argument("--out", required=True, type=Path, help="Output image path")

    reg = sub.add_parser("register-master", help="Capture (or --image) + POST /master-image")
    reg.add_argument("program_id", type=int)
    reg.add_argument("--image", type=Path, help="Use existing image instead of live capture")

    tpl = sub.add_parser("create-template", help="POST /tool-templates")
    tpl.add_argument("name")
    tpl.add_argument("--tools", required=True, type=Path, help="JSON file: tools array or {tools:[...]}")
    tpl.add_argument("--description", default=None)

    rec = sub.add_parser(
        "recover",
        help="POST /remote/camera/recover (stop live feeds, restart IMX296, probe capture)",
    )
    rec.add_argument(
        "--no-stop-live-feeds",
        action="store_true",
        help="Do not stop stuck Socket.IO live feeds first",
    )
    rec.add_argument(
        "--no-probe-capture",
        action="store_true",
        help="Skip test frame after reopening the camera",
    )

    del_p = sub.add_parser("delete-program", help="DELETE /remote/programs/:id")
    del_p.add_argument("program_id", type=int)

    r1 = sub.add_parser("run-once", help="POST /remote/inspection/run-once")
    r1.add_argument("program_id", type=int)
    r1.add_argument("--no-image", action="store_true", help="JSON only, no base64 image")

    sk = sub.add_parser("socket", help="Socket.IO: continuous or single inspection + live feed")
    sk.add_argument("program_id", type=int)
    sk.add_argument("--single", action="store_true", help="Single shot (waits ~10s)")
    sk.add_argument("--fps", type=int, default=12)

    args = p.parse_args(argv)
    base = args.base_url.rstrip("/")
    remote_key = args.key
    local_key = args.local_key

    print(f"Using {base}" + (" (remote key set)" if remote_key else ""), file=sys.stderr)
    if local_key:
        print("(local key set)", file=sys.stderr)

    try:
        if args.cmd == "ping":
            cmd_ping(base)
        elif args.cmd in ("check", "info"):
            cmd_check(base, remote_key)
        elif args.cmd == "programs":
            cmd_programs(base, remote_key, local_key)
        elif args.cmd == "capture":
            cmd_capture(base, local_key, args.out)
        elif args.cmd == "register-master":
            cmd_register_master(base, local_key, args.program_id, args.image)
        elif args.cmd == "create-template":
            cmd_create_template(base, local_key, args.name, args.tools, args.description)
        elif args.cmd == "recover":
            cmd_recover(
                base,
                remote_key,
                stop_live_feeds=not args.no_stop_live_feeds,
                probe_capture=not args.no_probe_capture,
            )
        elif args.cmd == "delete-program":
            cmd_delete_program(base, remote_key, local_key, args.program_id)
        elif args.cmd == "run-once":
            cmd_run_once(base, remote_key, args.program_id, args.no_image)
        elif args.cmd == "socket":
            cmd_socket_loop(base, remote_key, args.program_id, continuous=not args.single, fps=args.fps)
        return 0
    except requests.ConnectionError as e:
        _explain_connection_error(base, e)
        return 1
    except requests.RequestException as e:
        print(e, file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
