# Cloud startup and execution choice repair

Checkpoint V2-09 / VF-10-09. Production baseline 661b6ddf7a17666568d5758479da37fc8e50c68f.

## Verified changes

- Replace the overlapping platform select with two labeled native radios, Local and Cloud. Local stays default. Existing selection, readiness invalidation, disabled behavior and submission contracts are preserved.
- A concurrent observer must preserve CREATING while complete inventory is empty; the creator still owns its pre-POST fence. A deterministic reproduction previously prevented the creator from sending its one request. The regression now proves exactly one create. Lost provider replies still become UNKNOWN and are never replayed.
- Production candidate: both complete UI/controller files pass 286 tests, web/Worker typechecks, changed lint and native production bundle gates.
- Migration 230 and its manifest are retained as the exact already-applied additive database identity. No migration is replayed by this UI release. Application source retains legacy protocol 1.

## Faster span implementation: held

Implementation 86edb07f099de5519f5fe0964735ed9a0aec66e8; race repair 05252981. Protocol 2 remains unpromoted. CI run 36734889796 passed actual offline Linux ASR/span/full and split render/two-clip streaming with network disabled. Private image digest cbae70d21534b2fc1c5989723a70ea5beaf65a7279c5c690504f186546f5d197 verified private, unlinked and anonymously inaccessible. GitHub Actions package access restored to Read. Migration 230 applied once: 213 ledger rows, max 230, original 212 unchanged. Staging source fb281457, version f758e0d9-d183-4654-bada-c06689259130, retained all 11 secrets/35 bindings/two owned Workflow identities.

The operator component benchmark reused actual 105 saved ranges and the checksum-verified 30m07 narration. It created no new Kie/Fal assets or ASR/render. Initial Cloud reservation was explicitly operator-seeded after normal fair admission, so this is not a fresh-video E2E claim. Startup overlapped production reconciliation and staging observation, matching the reproduced creator-fence race. No Pod placement, output receipt, or actual GPU charge was observed. Generic selection recorded RTX PRO 4000 Blackwell, outside the approved fallback list; no further create is permitted. All 105 CPU attempts are terminal (1 FAILED, 104 CANCELLED) and test authority disabled. UNKNOWN reservation remains STOPPING: complete empty inventory cannot prove an unknown create was refused. Capacity remains held pending exact launch reconciliation; never mark it CLEAN from absence alone.

Native inventory at 16:10:21 UTC contains zero VideoForge Pods and one separately owned Frontier 5 Pod, preserved. The conservative test budget debit is USD 0.20, not an invoice or proven charge. No retained volume. The proposed 5–10 minute span target remains unmeasured; the 72.989788-second 105-cut local benchmark uses fixture transports and is not Cloud timing or Linux checksum equivalence.

## Remaining gates

Actual 105-cut Cloud completion, exact output hashes and cleanup; native browser download bytes; historical Mage/SoulX immutable activation identities; full Postgres clean installation/restore; broader factual/editorial acceptance. Original accepted 30m07 video and accepted media are unchanged. Production publication and real Chrome UI acceptance are recorded separately after native readback.
