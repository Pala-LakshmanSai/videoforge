# Final assembly WebP and recovery repair — 6 October 2026

Checkpoint V2-09 / VF-10-09. User requests diagnosis, durable prevention, recovery and production publication. Own only render-source intake, render artifact extensions, existing-generation recovery and focused regressions. Base `02ffd974` preserves the latest prompt audit and all prior product fixes; unrelated primary changes remain untouched.

## Confirmed failure

The API coordinator reached READY_TO_RENDER at 12:00:12 UTC with all 151 images, 47 avatar clips and 29 scene videos accepted. Its six render-handoff attempts rejected the verified WebP avatar as HOSTED_V209_RENDER_SOURCE_MISSING: snapshot intake still allowed only JPEG/PNG. No RENDER attempt or final render plan existed. The UI projected pending final assembly and the last released Cloud machine.

The continuation driver was healthy and tried recovery, but the shared dispatch query recognized only historical pairs. API recovery therefore repeated admission after its provider lease ended, raising SQLSTATE23514, active admission lease drifted. This is a second confirmed cause; restarting the driver alone cannot repair it.

## Repair and acceptance

Fal wide-source snapshot accepts all three supported Avatar Hub formats, preserving immutable source bytes, exact profile/version/hash, private revision snapshot and checksum verification. Render object URIs support the WebP extension. Historical SoulX format/qualification rules remain unchanged. Existing ACTIVE API jobs with exact account/workspace/project/revision/generation identity bypass new admission and enter the existing saved Workflow recovery. Cancelled and foreign work stay excluded; downstream claim, result, rental and no-replay guards remain authoritative.

Focused tests exercise JPEG/PNG/WebP full/split render inputs, unsupported SVG rejection, exact snapshot replay and checksum drift, native SQL identity/tenant/revision/cancellation rules, and existing generation/recovery/continuation behavior. 126 focused checks, web/Worker typechecks, changed-file lint, both builds and production bundle firewall pass. The exact new generation query returns the original generation ID through both database-owner and actual configured runtime roles. No schema change is required. Production recovery remains pending.

No new paid qualification project or provider generation is authorized or needed. Ordinary recovery may finish this already admitted video under its recorded original Cloud lifecycle. Do not reset saved jobs, claims, costs, manifests or liabilities. No retained-volume change.

## Remaining gates

Publication, exact production recovery and final technical/cleanup proof are pending. External-provider/platform outages cannot be guaranteed never to happen. Inherited full CI, editorial quality, representative concurrency and invoices remain separate.
