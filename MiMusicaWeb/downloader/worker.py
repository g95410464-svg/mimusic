"""Song, album, and playlist import worker. Shares job files, never Navidrome credentials."""
from concurrent.futures import ThreadPoolExecutor
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
import urllib.request

QUEUE = Path(os.environ.get("IMPORT_STORE_PATH", "/jobs"))
MUSIC = Path(os.environ.get("MUSIC_PATH", "/music"))
MAX_BYTES = 100 * 1024 * 1024
MAX_TRACK_DURATION = 1800
MAX_COLLECTION_TRACKS = 100
COLLECTION_KINDS = {"spotify-album", "spotify-playlist", "youtube-playlist"}
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


def safe_segment(text, fallback="Colección", limit=110):
    cleaned = re.sub(r"[^\w .()\[\]-]", "_", str(text or ""), flags=re.UNICODE)
    cleaned = re.sub(r"\.{2,}", "_", cleaned).strip("._ ")[:limit]
    return cleaned or fallback


def run_with_heartbeat(fn, timeout_seconds=60):
    with ThreadPoolExecutor(max_workers=1) as pool:
        future = pool.submit(fn)
        started = time.monotonic()
        while not future.done():
            heartbeat()
            if stopping:
                raise ValueError("La descarga se interrumpió al reiniciar el servidor. Vuelve a enviarla.")
            if time.monotonic() - started > timeout_seconds:
                raise ValueError("La fuente tardó demasiado en responder con la lista de canciones. Vuelve a intentarlo.")
            time.sleep(1)
        return future.result()


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
            "--max-filesize", "100M", "--match-filters", f"duration <= {MAX_TRACK_DURATION} & !is_live",
            "-f", "bestaudio/best", "-x", "--audio-format", "mp3", "--audio-quality", "192K",
            "--embed-metadata", "--embed-thumbnail", "--convert-thumbnails", "jpg",
            "--trim-filenames", "140", "-o", str(directory / "audio.%(ext)s"), "--", value]


def safe_error(log):
    lower = log.lower()
    if any(word in lower for word in ["sign in", "sign-in", "bot", "captcha", "login required"]):
        return "La fuente exige iniciar sesión o verificar el acceso. Prueba otro enlace público."
    if any(word in lower for word in ["429", "rate limit", "too many requests"]):
        return "La fuente limitó las solicitudes. Espera unos minutos y vuelve a intentarlo."
    if any(word in lower for word in ["private", "not accessible", "unavailable", "not found", "no results"]):
        return "No se encontró contenido público disponible. Verifica que la canción, álbum o playlist sea pública."
    return "No se pudo obtener el audio. Prueba otro enlace público o vuelve a intentarlo más tarde."


def inspect_audio(path):
    result = subprocess.run(["ffprobe", "-v", "error", "-show_entries", "format=duration:format_tags=title,artist", "-of", "json", str(path)],
                            capture_output=True, timeout=15, check=True)
    metadata = json.loads(result.stdout)["format"]
    duration = float(metadata["duration"])
    if not 0 < duration <= MAX_TRACK_DURATION or not 0 < path.stat().st_size <= MAX_BYTES:
        raise ValueError("Cada canción debe durar menos de 30 minutos y ocupar menos de 100 MB.")
    return metadata.get("tags", {})


def publish_audio(source, audio, destination_dir=None, prefix=""):
    target_dir = destination_dir or MUSIC
    target_dir.mkdir(parents=True, exist_ok=True)
    if target_dir.resolve() != MUSIC.resolve() and MUSIC.resolve() not in target_dir.resolve().parents:
        raise ValueError("Ruta de destino no permitida.")
    metadata = inspect_audio(audio)
    suffix = hashlib.sha256(source["value"].encode()).hexdigest()[:12]
    title = metadata.get("title") or source.get("label") or audio.stem
    if metadata.get("artist") and not title.lower().startswith(metadata["artist"].lower()):
        title = metadata["artist"] + " - " + title
    if prefix:
        title = f"{prefix} - {title}"
    title = safe_segment(title, fallback="Canción", limit=140)
    destination = target_dir / f"{title} - {suffix}.mp3"
    temporary = target_dir / f".{suffix}.partial"
    try:
        shutil.copyfile(audio, temporary)
        temporary.chmod(0o644)
        temporary.replace(destination)
    finally:
        temporary.unlink(missing_ok=True)
    return destination.name


