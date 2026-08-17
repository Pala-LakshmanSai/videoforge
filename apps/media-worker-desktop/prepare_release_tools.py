from __future__ import annotations

import argparse
import hashlib
import shutil
import subprocess
import tempfile
import urllib.request
import zipfile
from pathlib import Path


MODEL_URL = (
    "https://huggingface.co/ggerganov/whisper.cpp/resolve/"
    "5359861c739e955e79d9a303bcbc70fb988958b1/ggml-base.en.bin"
)
MODEL_SHA256 = "a03779c86df3323075f5e796cb2ce5029f00ec8869eee3fdfb897afe36c6d002"

WINDOWS_FFMPEG_URL = (
    "https://www.gyan.dev/ffmpeg/builds/packages/ffmpeg-8.1.2-essentials_build.zip"
)
WINDOWS_FFMPEG_SHA256 = "db580001caa24ac104c8cb856cd113a87b0a443f7bdf47d8c12b1d740584a2ec"
WINDOWS_WHISPER_URL = (
    "https://github.com/ggml-org/whisper.cpp/releases/download/v1.8.4/whisper-bin-x64.zip"
)
WINDOWS_WHISPER_SHA256 = "74f973345cb52ef5ba3ec9e7e7af8e48cc8c71722d1528603b80588a11f82e3e"

MACOS_FFMPEG_URL = (
    "https://ffmpeg.martin-riedl.de/download/macos/arm64/"
    "1783011502_8.1.2/ffmpeg.zip"
)
MACOS_FFMPEG_SHA256 = "ef1aa60006c7b77ce170c1608c08d8e4ba1c30c5746f2ac986ded932d0ac2c3c"
MACOS_FFPROBE_URL = (
    "https://ffmpeg.martin-riedl.de/download/macos/arm64/"
    "1783011502_8.1.2/ffprobe.zip"
)
MACOS_FFPROBE_SHA256 = "c39787f4af7a3932502d2d48db6f6feaaa836b48a73ef78c32cc3285df61dfaf"
MACOS_INTEL_FFMPEG_URL = (
    "https://ffmpeg.martin-riedl.de/download/macos/amd64/"
    "1783018342_8.1.2/ffmpeg.zip"
)
MACOS_INTEL_FFMPEG_SHA256 = "a52ef43883f44c219766d4b3bdde4e635b35465d0b704c01c3a0566b59775df9"
MACOS_INTEL_FFPROBE_URL = (
    "https://ffmpeg.martin-riedl.de/download/macos/amd64/"
    "1783018342_8.1.2/ffprobe.zip"
)
MACOS_INTEL_FFPROBE_SHA256 = "5408ca588c8c72b0dde3afe676d0a7acf25ef97e55ae6eba5c7bede1cda42695"


def _sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as source:
        while chunk := source.read(1024 * 1024):
            digest.update(chunk)
    return digest.hexdigest()


def _download(url: str, expected_sha256: str, destination: Path) -> None:
    request = urllib.request.Request(url, headers={"User-Agent": "VideoForge-release/0.1.0"})
    with urllib.request.urlopen(request, timeout=180) as source, destination.open("wb") as output:
        shutil.copyfileobj(source, output, length=1024 * 1024)
    if _sha256(destination) != expected_sha256:
        raise SystemExit(f"checksum mismatch for {destination.name}")


def _extract(archive: Path, destination: Path) -> None:
    with zipfile.ZipFile(archive) as bundle:
        root = destination.resolve()
        for member in bundle.infolist():
            target = (destination / member.filename).resolve()
            if not target.is_relative_to(root):
                raise SystemExit(f"unsafe archive path in {archive.name}")
        bundle.extractall(destination)


def _one(root: Path, name: str) -> Path:
    matches = [path for path in root.rglob(name) if path.is_file()]
    if len(matches) != 1:
        raise SystemExit(f"expected exactly one {name}, found {len(matches)}")
    return matches[0]


def _copy(source: Path, destination: Path, executable: bool = False) -> None:
    shutil.copy2(source, destination)
    if executable:
        destination.chmod(0o755)


def _prepare_windows(work: Path, output: Path) -> None:
    ffmpeg_archive = work / "ffmpeg-windows.zip"
    whisper_archive = work / "whisper-windows.zip"
    ffmpeg_root = work / "ffmpeg-windows"
    whisper_root = work / "whisper-windows"
    _download(WINDOWS_FFMPEG_URL, WINDOWS_FFMPEG_SHA256, ffmpeg_archive)
    _download(WINDOWS_WHISPER_URL, WINDOWS_WHISPER_SHA256, whisper_archive)
    _extract(ffmpeg_archive, ffmpeg_root)
    _extract(whisper_archive, whisper_root)
    _copy(_one(ffmpeg_root, "ffmpeg.exe"), output / "ffmpeg.exe")
    _copy(_one(ffmpeg_root, "ffprobe.exe"), output / "ffprobe.exe")
    _copy(_one(whisper_root, "whisper-cli.exe"), output / "whisper-cli.exe")
    for library in ("ggml-base.dll", "ggml-cpu.dll", "ggml.dll", "whisper.dll"):
        _copy(_one(whisper_root, library), output / library)


