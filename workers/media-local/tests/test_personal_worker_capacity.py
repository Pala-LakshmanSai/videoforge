from __future__ import annotations

import unittest
from pathlib import Path
from unittest.mock import Mock, patch

from videoforge_media_local import personal_worker


class CapacityHeartbeatTests(unittest.TestCase):
    def test_reports_capacity_on_actual_scratch_filesystem(self):
        store = Mock()
        store.get.return_value = "paired-device-token"
        config = {"control_plane_origin": "https://example.test", "execution_bundle_sha256": "sha256:" + "a" * 64}
        with patch.multiple(personal_worker, _build_configuration=Mock(return_value=config),
                            _tool_paths=Mock(), _install_macos_if_needed=Mock(return_value=False),
                            _state=Mock(return_value=(Path("unused"), {"installation_id": "installation"})),
                            _credential_store=Mock(return_value=store), _ensure_autostart=Mock(),
                            _platform_facts=Mock(return_value=("MACOS", "AARCH64")), _write_state=Mock()), \
             patch.object(personal_worker.tempfile, "gettempdir", return_value="scratch-volume"), \
             patch.object(personal_worker.shutil, "disk_usage", return_value=Mock(free=123456)) as usage, \
             patch.object(personal_worker, "_json_request", return_value=(401, {})) as request:
            self.assertEqual(personal_worker.run_forever(), 0)
            usage.assert_called_once_with("scratch-volume")
            self.assertEqual(request.call_args.args[2]["available_disk_bytes"], 123456)


if __name__ == "__main__":
    unittest.main()