def write_m3u_playlist(directory, playlist_name, filenames):
    if directory.resolve() != MUSIC.resolve() and MUSIC.resolve() not in directory.resolve().parents:
        raise ValueError("Ruta de playlist no permitida.")
    m3u_name = f"{safe_segment(playlist_name, fallback='Playlist', limit=100)}.m3u"
    m3u_path = directory / m3u_name
    temp_path = directory / f".{m3u_name}.tmp"
    clean_title = re.sub(r"[\r\n]+", " ", str(playlist_name or "Playlist")).strip() or "Playlist"
    lines = ["#EXTM3U", f"#PLAYLIST:{clean_title}", *filenames]
    temp_path.write_text("\n".join(lines) + "\n", encoding="utf-8")
    temp_path.chmod(0o644)
    temp_path.replace(m3u_path)
    return m3u_name


def download_cover_image(cover_url, destination):
    if not cover_url or not re.match(r"^https://[a-zA-Z0-9.-]+\.(?:scdn\.co|spotifycdn\.com|ytimg\.com|ggpht\.com)/", cover_url):
        return None
    req = urllib.request.Request(cover_url, headers={"User-Agent": "Mozilla/5.0"})
    with urllib.request.urlopen(req, timeout=15) as resp:
        data = resp.read(5 * 1024 * 1024 + 1)
        if not 0 < len(data) <= 5 * 1024 * 1024:
            return None
        destination.write_bytes(data)
        return destination


def stamp_id3_tags(audio_path, tags, cover_path=None):
    stamped = audio_path.with_name("stamped.mp3")
    cmd = ["ffmpeg", "-y", "-v", "error", "-i", str(audio_path)]
    if cover_path and cover_path.is_file():
        cmd.extend(["-i", str(cover_path), "-map_metadata", "0", "-map", "0:a:0", "-map", "1:v:0", "-c:v", "mjpeg",
                    "-disposition:v:0", "attached_pic", "-metadata:s:v", "title=Album cover", "-metadata:s:v", "comment=Cover (front)"])
    else:
        cmd.extend(["-map_metadata", "0", "-map", "0:a:0", "-map", "0:v?", "-c:v", "copy"])
    cmd.extend(["-c:a", "copy", "-id3v2_version", "3"])
    for key, val in tags.items():
        if val is not None and str(val).strip():
            cmd.extend(["-metadata", f"{key}={str(val).strip()}"])
    cmd.append(str(stamped))
    subprocess.run(cmd, capture_output=True, timeout=30, check=True)
    stamped.replace(audio_path)


