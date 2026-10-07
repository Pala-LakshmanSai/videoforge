# ASR startup and Progress narration player — 2026-10-07

V2-09 / VF-10-09. Publication pending; baseline d4b4a516 / Worker31b8f412.

Exact incident fails301.445 seconds after placement, without a first worker heartbeat or
result. Shared controller STARTING lease was300 seconds; pinned runtime startup allowance
is600 seconds. Align STARTING only; preserve active300-second heartbeat and900-second
rental/deadline/authority/fencing/cleanup. Deleted Pod logs do not establish its underlying
startup failure. Existing rental is CLEAN and deleted404; read-only complete inventory has
zero Pods. Accepted audio and old paid attempt remain exact.

Native player reuses the verified private range streamer after costs and before Progress.
Ownership, current locked revision, committed receipt/hash/size/type/key and recovery
source lineage are checked before storage access. No autoplay or generation retry.

Qualification:146 controller,279 screen and247 backend/SQL focused tests; installedChrome
play/pause/seek/error-retry,1440/390/320px and poll availability pass without provider POST.
Web/Cloudflare/staging builds and production bundle firewalls pass. Aggregate verify is
non-green from inherited134 formatting files and missing uv0.8.13. Full web3315pass1skip, types/lint/secrets/diff pass. Final context and live production
readback remain pending. Runtime package,
native294, v40/profile10 and QAfalse remain unchanged. No new paid work. A same-project
ASR/context/planning canary requires separate finite authority and a preparation-only hold.
