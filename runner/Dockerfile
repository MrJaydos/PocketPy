# The Phase 2 server-side runner: a minimal Python image that runs untrusted
# challenge code in throwaway subprocesses. The real isolation is applied at the
# container level in docker-compose.yaml (non-root, read-only rootfs, no network
# egress, cgroup memory/pids limits); this image just keeps the surface tiny.

FROM python:3.12-slim

# No bytecode writes (rootfs is read-only in production) and unbuffered logs.
ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PORT=8000

WORKDIR /app

# Only two stdlib-only Python files — no third-party dependencies to install.
# (To offer real packages later, add a requirements.txt and a pip install here.)
COPY server.py sandbox.py ./

# Run as a non-root user.
RUN useradd --uid 1001 --create-home runner
USER runner

EXPOSE 8000

# Liveness check using only the stdlib (no curl in the image).
HEALTHCHECK --interval=30s --timeout=5s --start-period=5s --retries=3 \
  CMD python -c "import urllib.request,sys; sys.exit(0 if urllib.request.urlopen('http://127.0.0.1:8000/healthz').status==200 else 1)"

CMD ["python", "server.py"]
