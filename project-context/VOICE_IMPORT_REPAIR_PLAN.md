# Voice import repair — V2-09 / VF-10-09

User request, 2026-10-07: fix Import and save, verify existing functionality, publish to production. Exact test voice is `lxYfHSkYm1EzQzGhdbfc`.

Baseline executable `71af8de83aa04e0d05b19dbedd2b223b4a7a7c82` / Worker `5a201da0-ea5a-4edb-bd58-33742d225c88` at 100%. Preserve concurrent prompt/ASR/player releases and unrelated dirty primary changes.

Confirmed cause: authenticated provider library already contains Jessica Anne Bogart. Repeating its metadata import returns HTTP 400 with `already_imported`. The route unconditionally POSTs before private save, then maps that response to J1TTS_UNAVAILABLE and generic catalog copy. Live browser reproduction returns HTTP 503 after approximately 6 seconds.

Repair: refresh provider catalog before import; save an existing exact ID using current authenticated account/workspace. For a new import, submit once and reconcile exact provider availability after success, duplicate rejection or uncertain transport. Never substitute a voice or replay provider submission. Use import-specific failure copy. Preserve tenant authorization, saved/starred behavior, cache behavior for ordinary reads, TTS durable identities, playback/archive and current provider caps.

Acceptance: regressions for warm cache, duplicate/already available, fresh accepted/duplicate/uncertain import, definitive rejection and wrong-ID denial; nearest voice/script/archive/library gates, web suite, types/lint/build/firewalls/context/secret checks. Production must preserve all bindings, secret names, native schema, accepted media and Workflow identities; verify published asset hashes, real Chrome import/save and persistence, voice selection and retained audio playback. No new TTS/video/GPU/paid canary. Native schema and media runtime remain unchanged.

Owner: this chat owns j1tts.ts, its route tests and this narrow context/evidence. No other chat changes are reverted.
