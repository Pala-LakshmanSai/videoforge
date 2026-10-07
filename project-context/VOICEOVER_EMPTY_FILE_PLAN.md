# V2-09 / VF-10-09: reject empty uploaded voiceovers

User2026-10-07 authorizes diagnosis, repair and production publication. Reuse
`codex/gpt6-luna-prompt-writer` at context86434659, executable8d0d334f / Worker9ae57da8 / native286.
Preserve the primary checkout's unrelated edits and existing provider/Workflow identities.

## Cause and scope

Screenshot input `garden-3min-voiceover.mp3` is an actual zero-byte Downloads file.
ffprobe rejects it. The picker/drop handler checks extension and maximum size but
accepts zero bytes, displays ready-to-check and enables Create. The media duration
reader then fails. This is an invalid input admission bug, separate from prompt writing.

Reject empty input at the shared duration reader and common picker/drop selection.
Show a specific immediate explanation, clear stale accepted audio/preflight metadata
and keep Create disabled. Preserve title/preset/composition choices and all valid
audio paths. Do not add a decoder, change server/schema/provider budgets or infer
the external process that created the empty file. The separate existing gardening
MP3 is 4,321,658 bytes,179.985669 seconds and fully decodes; leave both user files intact.

## Acceptance

Prove prepatch failure and postpatch picker/drop/direct-reader rejection with no
preflight/upload/Create request. Verify valid WAV and real MP3 duration in installed
Chrome, retained Create navigation and script controls. Run touched UI/types/lint,
build/quarantine/context/secrets and independent review. Publish only the verified
source, preserving55bindings27secret names/three Workflow IDs/native286 and native
Cloud/Desktop0.1.52 pins. Compare server bundle against the published predecessor;
no Workflow registration/runtime restart if server bytes are identical.

Read back production assets/traffic and real Brave empty-file rejection plus valid
MP3 estimate without Create submission. No paid inference/media/compute authorized
or needed. Record release and remaining independent gates in CURRENT_STATE/evidence.
