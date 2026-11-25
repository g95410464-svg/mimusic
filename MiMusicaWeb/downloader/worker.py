"""Single-song import worker. Shares job files, never Navidrome credentials."""
import hashlib
import json
import os
from pathlib import Path
import re
import shutil
import signal
import subprocess
import tempfile
import time

QUEUE = Path(os.environ.get("IMPORT_STORE_PATH", "/jobs"))
MUSIC = Path(os.environ.get("MUSIC_PATH", "/music"))
MAX_BYTES = 100 * 1024 * 1024
JOB_ID = re.compile(r"[a-f0-9-]{36}")
stopping = False


def atomic_json(path, value):
    temporary = path.with_suffix(path.suffix + ".tmp")
    temporary.write_text(json.dumps(value, ensure_ascii=False), encoding="utf-8")
    temporary.chmod(0o600)
    temporary.replace(path)


def heartbeat():
    temporary = QUEUE / "heartbeat.tmp"
    temporary.write_text(str(int(time.time() * 1000)), encoding="ascii")
    temporary.replace(QUEUE / "heartbeat")


def command_for(source, directory):
    kind, value = source["kind"], source["value"]
    if kind == "spotify":
        if not re.fullmatch(r"https://open\.spotify\.com/track/[a-zA-Z0-9]{22}", value):
            raise ValueError("Enlace de Spotify no válido.")
        return ["spotdl", "download", value, "--output", str(directory / "audio.{output-ext}"),
                "--format", "mp3", "--bitrate", "192k", "--threads", "1", "--headless",
                "--simple-tui", "--log-level", "ERROR", "--max-retries", "1", "--max-filename-length", "140",
                "--yt-dlp-args", "--max-filesize 100M --socket-timeout 20 --retries 2 --no-playlist", "--lyrics"]
    if kind == "youtube":
        if not re.fullmatch(r"https://www\.youtube\.com/watch\?v=[\w-]{11}", value):
            raise ValueError("Enlace de YouTube no válido.")
    elif kind == "search":
        if not isinstance(value, str) or not 2 <= len(value) <= 500 or re.search(r"[\x00-\x1f]", value):
            raise ValueError("La búsqueda no es válida.")
        value = "ytsearch1:" + value
    else:
        raise ValueError("Fuente no admitida.")
    return ["yt-dlp", "--ignore-config", "--no-plugin-dirs", "--no-playlist", "--playlist-end", "1",
            "--no-progress", "--no-warnings", "--socket-timeout", "20", "--retries", "2", "--fragment-retries", "2",
            "--max-filesize", "100M", "--match-filters", "duration <= 1200 & !is_live",
            "-f", "bestaudio/best", "-x", "--audio-format", "mp3", "--audio-quality", "192K",
            "--embed-metadata", "--embed-thumbnail", "--convert-thumbnails", "jpg",
            "--trim-filenames", "140", "-o", str(directory / "audio.%(ext)s"), "--", value]


def safe_error(log):
    lower = log.lower()
    if any(word in lower for word in ["sign in", "sign-in", "bot", "captcha", "login required"]):
        return "La fuente exige iniciar sesión o verificar el acceso. Prueba otro enlace público."
    if any(word in lower for word in ["429", "rate limit", "too many requests"]):
        return "La fuente limitó las solicitudes. Espera unos minutos y vuelve a intentarlo."
    if any(word in lower for word in ["private video", "unavailable", "not found", "no results"]):
        return "No se encontró una canción disponible. Comprueba el enlace o añade el artista al nombre."
    return "No se pudo obtener el audio. Prueba un enlace directo de YouTube o vuelve a intentarlo más tarde."


def inspect_audio(path):
    result = subprocess.run(["ffprobe", "-v", "error", "-show_entries", "format=duration:format_tags=title,artist", "-of", "json", str(path)],
                            capture_output=True, timeout=15, check=True)
    metadata = json.loads(result.stdout)["format"]
    duration = float(metadata["duration"])
    if not 0 < duration <= 1200 or not 0 < path.stat().st_size <= MAX_BYTES:
        raise ValueError("La canción debe durar menos de 20 minutos y ocupar menos de 100 MB.")
    return metadata.get("tags", {})


