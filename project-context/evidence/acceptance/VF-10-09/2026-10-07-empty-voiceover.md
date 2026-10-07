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

Production publication pending at this source commit. Fresh private publisher must
prove server bundle byte equality with executable8d0d334f, preserve55bindings/
27secret names/six resource bindings/three Workflow identities+versions/native286/
Cloud and Desktop0.1.52 pins. No Workflow registration or singleton restart is
needed when executable bytes/config behavior match. Upload/deploy each once with
durable intents; unknown outcomes reconcile by GET only.

New inference/media/compute spendUSD0; no new compute start/stop, project or Workflow
instance. Historical cleanup, broadCI, installed Local/full-film/provider/editorial/
invoice gates remain separate. This fix prevents empty files reaching duration
decoding; it does not make an empty recording playable or promise every corrupt
nonempty file/provider outage will disappear.
