#!/usr/bin/env python3
"""Exercise all Double Actuator Centring Slave terminal commands over TCP.

Uses a persistent session with keepalive (Python sockets — nc not required).

Examples (from repo root):
  python3 scripts/test_all_commands.py --smoke-only
  python3 scripts/test_all_commands.py
  python3 scripts/test_all_commands.py --calibrate
  python3 scripts/test_all_commands.py --no-move
"""

from __future__ import annotations

import argparse
import json
import math
import sys
import time
from dataclasses import dataclass, field
from pathlib import Path
from typing import Callable, Dict, List, Optional

sys.path.insert(0, str(Path(__file__).resolve().parent))

from slave_tcp import (  # noqa: E402
    DEFAULT_SETCAL,
    SlaveTcp,
    Status,
    add_common_args,
)

# #region agent log
_DEBUG_LOG = Path(__file__).resolve().parents[1] / ".cursor" / "debug-e09303.log"
_DEBUG_SESSION = "e09303"


def _agent_log(
    hypothesis_id: str,
    location: str,
    message: str,
    data: Dict,
    run_id: str = "pre-fix",
) -> None:
    """Append one NDJSON debug line for session e09303."""
    try:
        _DEBUG_LOG.parent.mkdir(parents=True, exist_ok=True)
        payload = {
            "sessionId": _DEBUG_SESSION,
            "runId": run_id,
            "hypothesisId": hypothesis_id,
            "location": location,
            "message": message,
            "data": data,
            "timestamp": int(time.time() * 1000),
        }
        with _DEBUG_LOG.open("a", encoding="utf-8") as f:
            f.write(json.dumps(payload, separators=(",", ":")) + "\n")
    except OSError:
        pass


def _kin_predict(
    pu: int,
    pl: int,
    target_h: float,
    move_upper: bool,
    move_lower: bool,
    *,
    hu: int = 1950,
    tu: int = 1100,
    hl: int = 1501,
    tl: int = 731,
) -> Dict:
    """Host-side replica of firmware height→pulse / limit-dir for SETCAL defaults."""
    a, b, c = 4.67687625, -0.176873, 0.00197035
    s_home, s_travel = -80.0, 35.0
    d_s = s_travel - s_home
    at = a + b * s_home + c * s_home * s_home
    bt = (b + 2.0 * c * s_home) * d_s
    ct = c * d_s * d_s

    def h_of_t(t: float) -> float:
        return at + bt * t + ct * t * t

    def us_to_t(u_h: int, u_t: int, us: int) -> float:
        span = u_h - u_t
        if span <= 0:
            return 0.0
        return max(0.0, min(1.0, (u_h - us) / float(span)))

    def t_to_us(u_h: int, u_t: int, t: float) -> int:
        t = max(0.0, min(1.0, t))
        return int(u_h - t * (u_h - u_t) + 0.5)

    def solve_t(hp: float, t_cur: float) -> float:
        aa, bb, cc = ct, bt, at - hp
        roots: List[float] = []
        if abs(aa) < 1e-9:
            if abs(bb) >= 1e-9:
                roots.append(-cc / bb)
        else:
            disc = bb * bb - 4.0 * aa * cc
            if disc >= 0.0:
                s = math.sqrt(disc)
                roots.append((-bb + s) / (2.0 * aa))
                roots.append((-bb - s) / (2.0 * aa))
        best = None
        best_d = 1e30
        for t in roots:
            if -1e-4 <= t <= 1.0 + 1e-4:
                tc = max(0.0, min(1.0, t))
                d = abs(tc - t_cur)
                if d < best_d:
                    best_d = d
                    best = tc
        if best is not None:
            return best
        mid = 0.5 * (h_of_t(0.0) + h_of_t(1.0))
        return 0.0 if hp >= mid else 1.0

    t_u = us_to_t(hu, tu, pu)
    t_l = us_to_t(hl, tl, pl)
    h_u = h_of_t(t_u)
    h_l = h_of_t(t_l)
    side_lo, side_hi = h_of_t(1.0), h_of_t(0.0)
    model_h = target_h
    hp_u, hp_l = h_u, h_l
    if move_upper and move_lower:
        hp_u = hp_l = model_h * 0.5
    elif move_upper:
        hp_u = model_h - h_l
    elif move_lower:
        hp_l = model_h - h_u

    out_of_band = not (1.80 <= target_h <= 62.874)  # approx defaults
    per_side = False
    if move_upper and not (side_lo <= hp_u <= side_hi):
        per_side = True
    if move_lower and not (side_lo <= hp_l <= side_hi):
        per_side = True

    tgt_u = t_to_us(hu, tu, solve_t(hp_u, t_u)) if move_upper and not per_side else pu
    tgt_l = t_to_us(hl, tl, solve_t(hp_l, t_l)) if move_lower and not per_side else pl
    d_u = tgt_u - pu
    d_l = tgt_l - pl

    return {
        "curPu": pu,
        "curPl": pl,
        "hU": round(h_u, 4),
        "hL": round(h_l, 4),
        "H": round(h_u + h_l, 4),
        "hpU": round(hp_u, 4),
        "hpL": round(hp_l, 4),
        "sideLo": round(side_lo, 4),
        "sideHi": round(side_hi, 4),
        "perSideRange": per_side,
        "outOfBand": out_of_band,
        "tgtU": tgt_u,
        "tgtL": tgt_l,
        "deltaU": d_u,
        "deltaL": d_l,
        "dirU": "TowardHome" if d_u > 0 else ("TowardTravel" if d_u < 0 else "none"),
        "dirL": "TowardHome" if d_l > 0 else ("TowardTravel" if d_l < 0 else "none"),
    }


