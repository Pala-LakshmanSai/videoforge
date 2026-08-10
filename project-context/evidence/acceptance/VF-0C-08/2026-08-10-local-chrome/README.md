# VF-0C-08 local Chrome checkpoint

Status: superseded historical checkpoint. All automated and live-Chrome checks passed through
approval and exact download at this stage, but the gate was still awaiting one manual replay. That
replay and the later zoom refinements are now complete; the canonical accepted closure is
`../2026-08-10-continuous-zoom-v3/`.

## Verified outcome

- Code under test: `eca15bdd539a273c7e59d110729eea54c69685b8`
- Launch: `pnpm dev:local` on loopback-only `http://localhost:4173`
- Browser: installed Google Chrome `151.0.7922.77`
- Project: `project_local_owned_001`, revision `revision_local_owned_001`
- Attempts: `attempt_asr_local_009`, `attempt_render_local_009`
- Candidate: `review_candidate_local_001`
- Approval request binding: candidate ID plus output SHA-256 with
  `If-Match: "vf-project_local_owned_001-revision_local_owned_001-v1"`
- Chrome observed the real local pipeline reach `READY_FOR_REVIEW`, loaded a 1920x1080 H.264/AAC
  MP4 at 30 fps, played it, paused it, and sought to 8.35 s, 16.90 s, 26.19 s, and 27.32 s.
- Visual inspection covered avatar-full, image-full, and avatar-left/image-right split output,
  hard cuts, and motion across two points in one image segment. No prohibited overlay, caption,
  border, title card, decorative graphic, or transition was present.
- The exact candidate was approved in the UI and downloaded through the queryless download URL as
  `/Users/lakshmansai/Downloads/videoforge-local-owned-slice.mp4`.
- Browser console warnings/errors: 0. Page-owned resources were same-origin/data only; the page
  showed local mode, provider calls unauthorized, and `$0` external spend throughout.

## Exact artifact evidence

- Output SHA-256: `177edc7755ff822f306827256bf7a28bcc2d588da9fc78f04fd034a73e0c7285`
- Downloaded SHA-256: `177edc7755ff822f306827256bf7a28bcc2d588da9fc78f04fd034a73e0c7285`
- Bytes: `2,289,067`
- Duration: `37.166667` seconds; `1,115` frames
- Raw run evidence:
  `artifacts/local-media/runs/revision_local_owned_001/attempt_render_local_009/acceptance-evidence.json`
- Raw evidence SHA-256: `084814b9f66909927e1443b46670a34e7fe2d1b4679d50eab6d1384744e26fe3`
- Content-addressed evidence object:
  `artifacts/local-media/objects/sha256/08/084814b9f66909927e1443b46670a34e7fe2d1b4679d50eab6d1384744e26fe3.json`

The downloaded MP4 passed an independent FFprobe read as H.264 1920x1080 30 fps plus mono AAC
48 kHz, duration 37.166667 seconds. The reviewed stream and downloaded file have the same exact
SHA-256, so the downloaded bytes are cryptographically identical to the bytes played and sought in
Chrome before download.

## Historical remaining manual checkpoint

The following checkpoint was accurate when this evidence was captured; it is no longer open.

The installed-Chrome control policy blocks direct navigation to `file://` URLs. No alternate browser
surface or policy workaround was attempted. This prevents the agent from honestly claiming that the
downloaded filesystem path itself was reopened in Chrome, even though it is byte-identical to the
Chrome-played candidate.

To close VF-0C-08 without changing code, open
`/Users/lakshmansai/Downloads/videoforge-local-owned-slice.mp4` in Chrome, press play, seek once, and
confirm it plays. After that confirmation, Phase 1 can start at `VF-1-01`.

## Verification around the checkpoint

- `pnpm test:local-slice`: passed the real API workflow with provider calls off and `$0` spend.
- `TURBO_FORCE=true pnpm verify`: passed with zero Turbo cache hits, 132 web/server/component tests,
  50 TypeScript contract tests, 39 Python contract tests, 19 pipeline tests, 43 worker tests,
  6 root-script tests, 47 synchronized contract files, the tracked-file secret scan, stable
  generated route tree, production build, and 30/30 branded-Chrome fixture journeys.
- The downloaded artifact hash and metadata were rechecked independently after Chrome download.
