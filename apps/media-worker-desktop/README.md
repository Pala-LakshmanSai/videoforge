# VideoForge personal media worker

This package turns the provider-free `workers/media-local` ASR/render core into install-only desktop
artifacts:

- Windows x64: signed setup `.exe`
- macOS: signed and notarized universal `.app` inside a `.dmg`

The installed worker starts at login, opens the hosted VideoForge page for one explicit first-run
confirmation, stores its account-scoped credential in Windows Credential Manager or macOS Keychain,
and then uses outbound HTTPS only. Users enter no URLs, keys, paths, model settings, or provider
configuration. On macOS the first launch copies the notarized app into the user's Applications
folder and registers the background LaunchAgent; the DMG itself never performs a silent install.

`media-worker-release.yml` is deliberately manual and fail-closed. It needs a preverified tool bundle
for each platform, a public hosted origin, and protected signing/notarization secrets. Setting
`signed_release=false` produces unsigned internal artifacts for tests; those are not acceptable user downloads because
Gatekeeper and SmartScreen would add confusing warnings. Publication and hosted manifest activation
are external V2-06 gates, not local repository proof.

`publish_release=true` is permitted only with `signed_release=true`, the exact new
`media-worker-v0.1.0` tag, and the protected release environment. It publishes both binaries plus
the checksum/size manifest to the public repository Release; the workflow refuses to replace an
existing tag or asset. Activating that generated manifest in staging is a separate reviewed hosting
mutation.

The tool bundle must contain `ffmpeg`, `ffprobe`, and `whisper-cli` under `bin/` (with `.exe` suffixes
on Windows) and must be checksum-pinned before the workflow runs. The `ggml-base.en` model remains an
exact tenant-private input artifact and is downloaded through a short-lived R2 GET port only when an
ASR job is claimed; no runtime provider/model discovery occurs.