def _dbg_status(tag: str, hypothesis_id: str, st: Status, **extra: object) -> None:
    data = {
        "tag": tag,
        "pu": st.int("pu"),
        "pl": st.int("pl"),
        "uh": st.int("uh"),
        "ut": st.int("ut"),
        "lh": st.int("lh"),
        "lt": st.int("lt"),
        "h": st.get("h"),
        "busy": st.int("busy"),
        "accepted": st.int("accepted"),
        "reason": st.get("reason"),
        "moveEnd": st.get("moveEnd"),
        "cal": st.int("cal") if st.get("cal") is not None else st.int("calValid"),
        "calValid": st.int("calValid"),
        "lastCmd": st.get("lastCmd"),
        "targetH": st.get("targetH"),
    }
    data.update(extra)
    _agent_log(hypothesis_id, "test_all_commands.py:dbg", tag, data)


# #endregion agent log


@dataclass
class CheckResult:
    name: str
    ok: bool
    detail: str = ""


@dataclass
class Suite:
    results: List[CheckResult] = field(default_factory=list)

    def check(self, name: str, ok: bool, detail: str = "") -> bool:
        self.results.append(CheckResult(name, ok, detail))
        mark = "PASS" if ok else "FAIL"
        suffix = f" — {detail}" if detail else ""
        print(f"[{mark}] {name}{suffix}", flush=True)
        return ok

    def require(self, name: str, ok: bool, detail: str = "") -> None:
        if not self.check(name, ok, detail):
            raise AssertionError(f"{name}: {detail or 'failed'}")

    def summary(self) -> int:
        n_ok = sum(1 for r in self.results if r.ok)
        n = len(self.results)
        print(f"\n=== {n_ok}/{n} checks passed ===", flush=True)
        for r in self.results:
            if not r.ok:
                print(f"  FAIL: {r.name}: {r.detail}", flush=True)
        return 0 if n_ok == n else 1


