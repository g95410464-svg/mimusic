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
            # Use the platform's own temporary directory; production uses /tmp.
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


if __name__ == "__main__":
    unittest.main()
