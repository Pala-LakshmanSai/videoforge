# VideoForge personal media worker

This package turns the provider-free `workers/media-local` ASR/render core into install-only desktop
artifacts:

- Windows x64: ImageForge-style unsigned beta setup `.exe`, with optional Authenticode upgrade
- macOS: ImageForge-style ad-hoc sealed universal `.app` inside a verified `.dmg`, with optional
  Developer ID/notarization upgrade

The installed worker starts at login, opens the hosted VideoForge page for one explicit first-run
confirmation, stores its account-scoped credential in Windows Credential Manager or macOS Keychain,
and then uses outbound HTTPS only. Users enter no URLs, keys, paths, model settings, or provider
configuration. On macOS the first launch copies the sealed app into the user's Applications
folder and registers the background LaunchAgent; the DMG itself never performs a silent install.

`media-worker-release.yml` is deliberately manual and fail-closed. It needs a preverified tool bundle
for each platform and a public hosted origin. Its default `signed_release=false` path matches
ImageForge: the Mac app is explicitly ad-hoc sealed, the DMG and mounted app are verified, Windows is
an unsigned beta, and the immutable manifest discloses exact hashes and trust mode. Platform warning
behavior can vary, so native clean-download/install evidence remains required. Protected signing and
notarization secrets are needed only for the optional production-trust upgrade.

`publish_release=true` requires the exact new `media-worker-v0.1.0` tag and the protected release
environment. It publishes both binaries plus
the checksum/size manifest to the public repository Release; the workflow refuses to replace an
existing tag or asset. Activating that generated manifest in staging is a separate reviewed hosting
mutation.

The tool bundle must contain `ffmpeg`, `ffprobe`, `whisper-cli`, and `ggml-base.en.bin` under `bin/`
(with `.exe` suffixes on Windows executables) and must be checksum-pinned before the workflow runs.
The worker verifies the exact model hash at startup and again against every ASR job contract. No
first-run model download, runtime provider discovery, or user configuration occurs.