def resolve_spotify_collection(source):
    kind, value = source["kind"], source["value"]
    if kind == "spotify-album":
        if not re.fullmatch(r"https://open\.spotify\.com/album/[a-zA-Z0-9]{22}", value):
            raise ValueError("Enlace de álbum de Spotify no válido.")
        album_id = value.rsplit("/", 1)[-1]

        def fetch_album():
            import spotapi
            from SpotipyFree import SpotifyFormatter
            raw = spotapi.PublicAlbum(album_id).get_album_info(limit=MAX_COLLECTION_TRACKS)["data"]["albumUnion"]
            artists = SpotifyFormatter.formatArtists(raw.get("artists", {}).get("items", []))
            tracks = SpotifyFormatter.formatTracks(raw.get("tracksV2", {}).get("items", []))
            return SpotifyFormatter.formatAlbum(raw, artists, tracks)

        album = run_with_heartbeat(fetch_album, timeout_seconds=60)
        album_name = album.get("name") or "Álbum de Spotify"
        album_artist = (album.get("artists") or [{}])[0].get("name") or "Artista"
        release_date = (album.get("release_date") or "")[:10]
        images = [img for img in (album.get("images") or []) if isinstance(img, dict) and img.get("url")]
        cover_url = max(images, key=lambda img: (img.get("width") or 0) * (img.get("height") or 0))["url"] if images else None
        raw_tracks = (album.get("tracks", {}).get("items") or [])[:MAX_COLLECTION_TRACKS]
        tracks = []
        for idx, item in enumerate(raw_tracks, start=1):
            if not isinstance(item, dict) or not item.get("name"):
                continue
            item_artists = [a.get("name") for a in (item.get("artists") or []) if isinstance(a, dict) and a.get("name")]
            artist_str = ", ".join(item_artists) or album_artist
            track_id = item.get("id") or f"{album_id}-{idx}"
            tracks.append({
                "key": f"spotify-track:{track_id}",
                "title": item["name"],
                "artist": artist_str,
                "album": album_name,
                "album_artist": album_artist,
                "track_number": item.get("track_number") or idx,
                "disc_number": item.get("disc_number") or 1,
                "date": release_date if release_date and not release_date.startswith("0000") else "",
                "source": {"kind": "search", "value": f"{artist_str} - {item['name']}", "label": f"{artist_str} - {item['name']}"},
            })
        if not tracks:
            raise ValueError("El álbum de Spotify no contiene canciones disponibles.")
        display = f"{album_artist} — {album_name}" if album_artist else album_name
        return {"kind": kind, "title": display, "folder_group": "Albums", "playlist_m3u": False, "cover_url": cover_url, "tracks": tracks}

    if kind == "spotify-playlist":
        if not re.fullmatch(r"https://open\.spotify\.com/playlist/[a-zA-Z0-9]{22}", value):
            raise ValueError("Enlace de playlist de Spotify no válido.")
        playlist_id = value.rsplit("/", 1)[-1]

        def fetch_playlist():
            import spotapi
            from SpotipyFree import SpotifyFormatter
            client = spotapi.PublicPlaylist(playlist_id)
            raw = client.get_playlist_info(limit=MAX_COLLECTION_TRACKS)["data"]["playlistV2"]
            formatted_meta = SpotifyFormatter.formatPlaylist(dict(raw))
            items = []
            for entry in raw.get("content", {}).get("items", [])[:MAX_COLLECTION_TRACKS]:
                try:
                    items.append(SpotifyFormatter.formatPlaylistTrack(entry)["track"])
                except Exception:
                    continue
            return formatted_meta, items

        playlist_meta, raw_tracks = run_with_heartbeat(fetch_playlist, timeout_seconds=60)
        playlist_name = playlist_meta.get("name") or "Playlist de Spotify"
        images = [img for img in (playlist_meta.get("images") or []) if isinstance(img, dict) and img.get("url")]
        cover_url = max(images, key=lambda img: (img.get("width") or 0) * (img.get("height") or 0))["url"] if images else None
        tracks = []
        for idx, item in enumerate(raw_tracks, start=1):
            if not isinstance(item, dict) or item.get("type") != "track" or not item.get("name"):
                continue
            item_artists = [a.get("name") for a in (item.get("artists") or []) if isinstance(a, dict) and a.get("name")]
            artist_str = ", ".join(item_artists) or "Artista"
            track_id = item.get("id") or f"{playlist_id}-{idx}"
            tracks.append({
                "key": f"spotify-track:{track_id}",
                "title": item["name"],
                "artist": artist_str,
                "album": "",
                "album_artist": "",
                "track_number": idx,
                "disc_number": 1,
                "date": "",
                "source": {"kind": "search", "value": f"{artist_str} - {item['name']}", "label": f"{artist_str} - {item['name']}"},
            })
        if not tracks:
            raise ValueError("La playlist de Spotify está vacía o es privada. Asegúrate de que sea pública.")
        return {"kind": kind, "title": playlist_name, "folder_group": "Playlists", "playlist_m3u": True, "cover_url": cover_url, "tracks": tracks}

    raise ValueError("Colección de Spotify no admitida.")


