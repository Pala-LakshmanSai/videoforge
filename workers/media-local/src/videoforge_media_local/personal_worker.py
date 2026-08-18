from __future__ import annotations

import base64
import ctypes
import hashlib
import json
import os
import platform
import plistlib
import re
import secrets
import subprocess
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
import uuid
import webbrowser
from ctypes import wintypes
from pathlib import Path
from typing import Protocol

from videoforge_media_local.personal_execution import (
    ToolPaths,
    _sha256_file,
    execute_personal_job,
    parse_personal_job,
)

from videoforge_media_local.personal_tls import https_context

_SERVICE = "com.videoforge.personal-media-worker"
_WORKER_VERSION = "0.1.8"
_PROTOCOL_VERSION = 1
_USER_AGENT = f"VideoForge-Worker/{_WORKER_VERSION}"
_UUID = re.compile(r"^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$")
_TOKEN = re.compile(r"^[0-9a-f]{64}$")
_SHA256 = re.compile(r"^sha256:[0-9a-f]{64}$")


def _is_external_macos_bundle(bundle: Path) -> bool:
    """Return whether macOS launched the app from a removable/translocated path.

    Gatekeeper can launch an app from an AppTranslocation directory even after the
    user double-clicks it in a mounted DMG.  Both that path and the mounted volume
    must be copied to a stable per-user Applications location before registering a
    LaunchAgent; otherwise the agent points at an ephemeral path and repeatedly
    restarts a one-file PyInstaller extraction.
    """

    value = str(bundle)
    return value.startswith("/Volumes/") or "/AppTranslocation/" in value


def _install_macos_if_needed() -> bool:
    if sys.platform != "darwin" or not getattr(sys, "frozen", False):
        return False
    executable = Path(sys.executable).resolve()
    bundle = next((parent for parent in executable.parents if parent.suffix == ".app"), None)
    if bundle is None or not _is_external_macos_bundle(bundle):
        return False
    target = Path.home() / "Applications" / bundle.name
    target.parent.mkdir(parents=True, exist_ok=True)
    subprocess.run(["/usr/bin/ditto", str(bundle), str(target)], check=True)
    subprocess.Popen(["/usr/bin/open", str(target)])
    return True


def _launch_agent_document(executable: Path | None = None) -> bytes:
    document = {
        "Label": _SERVICE,
        "ProgramArguments": [str(executable or sys.executable), "--background"],
        "RunAtLoad": True,
        "KeepAlive": {"SuccessfulExit": False},
        "ThrottleInterval": 30,
        "ProcessType": "Background",
    }
    return plistlib.dumps(document)


def _launchctl(*arguments: str) -> subprocess.CompletedProcess[bytes]:
    try:
        return subprocess.run(
            ["/bin/launchctl", *arguments],
            check=False,
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
        )
    except OSError as error:
        raise RuntimeError("VideoForge could not configure macOS login startup") from error


def _ensure_autostart() -> None:
    if not getattr(sys, "frozen", False):
        return
    if sys.platform == "darwin":
        agents = Path.home() / "Library" / "LaunchAgents"
        agents.mkdir(parents=True, exist_ok=True)
        target = agents / f"{_SERVICE}.plist"
        encoded = _launch_agent_document()
        changed = not target.is_file() or target.read_bytes() != encoded
        if changed:
            target.write_bytes(encoded)
            _launchctl("bootout", f"gui/{os.getuid()}", str(target))
            bootstrapped = _launchctl("bootstrap", f"gui/{os.getuid()}", str(target))
        else:
            loaded = _launchctl("print", f"gui/{os.getuid()}/{_SERVICE}")
            bootstrapped = (
                _launchctl("bootstrap", f"gui/{os.getuid()}", str(target))
                if loaded.returncode != 0
                else None
            )
        if bootstrapped is not None and bootstrapped.returncode != 0:
            raise RuntimeError("VideoForge could not configure macOS login startup")