def expect_status(
    suite: Suite,
    name: str,
    st: Status,
    *,
    accepted: Optional[bool] = None,
    reason: Optional[str] = None,
    busy: Optional[bool] = None,
    cal_valid: Optional[bool] = None,
    last_cmd: Optional[str] = None,
    extra: Optional[Callable[[Status], Optional[str]]] = None,
) -> Status:
    bits: List[str] = []
    ok = True
    if accepted is not None and st.accepted() != accepted:
        ok = False
        bits.append(f"accepted={st.get('accepted')} want {int(accepted)}")
    if reason is not None and st.get("reason") != reason:
        ok = False
        bits.append(f"reason={st.get('reason')!r} want {reason!r}")
    if busy is not None and st.busy() != busy:
        ok = False
        bits.append(f"busy={st.get('busy')} want {int(busy)}")
    if cal_valid is not None and st.int("calValid") != int(cal_valid):
        ok = False
        bits.append(f"calValid={st.get('calValid')} want {int(cal_valid)}")
    if last_cmd is not None and st.get("lastCmd") != last_cmd:
        ok = False
        bits.append(f"lastCmd={st.get('lastCmd')!r} want {last_cmd!r}")
    if extra is not None:
        msg = extra(st)
        if msg:
            ok = False
            bits.append(msg)
    detail = "; ".join(bits) if bits else st.raw[:120]
    suite.check(name, ok, detail)
    return st


def _mech_near(st: Status, want: float, tol: float = 0.05) -> Optional[str]:
    try:
        got = float(st.get("mechOff", "nan"))
    except ValueError:
        return f"mechOff={st.get('mechOff')!r}"
    if abs(got - want) > tol:
        return f"mechOff={got} want {want}"
    return None


