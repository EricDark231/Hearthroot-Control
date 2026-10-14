#!/usr/bin/env python3

from pathlib import Path
import subprocess
import tempfile

source = Path("scripts/apply-integrated.sh").read_text()
start = "recover_integrated_state() {"

assert source.count(start) == 1

begin = source.index(start)
end = source.index("\n}\n", begin) + 3

function = source[begin:end]

# Replace Android-specific execution only in the test copy.
function = function.replace(
    '/system/bin/sh "$XIAOMI" SET NORMAL',
    'mock_xiaomi_normal'
)

# Avoid real waiting during tests.
function = function.replace("sleep 0.2", ":")


def test(name, normal_ok, policy_ready, restore_ok, expected):
    with tempfile.TemporaryDirectory(prefix="hearthroot-xiaomi-") as tmp:
        path = Path(tmp) / "test.sh"

        # The governor path is fictitious and exists only in this sandbox.
        governor = Path(tmp) / "scaling_governor"

        if policy_ready:
            governor.write_text("schedutil\n")

        script = function + f'''

xiaomi_ready="yes"
snapshot_complete="yes"
cpu_snapshot="{governor}:schedutil"

mock_xiaomi_normal() {{
    return {0 if normal_ok else 1}
}}

restore_io_state() {{
    return 0
}}

restore_cpu_state() {{
    return 0
}}

restore_xiaomi() {{
    return {0 if restore_ok else 1}
}}

recover_integrated_state
'''

        path.write_text(script)

        result = subprocess.run(
            ["/bin/sh", str(path)],
            capture_output=True,
            text=True,
            timeout=15,
        )

        output = result.stdout + result.stderr
        expected_rc = 0 if expected == "RECOVERY=OK" else 1

        passed = (
            expected in output
            and result.returncode == expected_rc
        )

        print(f"{'PASS' if passed else 'FAIL'}: {name}")

        if not passed:
            print(output)
            print("exit:", result.returncode)

        return passed


results = [
    test(
        "Xiaomi NORMAL and restore successful",
        True, True, True, "RECOVERY=OK"
    ),
    test(
        "Xiaomi NORMAL preparation fails",
        False, True, True, "RECOVERY=PARTIAL"
    ),
    test(
        "CPU policy unavailable",
        True, False, True, "RECOVERY=PARTIAL"
    ),
    test(
        "Original Xiaomi mode restoration fails",
        True, True, False, "RECOVERY=PARTIAL"
    ),
]

print()
print(f"XIAOMI_TESTS_PASSED={sum(results)}/{len(results)}")

raise SystemExit(0 if all(results) else 1)
