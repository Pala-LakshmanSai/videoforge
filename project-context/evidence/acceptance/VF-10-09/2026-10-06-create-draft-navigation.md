# V2-09: New project draft survives dock navigation

User authorizes the fix and production publication on 2026-10-06. Isolated branch
`codex/create-draft-persistence` starts from latest production handoff `79197d15`,
whose executable `f98c5933` / Worker `40cc0991` includes the ASR, prompt and WebP fixes.
Primary workspace changes are preserved.

## Cause and repair

The hosted Create route owns all form inputs in component state. Dock navigation destroys
that component. Native signed-in Chrome reproduces an empty title and opening reset to 3
minutes after Settings and return. The new regression fails before repair at the empty title.

Reuse React memory within the admitted account/workspace lifetime. Retain every input,
including the original local File, script/voice, exact preset versions, composition, keywords,
seed, defaults-initialized flags and ambiguous Create body/key/lock/upload metadata. Store
subscriptions keep asynchronous request-state changes visible after remount. Readiness and
preflight remain fresh; no browser draft grants authority or submits work. Successful Create
replaces the draft store; old callbacks retain their old store. Changed admission and sign-out
unmount it, preventing another account from receiving the draft. No browser storage, provider,
server, schema, Desktop or Cloud image changes are needed. Reload/closed-tab persistence is
outside this navigation fix.

## Verification

Provider-free regressions cover voiceover/File remount, script/voice remount, opening and
coverage retention, original request identity after an uncertain response, successful reset,
and account isolation. All 298 nearby UI/auth/voice tests, types, touched-file lint, both builds and production
quarantine checks pass. Canonical `pnpm verify` remains blocked by inherited formatting and
missing local uv 0.8.13; it is not claimed green. Async mutation tests wait for the actual
retry/unlock controls to become enabled before proceeding. Installed-Chrome navigation exercises Queue, Voices, Avatar Hub,
Image Styles, Library and Settings at the stable localhost URL. Settings prepares its existing
connect commands; no project/provider/media action is submitted. Production Progress will be
included in signed-in final acceptance because the local fixture has no Progress dock entry.

Production is verified at executable `e294ed16f3f1fa970d945641e0e8dd5f7a5cdb97` /
Worker `bdbd7395-f420-4f2c-b3a6-a92b68f43f72`, 100% traffic. All 36 public asset sizes/hashes
match; anonymous private catalog remains 401. All 55 bindings, 27 secrets, six resources,
three Workflow identities, crons, domain, Desktop 0.1.52 and qualified Cloud pins are preserved.
OAuth expired during read-only publication preflight; the existing Wrangler authentication
refresh succeeded before publication. No upload/deploy action was retried.

Signed-in native Chrome verifies all eight dock destinations, including the running project's
Progress and owner-only Centralized Library. Title, selected synthetic local WAV, Cloud, Avatar
Off, custom 1.5-minute opening and 25% coverage remain exact after every return. Optional image
keywords and seed remain; script text and selected voice survive Manage voices and return.
No console errors and no Create click. Source-mode switching retains its existing explicit audio
reset behavior; the requested dock retention is independently proven. Private screenshot and
interaction evidence: `.videoforge/create-draft-20261006/production-draft-retained.png` and
`browser-proof.json`. Context and tracked secret scan pass. The branch is pushed; production
server/schema/worker images are unchanged.

## Provider and shutdown state

USD 0 new paid generation/compute. No compute or Workflow instance is started, restarted or
terminated. Existing running user projects and cleanup identities remain untouched. Inherited
broad CI/tooling, full-film, provider, installed Local, editorial and invoice gates remain separate.