def _remove_autostart() -> None:
    if sys.platform != "darwin":
        return
    target = Path.home() / "Library" / "LaunchAgents" / f"{_SERVICE}.plist"
    if not target.is_file():
        return
    service = f"gui/{os.getuid()}/{_SERVICE}"
    loaded = _launchctl("print", service)
    if loaded.returncode == 0:
        bootout = _launchctl("bootout", f"gui/{os.getuid()}", str(target))
        if bootout.returncode != 0 or _launchctl("print", service).returncode == 0:
            raise RuntimeError("VideoForge could not unload its macOS login startup agent")
    try:
        target.unlink()
    except FileNotFoundError:
        pass


def _data_root() -> Path:
    if sys.platform == "darwin":
        return Path.home() / "Library" / "Application Support" / "VideoForge Worker"
    if os.name == "nt":
        base = os.environ.get("LOCALAPPDATA")
        if not base:
            raise RuntimeError("Windows local application data directory is unavailable")
        return Path(base) / "VideoForge Worker"
    raise RuntimeError("VideoForge personal worker supports only Windows and macOS")


def _bundle_root() -> Path:
    return Path(getattr(sys, "_MEIPASS", Path(__file__).resolve().parents[4]))


def _build_configuration() -> dict[str, object]:
    candidates = [
        _bundle_root() / "media-worker-release-config.json",
        Path(__file__).with_name("media-worker-release-config.json"),
    ]
    for candidate in candidates:
        if candidate.is_file():
            value = json.loads(candidate.read_text(encoding="utf-8"))
            origin = _validated_control_plane_origin(
                value.get("control_plane_origin") if isinstance(value, dict) else None
            )
            if (
                isinstance(value, dict)
                and value.get("schema_version") == "videoforge-personal-worker-build/v1"
                and origin is not None
                and isinstance(value.get("execution_bundle_sha256"), str)
                and _SHA256.fullmatch(str(value["execution_bundle_sha256"]))
                and isinstance(value.get("whisper_model_sha256"), str)
                and _SHA256.fullmatch(str(value["whisper_model_sha256"]))
            ):
                return {**value, "control_plane_origin": origin}
    if not getattr(sys, "frozen", False):
        origin = os.environ.get("VIDEOFORGE_CONTROL_PLANE_ORIGIN")
        bundle_sha256 = os.environ.get("VIDEOFORGE_EXECUTION_BUNDLE_SHA256")
        whisper_model_sha256 = os.environ.get("VIDEOFORGE_WHISPER_MODEL_SHA256")
        if (
            (validated_origin := _validated_control_plane_origin(origin)) is not None
            and bundle_sha256
            and _SHA256.fullmatch(bundle_sha256)
            and whisper_model_sha256
            and _SHA256.fullmatch(whisper_model_sha256)
        ):
            return {
                "schema_version": "videoforge-personal-worker-build/v1",
                "control_plane_origin": validated_origin,
                "execution_bundle_sha256": bundle_sha256,
                "whisper_model_sha256": whisper_model_sha256,
                "tools_root": str(_bundle_root() / "resources" / "bin"),
            }
    raise RuntimeError("Personal worker build has no pinned control-plane origin")


class CredentialStore(Protocol):
    def get(self, account: str) -> str | None: ...

    def set(self, account: str, secret: str) -> None: ...

    def delete(self, account: str) -> None: ...


class MacKeychainStore:
    def get(self, account: str) -> str | None:
        result = subprocess.run(
            ["/usr/bin/security", "find-generic-password", "-w", "-s", _SERVICE, "-a", account],
            check=False,
            capture_output=True,
            text=True,
        )
        return result.stdout.strip() if result.returncode == 0 else None

    def set(self, account: str, secret: str) -> None:
        subprocess.run(
            [
                "/usr/bin/security",
                "add-generic-password",
                "-U",
                "-s",
                _SERVICE,
                "-a",
                account,
                "-w",
                secret,
            ],
            check=True,
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
        )

    def delete(self, account: str) -> None:
        subprocess.run(
            ["/usr/bin/security", "delete-generic-password", "-s", _SERVICE, "-a", account],
            check=False,
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
        )


