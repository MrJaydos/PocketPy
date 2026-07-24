"""
Sandbox child process. The runner server spawns one of these PER REQUEST with
`python3 -I -B sandbox.py <result_path>` and feeds it {"code", "tests"} as JSON on
stdin. It runs the user's code + tests, then writes the result as JSON to
`result_path` — a channel the user's code cannot reach.

Why a separate process (not exec in the server): a crash, an infinite loop, or a
resource-limit kill takes down only this throwaway process, and the parent can kill
the whole process group on timeout.

Isolation layers (defence in depth):
  - The CONTAINER is the real boundary: non-root, read-only rootfs, no network
    egress (internal compose network), cgroup memory/pids limits. See runner/Dockerfile
    and docker-compose.yaml.
  - This process adds CPU-time and file-size rlimits as a backstop, and the parent
    enforces a wall-clock timeout by killing the process group.

We deliberately do NOT set RLIMIT_AS: it caps virtual address space (not real memory),
which breaks legitimate imports; the container cgroup mem_limit is the real memory bound.
"""

import io
import json
import resource
import sys


def set_limits():
    """Backstop resource limits (the container enforces the real ones)."""
    # CPU seconds — a hard stop even if the parent's wall-clock timer somehow misses.
    _set(resource.RLIMIT_CPU, 8)
    # Cap the size of any single file the code writes (bytes).
    _set(resource.RLIMIT_FSIZE, 5_000_000)
    # Limit processes/threads to blunt fork bombs (container pids_limit also caps).
    _set(resource.RLIMIT_NPROC, 64)


def _set(which, value):
    try:
        resource.setrlimit(which, (value, value))
    except (ValueError, OSError):
        # Some limits aren't settable in every environment; the container still caps us.
        pass


def friendly_error(exc):
    """A short one-liner like 'NameError: name 'x' is not defined'."""
    return f"{type(exc).__name__}: {exc}"


def main():
    result_path = sys.argv[1]
    payload = json.loads(sys.stdin.read())
    code = payload.get("code", "")
    tests = payload.get("tests", "")

    set_limits()

    # The check() harness — identical semantics to the in-browser worker, so both
    # runners report results the same way.
    results = []

    def check(cond, msg=""):
        results.append({"ok": bool(cond), "msg": str(msg)})

    namespace = {"check": check}
    error = None

    # Capture stdout so user print() output can be shown — and, crucially, so it does
    # NOT mix into the result channel (we write JSON to result_path, never to stdout).
    real_stdout = sys.stdout
    buffer = io.StringIO()
    sys.stdout = buffer
    try:
        try:
            exec(code, namespace)  # noqa: S102 - running user code is the whole point
        except BaseException as exc:  # includes SyntaxError and resource signals
            error = friendly_error(exc)
        if error is None and tests:
            try:
                exec(tests, namespace)  # noqa: S102
            except BaseException as exc:
                error = friendly_error(exc)
    finally:
        sys.stdout = real_stdout

    stdout = buffer.getvalue()
    if len(stdout) > 10_000:  # don't hand back a multi-MB payload from a print loop
        stdout = stdout[:10_000] + "\n...(output truncated)"

    # "Passed" needs at least one assertion that actually ran (mirrors the worker's
    # guard against a vacuous all([]) marking an empty/errored run as solved).
    passed = error is None and len(results) > 0 and all(r["ok"] for r in results)

    out = {"stdout": stdout, "stderr": "", "results": results, "passed": passed, "error": error}
    with open(result_path, "w", encoding="utf-8") as f:
        json.dump(out, f)


if __name__ == "__main__":
    main()
