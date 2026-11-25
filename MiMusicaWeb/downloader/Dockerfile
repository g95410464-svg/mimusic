FROM denoland/deno:bin AS deno
FROM python:3.13-slim-bookworm
COPY --from=deno /deno /usr/local/bin/deno
RUN apt-get update && apt-get install -y --no-install-recommends ffmpeg ca-certificates \
    && rm -rf /var/lib/apt/lists/*
COPY requirements.txt /app/requirements.txt
RUN pip install --no-cache-dir -r /app/requirements.txt
RUN useradd --uid 1000 --create-home worker \
    && mkdir -p /jobs /music \
    && chown worker:worker /jobs /music \
    && chmod 700 /jobs
COPY worker.py /app/worker.py
USER worker
ENV PYTHONUNBUFFERED=1 PYTHONDONTWRITEBYTECODE=1 HOME=/tmp/home XDG_CACHE_HOME=/tmp/cache
WORKDIR /app
CMD ["python", "worker.py"]
