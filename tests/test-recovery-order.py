#!/usr/bin/env python3

from pathlib import Path
import subprocess
import tempfile

source = Path("scripts/apply-integrated.sh").read_text()
marker = "recover_integrated_state() {"

assert source.count(marker) == 1

start = source.index(marker)
end = source.index("\n}\n", start) + 3

function = source[start:end]

# Replace Android command only inside the simulated function.
original = '/system/bin/sh "$XIAOMI" SET NORMAL'
assert function.count(original) == 1
function = function.replace(original, "mock_normal", 1)

# No actual waiting in the test environment.
assert function.count("sleep 0.2") == 1
function = function.replace("sleep 0.2", ":", 1)


def run_case(name, normal_ok=True, policy_ready=True,
             io_ok=True, cpu_ok=True, xiaomi_ok=True,
             snapshot_complete="yes", expected="RECOVERY=OK",
             expected_events=None):

    with tempfile.TemporaryDirectory(prefix="hearthroot-recovery-") as tmp:
        root = Path(tmp)
        governor = root / "scaling_governor"
        events = root / "events.log"

        if policy_ready:
            governor.write_text("schedutil\n")

        script = root / "test.sh"

        script.write_text(
            function + f'''

xiaomi_ready="yes"
snapshot_complete="{snapshot_complete}"
cpu_snapshot="{governor}:schedutil"
EVENTS="{events}"

mock_normal() {{
    echo NORMAL >> "$EVENTS"
    return {0 if normal_ok else 1}
}}

restore_io_state() {{
    echo IO >> "$EVENTS"
    return {0 if io_ok else 1}
}}

restore_cpu_state() {{
    echo CPU >> "$EVENTS"
    return {0 if cpu_ok else 1}
}}

restore_xiaomi() {{
    echo XIAOMI_RESTORE >> "$EVENTS"
    return {0 if xiaomi_ok else 1}
}}

recover_integrated_state
'''
        )

        result = subprocess.run(
            ["/bin/sh", str(script)],
            capture_output=True,
            text=True,
            timeout=15,
        )

        output = result.stdout + result.stderr
        actual_events = (
            events.read_text().splitlines()
            if events.exists() else []
        )

        expected_rc = 0 if expected == "RECOVERY=OK" else 1

        passed = (
            result.returncode == expected_rc
            and expected in output
            and actual_events == expected_events
        )

        print(f"{'PASS' if passed else 'FAIL'}: {name}")

        if not passed:
            print("  Exit:", result.returncode)
            print("  Output:", output.strip())
            print("  Events:", actual_events)
            print("  Expected:", expected_events)

        return passed


results = [
    run_case(
        "Full recovery and correct order",
        expected_events=["NORMAL", "IO", "CPU", "XIAOMI_RESTORE"]
    ),
    run_case(
        "NORMAL fails but IO still restores",
        normal_ok=False,
        expected="RECOVERY=PARTIAL",
        expected_events=["NORMAL", "IO", "XIAOMI_RESTORE"]
    ),
    run_case(
        "CPU policy unavailable but IO restores",
        policy_ready=False,
        expected="RECOVERY=PARTIAL",
        expected_events=["NORMAL", "IO", "XIAOMI_RESTORE"]
    ),
    run_case(
        "IO restoration fails",
        io_ok=False,
        expected="RECOVERY=PARTIAL",
        expected_events=["NORMAL", "IO", "CPU", "XIAOMI_RESTORE"]
    ),
    run_case(
        "CPU restoration fails",
        cpu_ok=False,
        expected="RECOVERY=PARTIAL",
        expected_events=["NORMAL", "IO", "CPU", "XIAOMI_RESTORE"]
    ),
    run_case(
        "Xiaomi restoration fails",
        xiaomi_ok=False,
        expected="RECOVERY=PARTIAL",
        expected_events=["NORMAL", "IO", "CPU", "XIAOMI_RESTORE"]
    ),
    run_case(
        "Incomplete snapshot",
        snapshot_complete="no",
        expected="RECOVERY=PARTIAL",
        expected_events=["NORMAL", "IO", "CPU", "XIAOMI_RESTORE"]
    ),
]

print()
print(f"RECOVERY_ORDER_TESTS={sum(results)}/{len(results)}")

raise SystemExit(0 if all(results) else 1)