class _CREDENTIAL_ATTRIBUTEW(ctypes.Structure):
    _fields_ = [
        ("Keyword", wintypes.LPWSTR),
        ("Flags", wintypes.DWORD),
        ("ValueSize", wintypes.DWORD),
        ("Value", ctypes.POINTER(ctypes.c_ubyte)),
    ]


class _CREDENTIALW(ctypes.Structure):
    _fields_ = [
        ("Flags", wintypes.DWORD),
        ("Type", wintypes.DWORD),
        ("TargetName", wintypes.LPWSTR),
        ("Comment", wintypes.LPWSTR),
        ("LastWritten", wintypes.FILETIME),
        ("CredentialBlobSize", wintypes.DWORD),
        ("CredentialBlob", ctypes.POINTER(ctypes.c_ubyte)),
        ("Persist", wintypes.DWORD),
        ("AttributeCount", wintypes.DWORD),
        ("Attributes", ctypes.POINTER(_CREDENTIAL_ATTRIBUTEW)),
        ("TargetAlias", wintypes.LPWSTR),
        ("UserName", wintypes.LPWSTR),
    ]


class WindowsCredentialStore:
    _GENERIC = 1
    _LOCAL_MACHINE = 2

    def _target(self, account: str) -> str:
        return f"{_SERVICE}:{account}"

    def get(self, account: str) -> str | None:
        pointer = ctypes.POINTER(_CREDENTIALW)()
        if not ctypes.windll.advapi32.CredReadW(
            self._target(account), self._GENERIC, 0, ctypes.byref(pointer)
        ):
            return None
        try:
            credential = pointer.contents
            blob = ctypes.string_at(credential.CredentialBlob, credential.CredentialBlobSize)
            return blob.decode("utf-16-le")
        finally:
            ctypes.windll.advapi32.CredFree(pointer)

    def set(self, account: str, secret: str) -> None:
        blob = secret.encode("utf-16-le")
        buffer = (ctypes.c_ubyte * len(blob)).from_buffer_copy(blob)
        credential = _CREDENTIALW()
        credential.Type = self._GENERIC
        credential.TargetName = self._target(account)
        credential.CredentialBlobSize = len(blob)
        credential.CredentialBlob = ctypes.cast(buffer, ctypes.POINTER(ctypes.c_ubyte))
        credential.Persist = self._LOCAL_MACHINE
        credential.UserName = account
        if not ctypes.windll.advapi32.CredWriteW(ctypes.byref(credential), 0):
            raise ctypes.WinError()

    def delete(self, account: str) -> None:
        ctypes.windll.advapi32.CredDeleteW(self._target(account), self._GENERIC, 0)


def _credential_store() -> CredentialStore:
    if sys.platform == "darwin":
        return MacKeychainStore()
    if os.name == "nt":
        return WindowsCredentialStore()
    raise RuntimeError("VideoForge personal worker supports only Windows and macOS")


def _state() -> tuple[Path, dict[str, str]]:
    root = _data_root()
    root.mkdir(parents=True, exist_ok=True, mode=0o700)
    state_path = root / "installation.json"
    value = _read_existing_state(state_path)
    if value is not None:
        return state_path, value
    value = {"installation_id": str(uuid.uuid4())}
    _write_state(state_path, value)
    return state_path, value