def run_suite(args: argparse.Namespace) -> int:
    suite = Suite()
    motion_timeout = args.timeout

    print(
        f"Connecting to {args.host}:{args.port}"
        f"  (smoke_only={args.smoke_only}, calibrate={args.calibrate},"
        f" move={not args.no_move})",
        flush=True,
    )

    try:
        with SlaveTcp(args.host, args.port, verbose=not args.quiet) as client:
            suite.require(
                "A connect greeting READY/PING",
                client.greeting == ["READY", "PING"],
                repr(client.greeting),
            )

            # --- A. Query / offset / estop / unknown ---
            st, _, _ = client.command("PING", wait_busy=False)
            expect_status(
                suite, "A PING", st, accepted=True, reason="ok", last_cmd="PING"
            )

            st, _, _ = client.command("STATUS", wait_busy=False)
            expect_status(
                suite,
                "A STATUS",
                st,
                accepted=True,
                reason="ok",
                last_cmd="STATUS",
                extra=lambda s: None
                if "u" in s.fields and "l" in s.fields and "h" in s.fields
                else "missing u=/l=/h=",
            )

            st, _, _ = client.command("STATUS mechOff=0", wait_busy=False)
            expect_status(
                suite,
                "A STATUS mechOff=0",
                st,
                accepted=True,
                reason="ok",
                extra=lambda s: _mech_near(s, 0.0),
            )

            st, _, _ = client.command("PING mechOff=1.5", wait_busy=False)
            expect_status(
                suite,
                "A PING mechOff=1.5",
                st,
                accepted=True,
                reason="ok",
                extra=lambda s: _mech_near(s, 1.5),
            )

            st, _, _ = client.command("SETMECHOFF 0", wait_busy=False)
            expect_status(
                suite,
                "SETMECHOFF 0",
                st,
                accepted=True,
                reason="ok",
                last_cmd="SETMECHOFF",
                extra=lambda s: _mech_near(s, 0.0),
            )

            st, _, _ = client.command("SETMECHOFF 2.5", wait_busy=False)
            expect_status(
                suite,
                "SETMECHOFF 2.5",
                st,
                accepted=True,
                reason="ok",
                extra=lambda s: _mech_near(s, 2.5),
            )
            client.command("SETMECHOFF 0", wait_busy=False)

            st, _, _ = client.command("CLEARESTOP", wait_busy=False)
            suite.check(
                "CLEARESTOP",
                st.get("lastCmd") == "CLEARESTOP"
                and st.get("reason") in ("ok", "estop"),
                st.raw[:120],
            )
            if st.int("estop") == 1:
                suite.check(
                    "estop clear",
                    False,
                    "estop=1 — release panel button ≥200 ms, then re-run",
                )
                return suite.summary()

            st, _, _ = client.command("NOT_A_COMMAND", wait_busy=False)
            expect_status(
                suite,
                "unknown command → reason=unknown",
                st,
                accepted=False,
                reason="unknown",
            )

            if args.smoke_only:
                print(
                    "\n--smoke-only: skipping HOME / SETCAL / MOVE / CALIBRATE",
                    flush=True,
                )
                return suite.summary()

            # --- B. HOME then MOVE blocked if no cal ---
            print("\n--- B. HOME then MOVE expect nocal (if calValid=0) ---", flush=True)
            # #region agent log
            st_pre_home, _, _ = client.command("STATUS", wait_busy=False)
            _dbg_status("pre_B_HOME", "H1", st_pre_home)
            # #endregion agent log
            st, _, _ = client.command(
                "HOME", wait_busy=True, timeout_s=motion_timeout
            )
            # #region agent log
            _dbg_status(
                "post_B_HOME",
                "H1",
                st,
                pulseUnchanged=(
                    st.int("pu") == st_pre_home.int("pu")
                    and st.int("pl") == st_pre_home.int("pl")
                ),
                homeAlreadyActive=(
                    st_pre_home.int("uh") == 1 and st_pre_home.int("lh") == 1
                ),
                instantHomeLikely=(
                    st_pre_home.int("uh") == 1
                    and st_pre_home.int("lh") == 1
                    and st.int("pu") == st_pre_home.int("pu")
                    and st.get("moveEnd") == "ok"
                ),
            )
            # #endregion agent log
            expect_status(
                suite,
                "B HOME complete",
                st,
                busy=False,
                extra=lambda s: None
                if s.get("moveEnd") in ("ok", "home_fail")
                else f"moveEnd={s.get('moveEnd')}",
            )
            if st.get("moveEnd") != "ok":
                suite.check(
                    "B HOME seek ok",
                    False,
                    f"moveEnd={st.get('moveEnd')}",
                )
                print("HOME failed — aborting motion remainder", flush=True)
                return suite.summary()

            suite.check("B HOME seek ok", True, f"moveEnd={st.get('moveEnd')}")

            cal_on = st.int("cal") if st.get("cal") is not None else st.int("calValid")
            if cal_on == 0:
                st_mv, _, _ = client.command(
                    "MOVEBOTHMM 40", wait_busy=False, timeout_s=motion_timeout
                )
                expect_status(
                    suite,
                    "B MOVEBOTHMM before cal → nocal",
                    st_mv,
                    accepted=False,
                    reason="nocal",
                )
            else:
                suite.check(
                    "B MOVEBOTHMM before cal → nocal",
                    True,
                    "skipped (calValid already 1)",
                )

            # --- C. Load cal (prefer hardware CALIBRATE) + HOME + MOVE*MM ---
            move_h = 40.0
            if args.calibrate:
                print(
                    "\n--- C. CALIBRATE (hardware switch edges) + MOVE ---",
                    flush=True,
                )
                st, extras, cal = client.command(
                    "CALIBRATE", wait_busy=True, timeout_s=motion_timeout
                )
                has_cal = cal is not None or any(
                    e.startswith("CAL_RESULT") for e in extras
                )
                suite.check("C CAL_RESULT line", has_cal, cal or "(missing)")
                expect_status(
                    suite,
                    "C CALIBRATE complete",
                    st,
                    busy=False,
                    extra=lambda s: None
                    if s.get("moveEnd") in ("ok", "cal_fail")
                    and (
                        s.get("moveEnd") != "ok"
                        or (
                            s.int("calValid") == 1
                            and s.get("calId") == "meas-v1"
                        )
                    )
                    else (
                        f"moveEnd={s.get('moveEnd')} "
                        f"calValid={s.get('calValid')} calId={s.get('calId')}"
                    ),
                )
                if st.get("moveEnd") == "ok" and st.int("calValid") == 1:
                    suite.check(
                        "C measured pulses on STATUS",
                        st.int("hu") < st.int("tu")
                        and st.int("hl") < st.int("tl"),
                        f"hu={st.get('hu')} tu={st.get('tu')} "
                        f"hl={st.get('hl')} tl={st.get('tl')}",
                    )
                    # Success requires real TRAVEL switch capture (not soft floor).
                    suite.check(
                        "C TRAVEL switches were used",
                        st.int("tu") > 900 or st.int("tl") > 900
                        or st.int("ut") == 1
                        or st.int("lt") == 1,
                        f"tu={st.get('tu')} tl={st.get('tl')} "
                        f"ut={st.get('ut')} lt={st.get('lt')}",
                    )
                elif st.get("moveEnd") == "cal_fail":
                    print(
                        "NOTE: CALIBRATE needs TRAVEL switches (UT/LT). "
                        "Check D4/A0 wiring and that jaws close onto them.",
                        flush=True,
                    )
                    if args.sethends is not None:
                        h_home, h_travel = args.sethends
                        st, _, _ = client.command(
                            f"SETHENDS {h_home} {h_travel}",
                            wait_busy=False,
                        )
                        expect_hmin = 2.0 * h_travel
                        expect_hmax = 2.0 * h_home
                        expect_status(
                            suite,
                            "C SETHENDS",
                            st,
                            accepted=True,
                            reason="ok",
                            extra=lambda s: None
                            if abs(float(s.get("hmin", "nan")) - expect_hmin)
                            < 0.05
                            and abs(float(s.get("hmax", "nan")) - expect_hmax)
                            < 0.05
                            else (
                                f"hmin={s.get('hmin')} want {expect_hmin:.2f} "
                                f"hmax={s.get('hmax')} want {expect_hmax:.2f}"
                            ),
                        )
                        # Mid-band target after gauge remap.
                        move_h = 0.5 * (expect_hmin + expect_hmax)
                else:
                    print(
                        "CALIBRATE failed — skipping MOVE remainder",
                        flush=True,
                    )
                    return suite.summary()
            else:
                print(
                    "\n--- C. SETCAL placeholders + HOME + MOVE "
                    "(prefer --calibrate on hardware) ---",
                    flush=True,
                )
                st, _, _ = client.command(DEFAULT_SETCAL, wait_busy=False)
                expect_status(
                    suite,
                    "C SETCAL",
                    st,
                    accepted=True,
                    reason="ok",
                    cal_valid=True,
                    last_cmd="SETCAL",
                    extra=lambda s: None
                    if s.get("calId") == "unit_01"
                    else f"calId={s.get('calId')!r}",
                )

            st, _, _ = client.command(
                "HOME", wait_busy=True, timeout_s=motion_timeout
            )
            expect_status(
                suite,
                "C HOME after cal",
                st,
                busy=False,
                extra=lambda s: None
                if s.get("moveEnd") == "ok"
                else f"moveEnd={s.get('moveEnd')}",
            )

            if not args.no_move and st.get("moveEnd") == "ok":
                hu = st.int("hu")
                tu = st.int("tu")
                hl = st.int("hl")
                tl = st.int("tl")
                pred40 = _kin_predict(
                    st.int("pu"),
                    st.int("pl"),
                    move_h,
                    True,
                    True,
                    hu=hu,
                    tu=tu,
                    hl=hl,
                    tl=tl,
                )
                st, _, _ = client.command(
                    f"MOVEBOTHMM {move_h:.2f}",
                    wait_busy=True,
                    timeout_s=motion_timeout,
                )
                expect_status(
                    suite,
                    f"C MOVEBOTHMM {move_h:.2f}",
                    st,
                    accepted=True,
                    busy=False,
                    extra=lambda s: None
                    if s.get("moveEnd") == "ok"
                    else f"moveEnd={s.get('moveEnd')} reason={s.get('reason')}",
                )

                st, _, _ = client.command("MOVEBOTHMM 999", wait_busy=False)
                expect_status(
                    suite,
                    "C MOVEBOTHMM 999 → range",
                    st,
                    accepted=False,
                    reason="range",
                )

                # Closing move toward TRAVEL (inside default band).
                close_h = max(10.0, float(st.get("hmin", "1.80")) + 0.5)
                st, _, _ = client.command(
                    "HOME", wait_busy=True, timeout_s=motion_timeout
                )
                st, _, _ = client.command(
                    f"MOVEBOTHMM {close_h:.2f}",
                    wait_busy=True,
                    timeout_s=motion_timeout,
                )
                expect_status(
                    suite,
                    f"C MOVEBOTHMM {close_h:.2f}",
                    st,
                    accepted=True,
                    busy=False,
                    extra=lambda s: None
                    if s.get("moveEnd") == "ok"
                    else f"moveEnd={s.get('moveEnd')} reason={s.get('reason')}",
                )
                _ = pred40  # host-side sanity retained for debug runs
            elif args.no_move:
                print("--no-move: skipping MOVE*MM", flush=True)

            print("\n--- single-axis HOME ---", flush=True)
            st, _, _ = client.command(
                "HOME_UPPER", wait_busy=True, timeout_s=motion_timeout
            )
            expect_status(
                suite,
                "HOME_UPPER",
                st,
                busy=False,
                extra=lambda s: None
                if s.get("moveEnd") == "ok"
                else f"moveEnd={s.get('moveEnd')}",
            )
            st, _, _ = client.command(
                "HOME_LOWER", wait_busy=True, timeout_s=motion_timeout
            )
            expect_status(
                suite,
                "HOME_LOWER",
                st,
                busy=False,
                extra=lambda s: None
                if s.get("moveEnd") == "ok"
                else f"moveEnd={s.get('moveEnd')}",
            )

            if args.calibrate and args.calibrate_alias:
                print("\n--- D. CALIBRATION alias ---", flush=True)
                st, extras, cal = client.command(
                    "CALIBRATION",
                    wait_busy=True,
                    timeout_s=motion_timeout,
                )
                suite.check(
                    "D CALIBRATION alias",
                    st.get("lastCmd") == "CALIBRATION",
                    st.raw[:120],
                )
            elif not args.calibrate:
                print(
                    "\n(pass --calibrate for hardware pulse measure; "
                    "optional --sethends HHOME HTRAVEL)",
                    flush=True,
                )

            st, _, _ = client.command("STATUS", wait_busy=False)
            suite.check(
                "final STATUS",
                st.accepted() and st.get("reason") == "ok",
                st.raw[:120],
            )

    except (
        OSError,
        TimeoutError,
        RuntimeError,
        ConnectionError,
        AssertionError,
    ) as e:
        suite.check("suite exception", False, str(e))
        return suite.summary()

    return suite.summary()


