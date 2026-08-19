from __future__ import annotations

import os
import sys
from pathlib import Path

from PyInstaller.utils.hooks import collect_data_files, collect_submodules

repo = Path(SPECPATH).parents[1]
resources = Path(os.environ["VIDEOFORGE_WORKER_RESOURCES"])
configuration = Path(os.environ["VIDEOFORGE_WORKER_BUILD_CONFIG"])

hidden = (
    collect_submodules("videoforge_media_local")
    + collect_submodules("videoforge_image_media")
    + ["certifi"]
)

analysis = Analysis(
    [str(repo / "workers/media-local/src/videoforge_media_local/personal_worker.py")],
    pathex=[
        str(repo / "workers/media-local/src"),
        str(repo / "workers/image-media/src"),
        str(repo / "packages/contracts/python"),
    ],
    binaries=[],
    datas=[
        (str(resources), "resources/bin"),
        (str(configuration), "."),
        *collect_data_files("certifi"),
    ],
    hiddenimports=hidden,
    noarchive=False,
)
pyz = PYZ(analysis.pure)
executable = EXE(
    pyz,
    analysis.scripts,
    analysis.binaries,
    analysis.datas,
    [],
    name="VideoForge Worker",
    console=False,
    disable_windowed_traceback=False,
    target_arch=os.environ.get("VIDEOFORGE_WORKER_TARGET_ARCH") or None,
)

if sys.platform == "darwin":
    app = BUNDLE(
        executable,
        name="VideoForge Worker.app",
        bundle_identifier="com.videoforge.personal-media-worker",
        info_plist={
            "CFBundleDisplayName": "VideoForge Worker",
            "CFBundleShortVersionString": "0.1.10",
            "LSBackgroundOnly": True,
            "LSMinimumSystemVersion": "12.0",
        },
    )