def _write_state(path: Path, value: dict[str, str]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
    temporary = path.with_name(f".{path.name}.{secrets.token_hex(8)}.tmp")
    try:
        temporary.write_text(json.dumps(value, sort_keys=True), encoding="utf-8")
        try:
            temporary.chmod(0o600)
        except OSError:
            pass
        os.replace(temporary, path)
    finally:
        try:
            temporary.unlink()
        except FileNotFoundError:
            pass


def _validated_control_plane_origin(value: object) -> str | None:
    if not isinstance(value, str) or not value or value.strip() != value:
        return None
    try:
        parsed = urllib.parse.urlsplit(value)
        hostname = parsed.hostname
        parsed.port
    except ValueError:
        return None
    if (
        parsed.scheme.lower() != "https"
        or not hostname
        or parsed.username is not None
        or parsed.password is not None
        or parsed.query
        or parsed.fragment
    ):
        return None
    return value.rstrip("/")


def _require_https_url(value: object, label: str) -> str:
    if not isinstance(value, str) or not value or value.strip() != value:
        raise ValueError(f"{label} must be an absolute HTTPS URL")
    try:
        parsed = urllib.parse.urlsplit(value)
        hostname = parsed.hostname
        parsed.port
    except ValueError as error:
        raise ValueError(f"{label} must be an absolute HTTPS URL") from error
    if (
        parsed.scheme.lower() != "https"
        or not hostname
        or parsed.username is not None
        or parsed.password is not None
        or parsed.fragment
    ):
        raise ValueError(f"{label} must be an absolute HTTPS URL")
    return value


def _same_https_origin(left: str, right: str) -> bool:
    left_parts = urllib.parse.urlsplit(left)
    right_parts = urllib.parse.urlsplit(right)
    return (
        left_parts.scheme.lower(),
        left_parts.hostname.lower() if left_parts.hostname else None,
        left_parts.port or 443,
    ) == (
        right_parts.scheme.lower(),
        right_parts.hostname.lower() if right_parts.hostname else None,
        right_parts.port or 443,
    )


def _parse_state(value: object) -> dict[str, str]:
    if (
        not isinstance(value, dict)
        or not isinstance(value.get("installation_id"), str)
        or not _UUID.fullmatch(value["installation_id"])
        or any(not isinstance(key, str) or not isinstance(item, str) for key, item in value.items())
    ):
        raise RuntimeError("VideoForge worker state is invalid; reinstall the worker")
    return dict(value)


def _read_existing_state(path: Path) -> dict[str, str] | None:
    if not path.is_file():
        return None
    try:
        return _parse_state(json.loads(path.read_text(encoding="utf-8")))
    except (OSError, json.JSONDecodeError) as error:
        raise RuntimeError("VideoForge worker state is unreadable; reinstall the worker") from error


def _platform_facts() -> tuple[str, str]:
    system = platform.system()
    machine = platform.machine().lower()
    if system == "Windows":
        if machine not in {"amd64", "x86_64"}:
            raise RuntimeError("VideoForge personal worker supports Windows x64 only")
        return "WINDOWS", "X86_64"
    if system == "Darwin":
        if machine in {"arm64", "aarch64"}:
            return "MACOS", "AARCH64"
        if machine in {"amd64", "x86_64"}:
            return "MACOS", "X86_64"
        raise RuntimeError("VideoForge personal worker supports macOS universal2 only")
    raise RuntimeError("VideoForge personal worker supports only Windows and macOS")


def _json_request(
    url: str,
    method: str,
    body: object | None = None,
    headers: dict[str, str] | None = None,
) -> tuple[int, object | None]:
    url = _require_https_url(url, "Personal worker request URL")
    data = None if body is None else json.dumps(body, separators=(",", ":")).encode("utf-8")
    request = urllib.request.Request(
        url,
        data=data,
        method=method,
        headers={
            "accept": "application/json",
            "user-agent": _USER_AGENT,
            **(headers or {}),
            **({"content-type": "application/json"} if data else {}),
        },
    )
    try:
        with urllib.request.urlopen(request, timeout=30, context=https_context()) as response:
            raw = response.read(1024 * 1024 + 1)
            if len(raw) > 1024 * 1024:
                raise ValueError("Personal worker response exceeded its bound")
            return response.status, json.loads(raw) if raw else None
    except urllib.error.HTTPError as error:
        raw = error.read(1024 * 1024 + 1)
        return error.code, json.loads(raw) if raw else None


def _open_approval_url(approval_url: str) -> None:
    """Open the one-time pairing page through the host OS browser.

    Python's ``webbrowser`` module can report success without dispatching a
    background app's request through LaunchServices.  On macOS, the native
    ``open`` command is the reliable handoff to the user's already configured
    browser; other platforms retain the standard module behavior.
    """

    approval_url = _require_https_url(approval_url, "VideoForge pairing URL")
    if sys.platform == "darwin":
        try:
            subprocess.run(
                ["/usr/bin/open", approval_url],
                check=True,
                stdout=subprocess.DEVNULL,
                stderr=subprocess.DEVNULL,
            )
            return
        except (OSError, subprocess.CalledProcessError):
            pass
    if not webbrowser.open(approval_url, new=2):
        raise RuntimeError("VideoForge could not open the secure browser connection")


def _enroll(
    origin: str, installation_id: str, execution_bundle_sha256: str, store: CredentialStore
) -> str:
    origin = _validated_control_plane_origin(origin) or ""
    if not origin:
        raise RuntimeError("VideoForge worker has no valid control-plane origin")
    verifier = base64.urlsafe_b64encode(secrets.token_bytes(48)).decode("ascii").rstrip("=")
    challenge = (
        base64.urlsafe_b64encode(hashlib.sha256(verifier.encode("utf-8")).digest())
        .decode("ascii")
        .rstrip("=")
    )
    worker_platform, architecture = _platform_facts()
    status, value = _json_request(
        f"{origin}/api/v2/media-worker-enrollments",
        "POST",
        {
            "schema_version": "videoforge-media-worker-enrollment/v1",
            "installation_id": installation_id,
            "display_name": platform.node()[:120] or "My computer",
            "platform": worker_platform,
            "architecture": architecture,
            "worker_version": _WORKER_VERSION,
            "protocol_version": _PROTOCOL_VERSION,
            "execution_bundle_sha256": execution_bundle_sha256,
            "pkce_challenge": challenge,
        },
    )
    if status != 201 or not isinstance(value, dict):
        raise RuntimeError("VideoForge could not start secure computer connection")
    if (
        set(value)
        != {"schema_version", "enrollment_id", "poll_token", "approval_url", "expires_in_seconds"}
        or value.get("schema_version") != "videoforge-media-worker-enrollment-created/v1"
        or not isinstance(value.get("enrollment_id"), str)
        or not _UUID.fullmatch(value["enrollment_id"])
        or not isinstance(value.get("poll_token"), str)
        or not _TOKEN.fullmatch(value["poll_token"])
        or type(value.get("expires_in_seconds")) is not int
        or not 0 < value["expires_in_seconds"] <= 600
    ):
        raise RuntimeError("VideoForge secure computer connection response was invalid")
    enrollment_id = value["enrollment_id"]
    poll_token = value["poll_token"]
    approval_url = _require_https_url(value["approval_url"], "VideoForge pairing URL")
    if not _same_https_origin(origin, approval_url):
        raise RuntimeError("VideoForge pairing URL did not match the configured control plane")
    _open_approval_url(approval_url)
    deadline = time.monotonic() + 600
    while time.monotonic() < deadline:
        status, token = _json_request(
            f"{origin}/api/v2/media-worker-enrollments/{enrollment_id}/token",
            "POST",
            headers={
                "authorization": f"Bearer {poll_token}",
                "x-videoforge-pkce-verifier": verifier,
            },
        )
        if (
            status == 200
            and isinstance(token, dict)
            and set(token) == {"schema_version", "state", "device_token"}
            and token.get("schema_version") == "videoforge-media-worker-token/v1"
            and token.get("state") == "APPROVED"
            and isinstance(token.get("device_token"), str)
            and _TOKEN.fullmatch(token["device_token"])
        ):
            device_token = token["device_token"]
            store.set(installation_id, device_token)
            return device_token
        if status not in {202, 429, 503}:
            raise RuntimeError("VideoForge secure computer connection was rejected or expired")
        time.sleep(2)
    raise RuntimeError("VideoForge secure computer connection expired")


def _tool_paths(configuration: dict[str, object]) -> ToolPaths:
    configured = configuration.get("tools_root")
    root = Path(str(configured)) if configured else Path("resources/bin")
    if not root.is_absolute():
        root = _bundle_root() / root
    suffix = ".exe" if os.name == "nt" else ""
    tools = ToolPaths(
        ffmpeg=root / f"ffmpeg{suffix}",
        ffprobe=root / f"ffprobe{suffix}",
        whisper=root / f"whisper-cli{suffix}",
        whisper_model=root / "ggml-base.en.bin",
    )
    if not all(
        path.is_file() for path in (tools.ffmpeg, tools.ffprobe, tools.whisper, tools.whisper_model)
    ):
        raise RuntimeError("VideoForge worker tools are incomplete; reinstall the worker")
    expected_model_sha256 = str(configuration.get("whisper_model_sha256", ""))
    actual_model_sha256, _ = _sha256_file(tools.whisper_model)
    if actual_model_sha256 != expected_model_sha256:
        raise RuntimeError("VideoForge worker model identity is invalid; reinstall the worker")
    return tools


def _remove_local_installation() -> int:
    root = _data_root()
    state_path = root / "installation.json"
    state = _read_existing_state(state_path)
    if state is not None:
        _credential_store().delete(state["installation_id"])
    _remove_autostart()
    try:
        state_path.unlink()
    except FileNotFoundError:
        pass
    try:
        root.rmdir()
    except OSError:
        pass
    return 0


def run_forever() -> int:
    configuration = _build_configuration()
    origin = str(configuration["control_plane_origin"]).rstrip("/")
    execution_bundle_sha256 = str(configuration["execution_bundle_sha256"])
    tools = _tool_paths(configuration)
    if _install_macos_if_needed():
        return 0
    state_path, state = _state()
    installation_id = state["installation_id"]
    background = "--background" in sys.argv[1:]
    if background and state.get("revoked") == "true":
        return 0
    if not background and state.pop("revoked", None) is not None:
        _write_state(state_path, state)
    store = _credential_store()
    token = store.get(installation_id) or _enroll(
        origin, installation_id, execution_bundle_sha256, store
    )
    # Only install a KeepAlive LaunchAgent after build validation and pairing
    # have succeeded.  A transient startup error must not become a crash loop.
    _ensure_autostart()
    worker_platform, architecture = _platform_facts()
    headers = {"authorization": f"Bearer {token}"}
    backoff = 5
    while True:
        try:
            status, heartbeat = _json_request(
                f"{origin}/api/v2/media-worker/heartbeat",
                "POST",
                {
                    "schema_version": "videoforge-media-worker-heartbeat/v1",
                    "platform": worker_platform,
                    "architecture": architecture,
                    "worker_version": _WORKER_VERSION,
                    "protocol_version": _PROTOCOL_VERSION,
                    "execution_bundle_sha256": execution_bundle_sha256,
                },
                headers,
            )
            if status == 401:
                store.delete(installation_id)
                state["revoked"] = "true"
                _write_state(state_path, state)
                return 0
            if status != 200 or not isinstance(heartbeat, dict):
                raise OSError("heartbeat unavailable")
            heartbeat_status = heartbeat.get("status")
            if heartbeat_status == "UPDATE_REQUIRED":
                # Exit cleanly so an installer can replace the executable.  The
                # LaunchAgent deliberately restarts only unsuccessful exits.
                return 0
            if heartbeat_status != "ONLINE":
                raise OSError("heartbeat returned an unknown status")
            status, claim = _json_request(
                f"{origin}/api/v2/media-worker/claim", "POST", headers=headers
            )
            if status == 200 and isinstance(claim, dict):
                job = parse_personal_job(claim["job"])
                execute_personal_job(job, token, str(claim["lease_token"]), tools)
            elif status not in {204, 409}:
                raise OSError("claim unavailable")
            backoff = 5
            time.sleep(5)
        except (OSError, RuntimeError, ValueError, KeyError, json.JSONDecodeError):
            time.sleep(backoff)
            backoff = min(backoff * 2, 60)


def main() -> int:
    if sys.argv[1:2] == ["--uninstall"]:
        return _remove_local_installation()
    if sys.argv[1:2] == ["--execute-media"]:
        from videoforge_media_local.cli import main as media_main

        sys.argv = [sys.argv[0], *sys.argv[2:]]
        return media_main()
    try:
        return run_forever()
    except KeyboardInterrupt:
        return 0
    except (OSError, RuntimeError, ValueError) as error:
        print(str(error), file=sys.stderr)
        return 2


if __name__ == "__main__":
    raise SystemExit(main())
