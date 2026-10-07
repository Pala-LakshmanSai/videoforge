# V2-09 / VF-10-09: empty voiceover admission

## Verified cause

The screenshot's `garden-3min-voiceover.mp3` in Downloads is exactly zero bytes,
SHA-256 `e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855`.
ffprobe reports no consecutive MPEG audio frames. File metadata has no download
provenance; its creation process is unknown. Do not attribute this to Runware,
prompt writing or a media metadata race.

The hosted picker/drop shared handler accepted supported extensions and maximum
size without rejecting zero bytes. It displayed ready-to-check and enabled Create;
the shared duration reader then failed. Server preflight already requires positive
content length, and authoritative uploaded-audio validation also rejects zero.

## Repair and checks

Six production lines add one common error string and early empty-file checks in
`audioDurationMs` and `selectVoiceover`. Empty selection clears prior voiceover,
preflight and audio metadata, leaves the title/settings intact, shows an immediate
specific alert and keeps Create disabled. Both picker and drop use this handler.
No parser, backend, schema, paid request, native runtime or model change.

Four new direct-reader/picker/drop regressions fail before the patch, pass afterward;
all272screen checks pass. Types, touched ESLint, both builds and production bundle
quarantine pass. Context and tracked secret scan pass. Independent review finds no
actionable issue. Installed Chrome configurable-opening/draft journey passes with
new empty-file rejection, zero API writes, valid WAV replacement and preserved
navigation/composition checks. The test's unrelated auth proxy logs are from the
provider-free harness; its mocked hosted API behavior passes.

Signed-in original production Chrome form independently reads the valid neighboring
`garden-fresh-3min.mp3`:4,321,658bytes,179.985669seconds,44.1kHz mono192kb/s,
SHA-256 `ce0b6af2aa8275bbd68ecb251cde38b18f26ce7e0d756a7869d3714c57c1a1d8`.
Full local ffmpeg decode passes. Its preliminary footage estimate11.22seconds
matches0.1minute opening/3% remaining coverage; original title, French womenVersion1,
Natural DocumentaryVersion1 and Cloud remain. No Create click or media upload.
Both files remain intact. Native Brave file-picker capture fails; Escape restores
its empty form. This automation failure is not an application defect.

## Release and separate gates

Production is published at executable `4b2c9f7dc9570d7d729cbbc9f68f0c587d07dd18` /
Worker `c10de8bb-afe8-45f5-accd-bde96d86a429`,100% traffic. All36public assets match
size/SHA-256 across37build entries (`.assetsignore` is not publicly exposed).
Anonymous private projects return401.55bindings27secret names/six resources,
three Workflow IDs and registered versions, native286/Cloud/Desktop0.1.52 pins
remain exact. No Workflow registration or singleton restart.

Server bundle SHA-256 `e1f1f6e8587a3e70d9e97bdbfb1351c66e509d481f57bfc69f040f97cb275531`
is byte-identical to the published8d0d334f bundle. A first local preparation failed
because esbuild used a different working directory in109source-comment prefixes;
restoring the original build working directory achieves strict byte equality, no
comparison guard weakening. Failed local preparation is preserved privately.
The first Cloudflare GET401 was resolved through existing Wrangler authentication
refresh, before any publication. Upload and deployment each ran once with sealed
source/config/proof authority and durable intents; no uncertain replay.

Signed-in original Chrome reloads the published assets. Empty-file selection from
an otherwise ready form immediately shows the specific zero-byte alert, clears
readiness and disables Create. The valid complete MP3 clears the alert and reads
11.22s preliminary coverage; Create re-enables. Original title, French womenVersion1,
Natural DocumentaryVersion1, Cloud, AvatarOn, opening0.1minute and3% coverage are
restored. Zero browser console errors. No Create click or new media upload.

Private proofs under `.videoforge/voiceover-empty-20261007/` in the primary checkout:
- `release/readback-private.json`, SHA-256 `0fa03ee96b2f9471d3eb5caa04451185c0e9c2ab28e9fb2a63f4d639243754a0`.
- `browser/browser-proof-private.json`, SHA-256 `dcebf24c24e8c423fafe2ad66d5169d8f9eeb2d33f05c932d5ece5a1e3756389`.
- `browser/production-empty-rejected.png` and `browser/production-valid-ready.png`.
- `release/qualification-private.json`, source manifest, publication authority,
  intents/ACKs, asset manifest and dry-run proof.

Canonical `CI=1 TURBO_FORCE=true pnpm verify` was run once: static phase still fails
116existing formatting files and Python lint. Touched source/tests format clean.
Full CI and entire fresh-film qualification are not claimed green. The owned Chrome
fixture server exited; port4173 has no listener at final shutdown check.

New inference/media/compute spendUSD0; no new compute start/stop, project or Workflow
instance. Historical cleanup, broadCI, installed Local/full-film/provider/editorial/
invoice gates remain separate. This fix prevents empty files reaching duration
decoding; it does not make an empty recording playable or promise every corrupt
nonempty file/provider outage will disappear.
