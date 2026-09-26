from __future__ import annotations

import ast
import json
import os
import subprocess
import sys
import unittest
from pathlib import Path
from unittest.mock import Mock

from videoforge_image_media.jobs.render.process import SubprocessRunner as RenderRunner
from videoforge_image_media.jobs.span_audio.process import SubprocessRunner as SpanRunner
from videoforge_image_media.jobs.transcribe.process import SubprocessRunner as TranscribeRunner
from videoforge_image_media.subprocess_options import background_creationflags
from videoforge_media_local.personal_execution import _run_media_subprocess


class BackgroundProcessTests(unittest.TestCase):
    @unittest.skipUnless(os.name == "nt", "native Windows console visibility")
    def test_real_media_children_have_no_console_and_keep_output_capture(self) -> None:
        command = [
            sys.executable,
            "-c",
            "import ctypes,json; k=ctypes.windll.kernel32; "
            "k.GetConsoleWindow.restype=ctypes.c_void_p; "
            "print(json.dumps({'window': k.GetConsoleWindow() or 0}))",
        ]
        for runner in (TranscribeRunner(), SpanRunner(), RenderRunner()):
            with self.subTest(runner=type(runner).__module__):
                result = runner.run(command, should_cancel=lambda: False)
                self.assertEqual(result.return_code, 0, result.stderr)
                self.assertEqual(json.loads(result.stdout), {"window": 0})
        monitor = Mock()
        monitor.is_cancelled.return_value = False
        code, stdout = _run_media_subprocess(
            command, monitor, retry_once=False, before_retry=lambda: None
        )
        self.assertEqual(code, 0)
        self.assertEqual(json.loads(stdout), {"window": 0})
        monitor.attach.assert_called_once()

    def test_media_runners_keep_failure_stderr_and_exit_code(self) -> None:
        command = [sys.executable, "-c", "import sys; sys.stderr.write('tool failed'); sys.exit(7)"]
        for runner in (TranscribeRunner(), SpanRunner(), RenderRunner()):
            with self.subTest(runner=type(runner).__module__):
                result = runner.run(command, should_cancel=lambda: False)
                self.assertEqual(result.return_code, 7)
                self.assertEqual(result.stderr, "tool failed")

    def test_media_runners_keep_cancellation(self) -> None:
        command = [sys.executable, "-c", "import time; time.sleep(30)"]
        for runner in (TranscribeRunner(), SpanRunner(), RenderRunner()):
            with self.subTest(runner=type(runner).__module__):
                result = runner.run(command, should_cancel=lambda: True)
                self.assertTrue(result.cancelled)
                self.assertNotEqual(result.return_code, 0)

    def test_runtime_console_launch_paths_use_background_policy(self) -> None:
        # Include streaming Fal encoding and taskkill, which bypass ordinary runners.
        import videoforge_image_media
        import videoforge_media_local

        media_root = Path(videoforge_image_media.__file__).parent
        local_root = Path(videoforge_media_local.__file__).parent
        paths = [
            media_root / "jobs/transcribe/process.py",
            media_root / "jobs/span_audio/process.py",
            media_root / "jobs/render/process.py",
            media_root / "jobs/render/fal_wide.py",
            local_root / "personal_execution.py",
        ]
        for path in paths:
            tree = ast.parse(path.read_text(encoding="utf-8"))
            for call in ast.walk(tree):
                if not isinstance(call, ast.Call) or not isinstance(call.func, ast.Attribute):
                    continue
                if not isinstance(call.func.value, ast.Name) or call.func.value.id != "subprocess":
                    continue
                if call.func.attr not in {"Popen", "run"}:
                    continue
                # caffeinate is a macOS-only helper, outside the Windows tool path.
                if "/usr/bin/caffeinate" in ast.unparse(call):
                    continue
                with self.subTest(path=path.name, line=call.lineno):
                    flags = next((k.value for k in call.keywords if k.arg == "creationflags"), None)
                    self.assertIsNotNone(flags, "runtime child may open a Windows console")
                    self.assertIn("background_creationflags()", ast.unparse(flags))

    def test_non_windows_policy_never_passes_windows_flags(self) -> None:
        if os.name != "nt":
            self.assertEqual(background_creationflags(), 0)
        else:
            self.assertEqual(background_creationflags(), subprocess.CREATE_NO_WINDOW)


if __name__ == "__main__":
    unittest.main()
