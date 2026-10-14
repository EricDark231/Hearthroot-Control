#!/usr/bin/env python3

from pathlib import Path
import subprocess
import tempfile

SOURCE = Path("scripts/apply-integrated.sh").read_text()

START = "recover_integrated_state() {"
END = "\n}\n"

assert SOURCE.count(START) == 1, "Recovery function missing or duplicated"

function_start = SOURCE.index(START)
function_end = SOURCE.index(END, function_start) + len(END)

RECOVERY_FUNCTION = SOURCE[function_start:function_end]


def run_case(name, kernel_success, snapshot_complete, expected):
    with tempfile.TemporaryDirectory(prefix="hearthroot-test-") as temp:
        script = Path(temp) / "test.sh"

        script.write_text(
            RECOVERY_FUNCTION
            + "\n"
            + 'xiaomi_ready="no"\n'
            + f'snapshot_complete="{snapshot_complete}"\n'
            + f'''
restore_io_state() {{
    return 0
}}

restore_cpu_state() {{
    return {0 if kernel_success else 1}
}}

restore_xiaomi() {{
    return 0
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
        passed = expected in output and (
            (result.returncode == 0) == (expected == "RECOVERY=OK")
        )

        print(f"{'PASS' if passed else 'FAIL'}: {name}")
        print(f"  exit={result.returncode}")
        print(f"  result={expected if passed else output.strip()}")

        return passed


results = [
    run_case(
        "Successful kernel recovery",
        kernel_success=True,
        snapshot_complete="yes",
        expected="RECOVERY=OK",
    ),
    run_case(
        "Kernel restoration failure",
        kernel_success=False,
        snapshot_complete="yes",
        expected="RECOVERY=PARTIAL",
    ),
    run_case(
        "Incomplete original snapshot",
        kernel_success=True,
        snapshot_complete="no",
        expected="RECOVERY=PARTIAL",
    ),
]

print()
print(f"TESTS_PASSED={sum(results)}/{len(results)}")

raise SystemExit(0 if all(results) else 1)
