#!/usr/bin/env python3
"""Run dedicated calibration_pwm firmware; save commanded PWM at switch edges.

Requires pyserial. This never flashes firmware or updates production calibration.
The serial port and HOME seed pulses must be explicitly supplied.
"""
import argparse
import datetime
import json
from pathlib import Path
import time


def fields(line):
    return dict(token.split('=', 1) for token in line.split()[1:] if '=' in token)


def run(args, serial_factory=None):
    checking = getattr(args, 'check_lower', False)
    lower_us = getattr(args, 'lower_us', None)
    positioning = lower_us is not None
    if serial_factory is None:
        import serial
        serial_factory = serial.Serial
    stamp = datetime.datetime.now(datetime.timezone.utc).strftime('%Y%m%dT%H%M%SZ')
    args.output.mkdir(parents=True, exist_ok=True)
    path = args.output / ('pwm-calibration-' + stamp + '.json')
    transcript = args.output / ('pwm-calibration-' + stamp + '.jsonl')
    report = {'firmware': 'calibration-pwm-1.0.4', 'port': args.port,
              'axis': 'L' if checking or positioning else args.axis,
              'home_seeds_us': None if checking or positioning else [args.upper_home, args.lower_home],
              'measurement': 'commanded pulse; no measured angle' if positioning else 'commanded pulse width at debounced limit-switch edge',
              'ok': False, 'edges': []}
    ser = serial_factory()
    ser.port = args.port
    ser.baudrate = 115200
    ser.timeout = 0.05
    ser.write_timeout = 0.5
    ser.dtr = False
    ser.rts = False
    started = completed = False
    receive = bytearray()

    def send(command):
        ser.write((command + '\n').encode('ascii'))
        ser.flush()

    def read_line():
        # Preserve partial lines across serial read timeouts.
        if b'\n' not in receive:
            receive.extend(ser.read(max(1, min(ser.in_waiting, 256))))
        if len(receive) > 4096:
            raise RuntimeError('Serial response exceeded limit')
        if b'\n' not in receive:
            return None
        line, _, rest = receive.partition(b'\n')
        receive[:] = rest
        return line.decode('ascii', errors='replace').strip()

    try:
        with transcript.open('x') as log:
            def record(line):
                log.write(json.dumps({'utc': datetime.datetime.now(datetime.timezone.utc).isoformat(),
                                      'line': line}) + '\n')
                log.flush()
                print(line, flush=True)

            ser.open()
            # Adapter reset is possible even with DTR disabled. Identify the
            # firmware after boot, before allowing any motion command.
            time.sleep(2)
            send('INFO')
            deadline = time.monotonic() + 4
            identified = False
            while time.monotonic() < deadline:
                line = read_line()
                if line:
                    record(line)
                    if line.startswith('INFO calibration-pwm-1.0.4 '):
                        identified = True
                        break
            if not identified:
                raise RuntimeError('Dedicated calibration firmware did not identify itself')
            command = f'LOWER_US {lower_us}' if positioning else ('CHECK_LOWER' if checking else f'CAL {args.axis} {args.upper_home} {args.lower_home}')
            report['command'] = command
            record('TX ' + command)
            started = True  # Also send STOP if delivery/acknowledgement fails.
            send(command)
            deadline = time.monotonic() + args.timeout
            next_ping = 0
            while time.monotonic() < deadline:
                if time.monotonic() >= next_ping:
                    send('PING')
                    next_ping = time.monotonic() + 0.25
                line = read_line()
                if not line:
                    continue
                record(line)
                if line.startswith('READY '):
                    raise RuntimeError('Controller reset during calibration')
                if line.startswith('ERR '):
                    raise RuntimeError(line)
                if line.startswith('EDGE '):
                    report['edges'].append(fields(line))
                if positioning and line.startswith('POSITION_RESULT '):
                    result = fields(line)
                    report['result'] = result
                    report['ok'] = (result.get('ok') == '1' and result.get('pl') == str(lower_us)
                                    and result.get('attached') == '-1'
                                    and result.get('reason') == 'pulse_complete')
                    completed = True
                    break
                if checking and line.startswith('CHECK_RESULT '):
                    result = fields(line)
                    report['result'] = result
                    report['ok'] = (result.get('ok') == '1' and
                                    result.get('attached') == '-1' and
                                    result.get('reason') in ('home_pressed', 'home_released'))
                    completed = True
                    break
                if line.startswith('RESULT '):
                    result = fields(line)
                    report['result'] = result
                    expected_mask = {'U': '1', 'L': '2', 'BOTH': '3'}[args.axis]
                    valid = result.get('mask') == expected_mask and result.get('ok') == '1'
                    for axis, key in [('U', 'upper_valid'), ('L', 'lower_valid')]:
                        if args.axis in (axis, 'BOTH'):
                            valid = valid and result.get(key) == '1'
                    report['ok'] = bool(valid)
                    completed = True
                    break
            if not completed:
                raise RuntimeError('Calibration response timed out')
    except (Exception, KeyboardInterrupt) as exc:
        report['error'] = str(exc) or 'Interrupted'
    finally:
        if started and not completed and ser.is_open:
            try:
                send('STOP')
            except Exception:
                pass  # Firmware independently stops after 1.5 s without PING.
        if ser.is_open:
            ser.close()
        report['finished_at_utc'] = datetime.datetime.now(datetime.timezone.utc).isoformat()
        with path.open('x') as output:
            json.dump(report, output, indent=2)
            output.write('\n')
        print(f'Record: {path}', flush=True)
    return 0 if report['ok'] else 1


def pulse(value):
    number = int(value)
    if not 544 <= number <= 2400:
        raise argparse.ArgumentTypeError('Pulse must be within 544..2400 us')
    return number


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--port', required=True)
    mode = parser.add_mutually_exclusive_group(required=True)
    mode.add_argument('--axis', choices=['U', 'L'])
    mode.add_argument('--check-lower', action='store_true', help='Check lower HOME during a bounded 2400-to-544 us sweep')
    mode.add_argument('--lower-us', type=pulse, help='Command lower PWM for up to one second; stop on either lower limit')
    parser.add_argument('--upper-home', type=pulse)
    parser.add_argument('--lower-home', type=pulse)
    parser.add_argument('--output', type=Path, default=Path('captures'))
    parser.add_argument('--timeout', type=float, default=150)
    args = parser.parse_args()
    if args.axis and (args.upper_home is None or args.lower_home is None):
        parser.error('--axis requires --upper-home and --lower-home')
    if not 1 <= args.timeout <= 300:
        parser.error('--timeout must be between 1 and 300 seconds')
    return run(args)


if __name__ == '__main__':
    raise SystemExit(main())