def main(argv: Optional[List[str]] = None) -> int:
    p = argparse.ArgumentParser(
        description="Test all slave terminal commands over TCP"
    )
    add_common_args(p)
    p.add_argument(
        "--smoke-only",
        action="store_true",
        help="only PING/STATUS/SETMECHOFF/CLEARESTOP/unknown (no motion)",
    )
    p.add_argument(
        "--calibrate",
        action="store_true",
        help="measure pulses via CALIBRATE (preferred on hardware vs SETCAL placeholders)",
    )
    p.add_argument(
        "--calibrate-alias",
        action="store_true",
        help="also run CALIBRATION alias after --calibrate",
    )
    p.add_argument(
        "--sethends",
        nargs=2,
        type=float,
        metavar=("HHOME", "HTRAVEL"),
        help="after CALIBRATE, send SETHENDS <per-side mm at HOME> <at TRAVEL>",
    )
    p.add_argument(
        "--no-move",
        action="store_true",
        help="skip MOVE*MM after cal/HOME",
    )
    p.add_argument(
        "--timeout",
        type=float,
        default=90.0,
        help="motion wait timeout seconds (default %(default)s)",
    )
    args = p.parse_args(argv)
    if args.calibrate_alias and not args.calibrate:
        p.error("--calibrate-alias requires --calibrate")
    if args.sethends is not None and not args.calibrate:
        p.error("--sethends requires --calibrate")
    if args.sethends is not None and not (args.sethends[0] > args.sethends[1]):
        p.error("--sethends requires HHOME > HTRAVEL")
    t0 = time.monotonic()
    rc = run_suite(args)
    print(f"elapsed {time.monotonic() - t0:.1f}s", flush=True)
    return rc


if __name__ == "__main__":
    sys.exit(main())