def resolve_youtube_collection(source):
    value = source["value"]
    if not re.fullmatch(r"https://(?:www\.youtube\.com/playlist\?list=[a-zA-Z0-9_-]{10,128}|music\.youtube\.com/browse/MPREb_[\w-]{8,64})", value):
        raise ValueError("Enlace de playlist o álbum de YouTube no válido.")

    def fetch_yt_list():
        cmd = ["yt-dlp", "--ignore-config", "--no-plugin-dirs", "--flat-playlist", "--dump-single-json",
               "--no-warnings", "--socket-timeout", "20", "--playlist-end", str(MAX_COLLECTION_TRACKS), "--", value]
        proc = subprocess.run(cmd, capture_output=True, text=True, timeout=55, check=True)
        return json.loads(proc.stdout)

    try:
        data = run_with_heartbeat(fetch_yt_list, timeout_seconds=60)
    except subprocess.CalledProcessError as err:
        raise ValueError(safe_error((err.stderr or "") + "\n" + (err.stdout or ""))) from err

    playlist_title = (data.get("title") or "").strip() or "Playlist de YouTube"
    is_album = "OLAK5uy_" in value or "/browse/MPREb_" in value
    entries = (data.get("entries") or [])[:MAX_COLLECTION_TRACKS]
    tracks = []
    for idx, entry in enumerate(entries, start=1):
        if not isinstance(entry, dict):
            continue
        vid = entry.get("id") or ""
        if not re.fullmatch(r"[\w-]{11}", vid):
            continue
        title = (entry.get("title") or "").strip() or f"Pista {idx}"
        if title.lower() in {"[private video]", "[deleted video]"}:
            continue
        uploader = (entry.get(" artist") or entry.get("artist") or entry.get("uploader") or entry.get("channel") or "").replace(" - Topic", "").strip()
        tracks.append({
            "key": f"youtube:{vid}",
            "title": title,
            "artist": uploader,
            "album": playlist_title if is_album else "",
            "album_artist": uploader if is_album else "",
            "track_number": idx,
            "disc_number": 1,
            "date": "",
            "source": {"kind": "youtube", "value": f"https://www.youtube.com/watch?v={vid}", "label": title},
        })
    if not tracks:
        raise ValueError("La playlist o álbum de YouTube no tiene canciones públicas disponibles.")
    return {
        "kind": "youtube-playlist",
        "title": playlist_title,
        "folder_group": "Albums" if is_album else "Playlists",
        "playlist_m3u": not is_album,
        "cover_url": None,
        "tracks": tracks,
    }


def resolve_collection(source):
    if source["kind"] in {"spotify-album", "spotify-playlist"}:
        return resolve_spotify_collection(source)
    if source["kind"] == "youtube-playlist":
        return resolve_youtube_collection(source)
    raise ValueError("Tipo de colección no admitido.")


def execute_track_download(track_source, directory, runner=subprocess.Popen, timeout_seconds=180):
    command = command_for(track_source, directory)
    log_path = directory / "download.log"
    with log_path.open("wb") as log:
        process = runner(command, stdout=log, stderr=subprocess.STDOUT, cwd=directory, start_new_session=True)
        started = time.monotonic()
        try:
            while process.poll() is None:
                heartbeat()
                if stopping:
                    raise ValueError("La descarga se interrumpió al reiniciar el servidor. Vuelve a enviarla.")
                if time.monotonic() - started > timeout_seconds:
                    raise ValueError("La fuente tardó demasiado en descargar la pista.")
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
    return audio[0]