def _prepare_macos(work: Path, output: Path, whisper_cli: Path) -> None:
    if not whisper_cli.is_file():
        raise SystemExit("the pinned macOS whisper-cli build is missing")
    ffmpeg_archive = work / "ffmpeg-macos-arm64.zip"
    ffprobe_archive = work / "ffprobe-macos-arm64.zip"
    intel_ffmpeg_archive = work / "ffmpeg-macos-x86_64.zip"
    intel_ffprobe_archive = work / "ffprobe-macos-x86_64.zip"
    ffmpeg_root = work / "ffmpeg-macos-arm64"
    ffprobe_root = work / "ffprobe-macos-arm64"
    intel_ffmpeg_root = work / "ffmpeg-macos-x86_64"
    intel_ffprobe_root = work / "ffprobe-macos-x86_64"
    _download(MACOS_FFMPEG_URL, MACOS_FFMPEG_SHA256, ffmpeg_archive)
    _download(MACOS_FFPROBE_URL, MACOS_FFPROBE_SHA256, ffprobe_archive)
    _download(MACOS_INTEL_FFMPEG_URL, MACOS_INTEL_FFMPEG_SHA256, intel_ffmpeg_archive)
    _download(MACOS_INTEL_FFPROBE_URL, MACOS_INTEL_FFPROBE_SHA256, intel_ffprobe_archive)
    _extract(ffmpeg_archive, ffmpeg_root)
    _extract(ffprobe_archive, ffprobe_root)
    _extract(intel_ffmpeg_archive, intel_ffmpeg_root)
    _extract(intel_ffprobe_archive, intel_ffprobe_root)
    subprocess.run(
        [
            "/usr/bin/lipo",
            "-create",
            str(_one(ffmpeg_root, "ffmpeg")),
            str(_one(intel_ffmpeg_root, "ffmpeg")),
            "-output",
            str(output / "ffmpeg"),
        ],
        check=True,
    )
    subprocess.run(
        [
            "/usr/bin/lipo",
            "-create",
            str(_one(ffprobe_root, "ffprobe")),
            str(_one(intel_ffprobe_root, "ffprobe")),
            "-output",
            str(output / "ffprobe"),
        ],
        check=True,
    )
    (output / "ffmpeg").chmod(0o755)
    (output / "ffprobe").chmod(0o755)
    _copy(whisper_cli, output / "whisper-cli", executable=True)
    for binary in (output / "ffmpeg", output / "ffprobe", output / "whisper-cli"):
        subprocess.run(
            ["/usr/bin/lipo", "-verify_arch", "arm64", "x86_64", str(binary)], check=True
        )


def _verify(platform_name: str, output: Path) -> None:
    suffix = ".exe" if platform_name == "windows" else ""
    ffmpeg = output / f"ffmpeg{suffix}"
    ffprobe = output / f"ffprobe{suffix}"
    whisper = output / f"whisper-cli{suffix}"
    for command, expected in (
        ([str(ffmpeg), "-version"], "ffmpeg version 8.1.2"),
        ([str(ffprobe), "-version"], "ffprobe version 8.1.2"),
        ([str(whisper), "--help"], "supported audio formats"),
    ):
        result = subprocess.run(command, check=False, capture_output=True, text=True, timeout=30)
        combined = result.stdout + result.stderr
        if result.returncode not in {0, 1} or expected not in combined:
            raise SystemExit(f"tool verification failed for {Path(command[0]).name}")
    filters = subprocess.run(
        [str(ffmpeg), "-hide_banner", "-filters"],
        check=True,
        capture_output=True,
        text=True,
        timeout=30,
    ).stdout
    encoders = subprocess.run(
        [str(ffmpeg), "-hide_banner", "-encoders"],
        check=True,
        capture_output=True,
        text=True,
        timeout=30,
    ).stdout
    for required_filter in ("perspective", "loudnorm", "zoompan"):
        if required_filter not in filters:
            raise SystemExit(f"ffmpeg is missing required filter {required_filter}")
    if "libx264" not in encoders:
        raise SystemExit("ffmpeg is missing required libx264 encoder")


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--platform", choices=("windows", "macos"), required=True)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--macos-whisper-cli", type=Path)
    args = parser.parse_args()
    args.output.mkdir(parents=True, exist_ok=False)
    with tempfile.TemporaryDirectory(prefix="videoforge-release-tools-") as temporary:
        work = Path(temporary)
        if args.platform == "windows":
            _prepare_windows(work, args.output)
        else:
            if args.macos_whisper_cli is None:
                raise SystemExit("--macos-whisper-cli is required for macOS")
            _prepare_macos(work, args.output, args.macos_whisper_cli)
        _download(MODEL_URL, MODEL_SHA256, args.output / "ggml-base.en.bin")
    _verify(args.platform, args.output)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
