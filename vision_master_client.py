#!/usr/bin/env python3
"""
Control a Vision Inspection slave Raspberry Pi from a master over Ethernet.

REST (programs, one-shot inspection with image):
  Base URL examples:
    Dev backend:   http://VISION_PI:5000/api
    Production:    http://VISION_PI:5000/api/v1

Socket.IO (continuous inspection, live frames — same host/port as REST, path /socket.io/):
  sio.connect("http://VISION_PI:5000", socketio_path="/socket.io/")

Environment:
  VISION_SLAVE_URL   Base URL (default http://127.0.0.1:5000/api)
  VISION_REMOTE_KEY  Optional; sent as X-Vision-Remote-Key when set
"""

from __future__ import annotations

import argparse
import base64
import json
import os
import sys
import time
from typing import Any, Dict, List, Optional

try:
    import requests
except ImportError:
    print("Install requests: pip install requests", file=sys.stderr)
    sys.exit(1)


def _headers(key: Optional[str]) -> Dict[str, str]:
    h = {"Content-Type": "application/json"}
    if key:
        h["X-Vision-Remote-Key"] = key
    return h


def cmd_info(base: str, key: Optional[str]) -> None:
    r = requests.get(f"{base}/remote/info", headers=_headers(key), timeout=15)
    r.raise_for_status()
    print(json.dumps(r.json(), indent=2))


def cmd_programs(base: str, key: Optional[str]) -> None:
    r = requests.get(f"{base}/programs?active_only=true", headers=_headers(key), timeout=30)
    r.raise_for_status()
    data = r.json()
    for p in data.get("programs", []):
        print(f"{p.get('id')}\t{p.get('name')}")


def cmd_run_once(base: str, key: Optional[str], program_id: int, no_image: bool) -> None:
    body: Dict[str, Any] = {
        "programId": program_id,
        "triggerType": "remote",
        "includeImage": not no_image,
    }
    r = requests.post(
        f"{base}/remote/inspection/run-once",
        headers=_headers(key),
        json=body,
        timeout=120,
    )
    if r.status_code != 200:
        print(r.text, file=sys.stderr)
        r.raise_for_status()
    data = r.json()
    img = data.pop("image", None)
    print(json.dumps(data, indent=2))
    if img and not no_image:
        out = f"inspection_p{program_id}_{int(time.time())}.jpg"
        raw = base64.b64decode(img)
        with open(out, "wb") as f:
            f.write(raw)
        print(f"Saved image: {out}", file=sys.stderr)


def cmd_socket_loop(base_http: str, key: Optional[str], program_id: int, continuous: bool, fps: int) -> None:
    try:
        import socketio
    except ImportError:
        print('Install: pip install "python-socketio[client]"', file=sys.stderr)
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
    p = argparse.ArgumentParser(description="Vision inspection slave — remote master client")
    p.add_argument(
        "--base-url",
        default=os.environ.get("VISION_SLAVE_URL", "http://127.0.0.1:5000/api"),
        help="REST prefix e.g. http://IP:5000/api or .../api/v1",
    )
    p.add_argument(
        "--key",
        default=os.environ.get("VISION_REMOTE_KEY") or None,
        help="X-Vision-Remote-Key (if slave has remote.api_key / VISION_REMOTE_API_KEY)",
    )
    sub = p.add_subparsers(dest="cmd", required=True)

    sub.add_parser("info", help="GET /remote/info — discovery")
    sub.add_parser("programs", help="List programs")

    r1 = sub.add_parser("run-once", help="POST /remote/inspection/run-once")
    r1.add_argument("program_id", type=int)
    r1.add_argument("--no-image", action="store_true", help="JSON only, no base64 image")

    sk = sub.add_parser("socket", help="Socket.IO: continuous or single inspection + live feed")
    sk.add_argument("program_id", type=int)
    sk.add_argument("--single", action="store_true", help="Single shot (waits ~10s)")
    sk.add_argument("--fps", type=int, default=12)

    args = p.parse_args(argv)
    base = args.base_url.rstrip("/")
    key = args.key

    try:
        if args.cmd == "info":
            cmd_info(base, key)
        elif args.cmd == "programs":
            cmd_programs(base, key)
        elif args.cmd == "run-once":
            cmd_run_once(base, key, args.program_id, args.no_image)
        elif args.cmd == "socket":
            cmd_socket_loop(base, key, args.program_id, continuous=not args.single, fps=args.fps)
        return 0
    except requests.RequestException as e:
        print(e, file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