def run_collection_job(job, status, runner=subprocess.Popen, publisher=publish_audio, resolver=resolve_collection):
    status("downloading", "Obteniendo la lista de canciones del álbum o playlist…")
    collection = resolver(job["source"])
    tracks = collection["tracks"][:MAX_COLLECTION_TRACKS]
    total = len(tracks)
    collection_title = collection["title"]
    collection_hash = hashlib.sha256(job["source"]["value"].encode()).hexdigest()[:8]
    dest_dir = MUSIC / collection["folder_group"] / f"{safe_segment(collection_title, limit=90)} - {collection_hash}"
    dest_dir.mkdir(parents=True, exist_ok=True)

    saved_files = []
    failed_count = 0
    pad_width = max(2, len(str(total)))

    with tempfile.TemporaryDirectory(prefix="mimusic-cover-", dir="/tmp") as cover_tmp:
        cover_file = None
        if collection.get("cover_url"):
            try:
                cover_file = download_cover_image(collection["cover_url"], Path(cover_tmp) / "cover.jpg")
            except Exception:
                cover_file = None

        for idx, track in enumerate(tracks, start=1):
            heartbeat()
            if stopping:
                raise ValueError("La descarga se interrumpió al reiniciar el servidor. Vuelve a enviarla.")
            if shutil.disk_usage(MUSIC).free < 512 * 1024 * 1024:
                raise ValueError("El servidor necesita al menos 512 MB libres para continuar descargando.")

            status(
                "downloading",
                f"Descargando canción {idx} de {total}: {track['title']}…",
                title=collection_title,
                progress={"completed": len(saved_files), "current": idx, "total": total},
            )
            try:
                with tempfile.TemporaryDirectory(prefix="mimusic-track-", dir="/tmp") as work:
                    directory = Path(work)
                    audio = execute_track_download(track["source"], directory, runner=runner, timeout_seconds=180)
                    tags = {"title": track["title"], "artist": track["artist"]}
                    if track.get("album"):
                        tags["album"] = track["album"]
                        tags["album_artist"] = track.get("album_artist") or track["artist"]
                        tags["track"] = f"{track['track_number']}/{total}"
                        tags["disc"] = str(track.get("disc_number") or 1)
                    if track.get("date"):
                        tags["date"] = track["date"]
                    try:
                        stamp_id3_tags(audio, tags, cover_path=cover_file if track.get("album") else None)
                    except Exception:
                        pass
                    prefix = str(track["track_number"]).zfill(pad_width)
                    filename = publisher({"value": track["key"], "label": f"{track['artist']} - {track['title']}".strip(" -")}, audio, destination_dir=dest_dir, prefix=prefix)
                    saved_files.append(filename)
                    if collection.get("playlist_m3u"):
                        write_m3u_playlist(dest_dir, collection_title, saved_files)
            except ValueError as err:
                if "reiniciar el servidor" in str(err) or "512 MB" in str(err):
                    raise
                failed_count += 1
            except Exception:
                failed_count += 1

    if not saved_files:
        raise ValueError("No se pudo descargar ninguna canción disponible de este álbum o playlist.")

    if collection.get("playlist_m3u"):
        write_m3u_playlist(dest_dir, collection_title, saved_files)

    summary = f"Guardadas {len(saved_files)} canciones en el servidor."
    if failed_count:
        summary = f"Guardadas {len(saved_files)} de {total} canciones ({failed_count} no disponibles)."
    kind_hint = "Playlists y Biblioteca" if collection.get("playlist_m3u") else "Álbumes y Biblioteca"
    status(
        "completed",
        f"{summary} Pulsa «Actualizar biblioteca» para verlas en {kind_hint}.",
        title=collection_title,
        filename=f"{collection_title} ({len(saved_files)} canciones)",
        progress={"completed": len(saved_files), "current": total, "total": total},
    )


def run_job(job, runner=subprocess.Popen, publisher=publish_audio, resolver=resolve_collection):
    path = QUEUE / f"{job['id']}.result.json"

    def status(state, message, **extra):
        atomic_json(path, {"status": state, "message": message, "updatedAt": int(time.time() * 1000), **extra})

    try:
        if shutil.disk_usage(MUSIC).free < 512 * 1024 * 1024:
            raise ValueError("El servidor necesita al menos 512 MB libres para descargar.")
        if job["source"]["kind"] in COLLECTION_KINDS:
            run_collection_job(job, status, runner=runner, publisher=publisher, resolver=resolver)
            return
        status("downloading", "Buscando y descargando el audio en el servidor…")
        with tempfile.TemporaryDirectory(prefix="mimusic-", dir="/tmp") as work:
            directory = Path(work)
            audio = execute_track_download(job["source"], directory, runner=runner, timeout_seconds=600)
            filename = publisher(job["source"], audio)
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