def publish_audio(source, audio):
    metadata = inspect_audio(audio)
    suffix = hashlib.sha256(source["value"].encode()).hexdigest()[:12]
    title = metadata.get("title") or source.get("label") or audio.stem
    if metadata.get("artist"):
        title = metadata["artist"] + " - " + title
    title = re.sub(r"[^\w .()\[\]-]", "_", title, flags=re.UNICODE).strip(". ")[:140] or "Canción"
    destination = MUSIC / f"{title} - {suffix}.mp3"
    # The final extension appears only after the complete file is on the destination filesystem.
    temporary = MUSIC / f".{suffix}.partial"
    try:
        shutil.copyfile(audio, temporary)
        temporary.chmod(0o644)
        temporary.replace(destination)
    finally:
        temporary.unlink(missing_ok=True)
    return destination.name


def run_job(job, runner=subprocess.Popen, publisher=publish_audio):
    path = QUEUE / f"{job['id']}.result.json"
    def status(state, message, **extra):
        atomic_json(path, {"status": state, "message": message, "updatedAt": int(time.time() * 1000), **extra})
    status("downloading", "Buscando y descargando el audio en el servidor…")
    try:
        if shutil.disk_usage(MUSIC).free < 512 * 1024 * 1024:
            raise ValueError("El servidor necesita al menos 512 MB libres para descargar.")
        with tempfile.TemporaryDirectory(prefix="mimusic-", dir="/tmp") as work:
            directory = Path(work)
            command = command_for(job["source"], directory)
            log_path = directory / "download.log"
            with log_path.open("wb") as log:
                process = runner(command, stdout=log, stderr=subprocess.STDOUT, cwd=directory, start_new_session=True)
                started = time.monotonic()
                try:
                    while process.poll() is None:
                        heartbeat()
                        if stopping:
                            raise ValueError("La descarga se interrumpió al reiniciar el servidor. Vuelve a enviarla.")
                        if time.monotonic() - started > 600:
                            raise ValueError("La fuente tardó más de diez minutos. Vuelve a intentarlo.")
                        if sum(p.stat().st_size for p in directory.rglob("*") if p.is_file()) > 250 * 1024 * 1024:
                            raise ValueError("La descarga supera el tamaño permitido para una canción.")
                        time.sleep(2)
                finally:
                    if process.poll() is None:
                        os.killpg(process.pid, signal.SIGKILL)
                        process.wait()
            audio = list(directory.glob("*.mp3"))
            if process.returncode != 0 or len(audio) != 1:
                raise ValueError(safe_error(log_path.read_text(encoding="utf-8", errors="replace")[-16000:]))
            filename = publisher(job["source"], audio[0])
            status("completed", "Guardada en el servidor. Actualiza la biblioteca para verla en Navidrome.", filename=filename)
    except ValueError as error:
        status("failed", str(error))
    except Exception:
        status("failed", "No se pudo terminar la descarga. Comprueba el espacio y el servicio del servidor.")


def stop(_signal, _frame):
    global stopping
    stopping = True


def main():
    os.umask(0o077)
    QUEUE.mkdir(parents=True, exist_ok=True)
    MUSIC.mkdir(parents=True, exist_ok=True)
    Path(os.environ.get("HOME", "/tmp/home")).mkdir(parents=True, exist_ok=True)
    for sig in [signal.SIGTERM, signal.SIGINT]:
        signal.signal(sig, stop)
    # A process cannot survive a container restart; don't leave its job stuck forever.
    for result in QUEUE.glob("*.result.json"):
        try:
            if json.loads(result.read_text())["status"] == "downloading":
                atomic_json(result, {"status": "failed", "message": "El servidor se reinició durante la descarga. Vuelve a enviarla."})
        except (ValueError, KeyError, OSError):
            continue
    while not stopping:
        heartbeat()
        jobs = []
        for path in QUEUE.glob("*.json"):
            if not JOB_ID.fullmatch(path.stem):
                continue
            result_path = QUEUE / f"{path.stem}.result.json"
            try:
                job = json.loads(path.read_text(encoding="utf-8"))
                if job.get("id") != path.stem:
                    continue
                if result_path.exists():
                    # Keep the latest month of history; music itself is never removed.
                    if time.time() * 1000 - job["createdAt"] > 30 * 86400000:
                        path.unlink()
                        result_path.unlink()
                    continue
                jobs.append(job)
            except (ValueError, KeyError, OSError):
                continue
        if jobs:
            run_job(min(jobs, key=lambda job: job["createdAt"]))
        else:
            time.sleep(2)
    (QUEUE / "heartbeat").unlink(missing_ok=True)


if __name__ == "__main__":
    main()
