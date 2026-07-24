"""
The runner service: a tiny HTTP server (Python stdlib only — no framework, minimal
attack surface) that executes challenge code in a throwaway subprocess and returns
the result as JSON.

Only reachable from the app backend on the internal Docker network — never exposed
through the tunnel. See docker-compose.yaml and NOTES.md.

Endpoints:
  GET  /healthz  -> {"status": "ok"}
  POST /run      -> body {"code": str, "tests": str} -> result JSON
                    (tests may be "" for a plain Run with no grading)
"""

import json
import os
import signal
import subprocess
import sys
import tempfile
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

HERE = os.path.dirname(os.path.abspath(__file__))
SANDBOX = os.path.join(HERE, "sandbox.py")
PORT = int(os.environ.get("PORT", "8000"))
WALL_CLOCK_TIMEOUT = float(os.environ.get("RUN_TIMEOUT_SECONDS", "10"))
MAX_BODY_BYTES = 200_000  # generous cap on a code+tests payload


def _kill_group(proc):
    """SIGKILL the whole process group so forked grandchildren die too."""
    try:
        os.killpg(os.getpgid(proc.pid), signal.SIGKILL)
    except (ProcessLookupError, PermissionError):
        pass
    try:
        proc.wait(timeout=2)
    except subprocess.TimeoutExpired:
        pass


def run_sandboxed(code, tests):
    """Run code (+ optional tests) in an isolated subprocess and return the result."""
    # The child writes its JSON result here — a channel user code can't reach, so a
    # stray print() in the solution can't corrupt what we parse.
    fd, result_path = tempfile.mkstemp(suffix=".json")
    os.close(fd)
    try:
        payload = json.dumps({"code": code, "tests": tests}).encode("utf-8")
        # -I isolated mode (ignore env/user site), -B no bytecode (rootfs is read-only).
        # start_new_session=True puts the child in its own process group so a timeout
        # can kill the whole group, not just the direct child.
        proc = subprocess.Popen(
            [sys.executable, "-I", "-B", SANDBOX, result_path],
            stdin=subprocess.PIPE,
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
            start_new_session=True,
        )
        try:
            proc.communicate(payload, timeout=WALL_CLOCK_TIMEOUT)
        except subprocess.TimeoutExpired:
            _kill_group(proc)
            return {
                "status": "timeout",
                "stdout": "",
                "stderr": "",
                "results": [],
                "passed": False,
                "error": None,
            }

        try:
            with open(result_path, encoding="utf-8") as f:
                data = json.load(f)
        except (FileNotFoundError, json.JSONDecodeError):
            # No result file => the child crashed or was killed (e.g. out of memory).
            return {
                "status": "error",
                "stdout": "",
                "stderr": "",
                "results": [],
                "passed": False,
                "error": "The program was stopped (it may have run out of memory).",
            }
        data["status"] = "ok"
        return data
    finally:
        try:
            os.unlink(result_path)
        except OSError:
            pass


class Handler(BaseHTTPRequestHandler):
    def _send(self, code, obj):
        body = json.dumps(obj).encode("utf-8")
        self.send_response(code)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self):
        if self.path == "/healthz":
            self._send(200, {"status": "ok"})
        else:
            self._send(404, {"error": "not found"})

    def do_POST(self):
        if self.path != "/run":
            return self._send(404, {"error": "not found"})
        try:
            length = int(self.headers.get("Content-Length", 0))
        except ValueError:
            return self._send(400, {"error": "bad length"})
        if length > MAX_BODY_BYTES:
            return self._send(413, {"error": "payload too large"})

        raw = self.rfile.read(length)
        try:
            data = json.loads(raw)
        except json.JSONDecodeError:
            return self._send(400, {"error": "invalid json"})

        code = data.get("code", "")
        tests = data.get("tests", "")
        if not isinstance(code, str) or not isinstance(tests, str):
            return self._send(400, {"error": "code and tests must be strings"})

        self._send(200, run_sandboxed(code, tests))

    def log_message(self, *args):  # keep the container logs quiet
        pass


def main():
    server = ThreadingHTTPServer(("0.0.0.0", PORT), Handler)
    print(f"runner listening on :{PORT}", flush=True)
    server.serve_forever()


if __name__ == "__main__":
    main()
