# VideoForge personal media worker

This package turns the provider-free `workers/media-local` ASR/render core into install-only desktop
artifacts:

- Windows x64: ImageForge-style unsigned beta setup `.exe`, with optional Authenticode upgrade
- macOS: ImageForge-style ad-hoc sealed universal2 `.app` inside a verified `.dmg`, with optional
  Developer ID/notarization upgrade

The installed worker starts at login, opens the hosted VideoForge page for one explicit first-run
confirmation, stores its account-scoped credential in Windows Credential Manager or macOS Keychain,
and then uses outbound HTTPS only. Users enter no URLs, keys, paths, model settings, or provider
configuration. On macOS the first launch copies the sealed app into the user's Applications
folder and registers the background LaunchAgent; the DMG itself never performs a silent install.

The Windows installer is x64-only and remains an explicitly unsigned beta. Its uninstaller stops
the worker and invokes the bundled `--uninstall` path to remove the local installation record and
OS credential; the authenticated VideoForge Settings Remove action separately revokes the remote
device. On macOS, `--uninstall` performs the same local cleanup and removes the LaunchAgent before
the app is deleted. A Finder/Explorer delete cannot run that cleanup, so remove the computer from
VideoForge first when possible.

When the control plane reports `UPDATE_REQUIRED`, the worker exits cleanly instead of holding the
old executable open or retrying claims. The next beta installer can therefore replace it; the
existing LaunchAgent/Startup entry remains the login path for the new build. Temporary network
loss keeps the existing paired credential and retries with bounded backoff, so reconnect does not
create a second enrollment.

`media-worker-release.yml` is deliberately manual and fail-closed. It assembles tools only from
checksum-pinned, versioned upstream inputs and needs a public hosted origin. Its default
`signed_release=false` path matches
ImageForge: the Mac app is explicitly ad-hoc sealed, the DMG and mounted app are verified, Windows is
an unsigned beta, and the immutable manifest discloses exact hashes and trust mode. Platform warning
behavior can vary, so native clean-download/install evidence remains required. Protected signing and
notarization secrets are needed only for the optional production-trust upgrade.

`publish_release=true` requires the exact new `media-worker-v0.1.11` tag and the protected release
environment. It publishes both binaries plus
the checksum/size manifest to the public repository Release; the workflow refuses to replace an
existing tag or asset. Activating that generated manifest in staging is a separate reviewed hosting
mutation.

Compute the exact execution-bundle identity from a clean checkout before dispatching the workflow:

```sh
python apps/media-worker-desktop/compute_execution_bundle_sha256.py
```

Pass that `sha256:...` value as `execution_bundle_sha256`. Each build and the publish job recompute
the clean-worktree source/tool manifest and fail if the supplied identity does not match.

The workflow pins FFmpeg/FFprobe 8.1.2, whisper.cpp 1.8.4, and the exact `ggml-base.en` model. It
verifies source/archive hashes, tool versions, required render filters, libx264, and the model hash
before freezing either app. The macOS workflow also fails closed unless every Mach-O file inside
the app verifies as both arm64 and x86_64. Windows x64 runtime DLLs are bundled beside
`whisper-cli.exe`; the macOS worker and tools are built as universal2 binaries from the exact
whisper.cpp commit and exact Intel and Apple Silicon FFmpeg inputs. The worker verifies the
model again at startup and against every ASR job contract. No first-run model download, runtime
provider discovery, or user configuration occurs.

This checkout's source-only lifecycle repairs are not a new immutable publication. The separately
recorded repaired artifact is `media-worker-v0.1.11`; recompute the execution-bundle hash and publish
a new immutable release before updating hosted release metadata after any release-input change.

## Bounded Windows acceptance run

`windows-native-acceptance.ps1` is a Windows-only, bounded harness for the exact immutable release
artifact. It performs no download, provider lookup, credential-value read, remote revoke, or network call
by default. It verifies the manifest, SHA-256, byte length, unsigned-beta trust mode, Windows x64
host, clean per-run install root, Startup shortcut, update replacement (when a previous manifest and
installer are supplied), and Inno uninstall cleanup. It writes a redacted JSON report and removes
the isolated install in `finally` unless `-KeepInstallation` is requested.

Provider-free package/lifecycle check:

```powershell
Set-ExecutionPolicy -Scope Process Bypass
.\windows-native-acceptance.ps1 `
  -InstallerPath .\VideoForge-Worker-0.1.11-Setup.exe `
  -ReleaseManifestPath .\media-worker-release.json
```

For the same bounded run to include the one user-controlled browser pairing and background restart,
add `-RunHostedPairing`. The worker then uses its compiled staging origin; the harness only checks
for the paired Credential Manager entry by installation ID and never reads the credential value:

```powershell
.\windows-native-acceptance.ps1 `
  -InstallerPath .\VideoForge-Worker-0.1.11-Setup.exe `
  -ReleaseManifestPath .\media-worker-release.json `
  -RunHostedPairing
```

To include update replacement, also provide a previous immutable Windows installer and its matching
release manifest with `-PreviousInstallerPath` and `-PreviousReleaseManifestPath`. Run this only
under a fresh Windows user with no existing `VideoForge Worker` process, Startup shortcut, or local
worker state. SmartScreen choice, browser approval, sleep/wake and offline/reconnect observation,
and authenticated Settings device revocation remain user/device evidence; the script reports them
as manual steps and does not claim them automatically.
