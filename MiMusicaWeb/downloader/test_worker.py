import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch
import worker


class WorkerTests(unittest.TestCase):
    def test_sources_are_single_tracks_and_never_shell_commands(self):
        for source in [
            {"kind": "youtube", "value": "https://localhost/admin"},
            {"kind": "spotify", "value": "https://open.spotify.com/playlist/123"},
            {"kind": "file", "value": "/etc/passwd"},
        ]:
            with self.assertRaises(ValueError):
                worker.command_for(source, Path("/tmp/test"))
        query = "Song; $(touch /tmp/unsafe) --exec command"
        command = worker.command_for({"kind": "search", "value": query}, Path("/tmp/test"))
        self.assertEqual(command[-2:], ["--", "ytsearch1:" + query])
        self.assertIn("--no-playlist", command)
        command = worker.command_for({"kind": "spotify", "value": "https://open.spotify.com/track/1234567890abcdefghijkl"}, Path("/tmp/test"))
        self.assertEqual(command[:2], ["spotdl", "download"])

    def test_complete_file_is_published_with_no_path_traversal(self):
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder)
            audio = root / "source.mp3"
            audio.write_bytes(b"synthetic-test")
            music = root / "music"
            music.mkdir()
            with patch.object(worker, "MUSIC", music), patch.object(worker, "inspect_audio", return_value={"title": "../../Original", "artist": "Artista"}):
                name = worker.publish_audio({"value": "test source"}, audio)
            self.assertEqual((music / name).read_bytes(), b"synthetic-test")
            self.assertEqual(len(list(music.iterdir())), 1)
            self.assertTrue(name.endswith(".mp3"))

    def test_success_and_failure_are_persisted_without_raw_logs(self):
        class Process:
            returncode = 0
            def poll(self):
                return 0
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder)
            real_temporary = tempfile.TemporaryDirectory
            def temporary(**kwargs):
                return real_temporary(prefix=kwargs.get("prefix"))
            def runner(command, **kwargs):
                (kwargs["cwd"] / "Test.mp3").write_bytes(b"test")
                return Process()
            with patch.object(worker, "QUEUE", root), patch.object(worker, "MUSIC", root), patch.object(worker.tempfile, "TemporaryDirectory", temporary):
                job = {"id": "12345678-1234-1234-1234-123456789abc", "source": {"kind": "search", "value": "Test"}}
                worker.run_job(job, runner=runner, publisher=lambda *_: "Test.mp3")
                saved = json.loads((root / f"{job['id']}.result.json").read_text())
                self.assertEqual(saved["status"], "completed")
                job["source"] = {"kind": "youtube", "value": "https://localhost/secret"}
                worker.run_job(job, runner=runner)
                saved = json.loads((root / f"{job['id']}.result.json").read_text())
                self.assertEqual(saved["status"], "failed")
                self.assertNotIn("secret", saved["message"])

    def test_playlist_collection_publishes_tracks_generates_m3u_and_tolerates_unavailable_track(self):
        class OkProcess:
            returncode = 0
            def poll(self):
                return 0

        class FailProcess:
            returncode = 1
            def poll(self):
                return 1

        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder)
            queue = root / "queue"
            music = root / "music"
            queue.mkdir()
            music.mkdir()
            real_temporary = tempfile.TemporaryDirectory

            def temporary(**kwargs):
                return real_temporary(prefix=kwargs.get("prefix"))

            calls = {"count": 0}
            def runner(command, **kwargs):
                calls["count"] += 1
                if calls["count"] == 2:
                    return FailProcess()
                (kwargs["cwd"] / "audio.mp3").write_bytes(b"mp3-bytes")
                return OkProcess()

            def fake_resolver(_source):
                return {
                    "kind": "spotify-playlist",
                    "title": "../Mi Playlist Favorita",
                    "folder_group": "Playlists",
                    "playlist_m3u": True,
                    "cover_url": None,
                    "tracks": [
                        {"key": "t1", "title": "Canción Uno", "artist": "Artista A", "album": "", "album_artist": "", "track_number": 1, "disc_number": 1, "date": "", "source": {"kind": "search", "value": "Artista A - Canción Uno"}},
                        {"key": "t2", "title": "Canción Caída", "artist": "Artista B", "album": "", "album_artist": "", "track_number": 2, "disc_number": 1, "date": "", "source": {"kind": "search", "value": "Artista B - Canción Caída"}},
                        {"key": "t3", "title": "Canción Tres", "artist": "Artista C", "album": "", "album_artist": "", "track_number": 3, "disc_number": 1, "date": "", "source": {"kind": "search", "value": "Artista C - Canción Tres"}},
                    ],
                }

            with patch.object(worker, "QUEUE", queue), \
                 patch.object(worker, "MUSIC", music), \
                 patch.object(worker.tempfile, "TemporaryDirectory", temporary), \
                 patch.object(worker, "inspect_audio", return_value={"title": "Pista", "artist": "Artista"}), \
                 patch.object(worker, "stamp_id3_tags", return_value=None):
                job = {
                    "id": "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee",
                    "source": {"kind": "spotify-playlist", "value": "https://open.spotify.com/playlist/1234567890abcdefghijkl"},
                }
                worker.run_job(job, runner=runner, resolver=fake_resolver)
                saved = json.loads((queue / f"{job['id']}.result.json").read_text(encoding="utf-8"))
                self.assertEqual(saved["status"], "completed")
                self.assertEqual(saved["progress"], {"completed": 2, "current": 3, "total": 3})
                playlist_dirs = list((music / "Playlists").iterdir())
                self.assertEqual(len(playlist_dirs), 1)
                mp3_files = sorted(p.name for p in playlist_dirs[0].glob("*.mp3"))
                m3u_files = list(playlist_dirs[0].glob("*.m3u"))
                self.assertEqual(len(mp3_files), 2)
                self.assertEqual(len(m3u_files), 1)
                m3u_text = m3u_files[0].read_text(encoding="utf-8")
                self.assertIn("#EXTM3U", m3u_text)
                self.assertIn("#PLAYLIST:../Mi Playlist Favorita", m3u_text)
                for mp3_name in mp3_files:
                    self.assertIn(mp3_name, m3u_text)


if __name__ == "__main__":
    unittest.main()
