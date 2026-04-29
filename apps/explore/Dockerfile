# Issue #607: optional Jupyter-based DB exploration environment.
# Opt-in via the `explore` Compose profile; no production impact.
FROM python:3.11-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1 \
    JUPYTER_PLATFORM_DIRS=1

# psycopg2-binary needs libpq at runtime (and gcc at build time when not using
# the binary wheel — the binary wheel covers x86_64/aarch64 musl/glibc, which
# is fine for our common targets).
RUN apt-get update \
    && apt-get install -y --no-install-recommends curl \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /workspace

COPY requirements.txt /tmp/requirements.txt
RUN pip install --no-cache-dir -r /tmp/requirements.txt

EXPOSE 8888

# Bind to 0.0.0.0 inside the container; the published port on the host is
# locked to 127.0.0.1 in docker-compose.yml so the server is not reachable
# off-machine. Jupyter generates a random token on each start (printed in
# logs); --ServerApp.root_dir keeps everything sandboxed under /workspace.
CMD ["jupyter", "lab", \
     "--ip=0.0.0.0", \
     "--port=8888", \
     "--no-browser", \
     "--allow-root", \
     "--ServerApp.root_dir=/workspace", \
     "--ServerApp.allow_origin=*"]
