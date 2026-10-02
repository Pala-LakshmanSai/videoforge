# Seedance video layer — authorized 2026-10-02

Checkpoint V2-09; fresh-project 7% motion coverage. Existing projects keep their immutable plans, image/avatar outputs and render identity. User authorizes implementation, production rollout and bounded acceptance without more approval requests; total provider/compute test spend must not exceed USD4.00. Current production, validation and spend truth live in CURRENT_STATE.yaml.

## Rollback baseline

Application source: f705d6c21bf7b6ab46ba1801fb30eff0b58729f0. Documentation/release checkout: 4d5af76c007b76f39cd6a715b26fefd71ee8e40a. Live Cloudflare Worker: f8b36fdf-b445-4485-94a6-53f706bfc454, 100%. Native worker:0.1.45. Baseline public status verified before edits. Tag pre-seedance-video-20261002 anchors the release checkout.

Rollback: disable fresh motion admission, reconcile already-submitted exact Runware UUIDs and retained R2 outputs, then deploy the baseline Worker version and retained worker manifests. Never drop additive tables or delete accepted media. Rollback only new feature commits, preserving unrelated later changes; do not reset the shared checkout. v2 render documents remain readable by the new worker, which also retains v1 support. Historical requests never gain video jobs.

## Implementation sequence

1. Pin per-revision motion policy at creation. Plan deterministic, spread IMAGE_FULL selections when the canonical timeline is saved. Target floor(totalFrames*0.07) playable frames; no avatar replacement. Request only sufficient provider seconds, minimum1.2 maximum12. Preserve source image and its checksum. A guarded Cloud ASR successor inherits an existing pinned choice before new ASR; legacy predecessors do not opt in.
2. Expand tenant-private SQL with plans and durable video jobs. Claim before paid POST; persist exact UUID and source inputs. Ambiguous submissions are polled by that UUID and never resubmitted. One existing account workload slot covers all three providers. Gate render admission, lease release, cancellation and failure cleanup on paid video settlement.
3. Generate Seedance1.0ProFast bytedance:2@2 at1248x704 (provider720p16:9 preset), USD0.01336/output-second. Source images are signed private URLs. Bounded concurrent submissions overlap remaining Kie/Fal work; bounded serial artifact acceptance protects Worker memory. Validate native H264/geometry/duration and private R2 readback before acceptance. Record actual provider cost.
4. Add version2 resolved manifest/render inputs with explicit VIDEO bindings. Keep immutable timeline segment identity and source images. Render selected motion frames, hard-cut to smooth-zoom still for remainder; retain original narration and existing avatar composition. No provider audio, loops, captions, overlays or decorative transitions. Release both shared renderer/Local worker and Cloud source bundle before enabling new-project policy.
5. Add Progress video stage immediately after images, independent live progress and cost. Preserve wall-clock elapsed timing. Existing projects retain the11-stage layout.
6. Audit SQL tenant fencing/no replay/settlement and old/new render paths. Run focused meaningful regression, contract parity, typecheck, build and context checks. Publish qualified renderers, preserve the previous Cloud authority and create a new authority with matching image/source/runtime pins; verify that match before enabling the app. Then bounded live API+short whole-pipeline acceptance with exact receipts and cleanup. Real Chrome acceptance remains distinct from component and authenticated HTTP checks.

## Acceptance and spend

Old projects: no added stage/provider calls, unchanged retained outputs. New projects: pinned7% plan, footage accepted and used in final1920x1080 film with original duration/audio; concurrent progress truth; cancellation and uncertain submission cannot replay or declare clean prematurely. Tenant isolation must hold.

Use fixtures first. Paid ledger reserves each canary and GPU uptime before dispatch; unknown liabilities count at their full reserved maximum. Stop new paid work before USD4; poll/reconcile existing liability. No30-minute paid benchmark is authorized by this test budget. Production and renderer publication, browser verification, actual invoice and cleanup are separate evidence.

## Live integration audits

Real signer boundary: scene-video is part of the exact artifact key grammar for signed gallery and Local/Cloud input GETs. Provider output acceptance writes directly to private R2; mocked adapter tests do not prove this later signing boundary. Keep CPU attempt deletion restricted to input/render prefixes. A real signer regression covers accepted video GET and rejects arbitrary lanes, trailing paths and traversal.

Runware polling: generic getResponse processing also appears for a never-submitted UUID and proves no admission. Preserve UNKNOWN until a genuine videoInference acknowledgment/receipt or operator evidence settles it. Completed documented videoInference receipts can omit status; validate exact identity, media and cost. Operator-only 0242 records a canonical evidence hash before no-task closure; account-scoped archive absence, same-key positive archive control and full-window zero model task/result/spend history are required. Never resubmit the closed original UUID.

Edge transport: Cloudflare workerd rejects redirect=error during Request construction before dispatch. Use manual redirects in the shared Runware API transport and reject every 3xx without following bearer credentials. Native workerd qualification is required in addition to Node/mocked fetch tests; submit/poll share this boundary. Existing UNKNOWN jobs never automatically retry. The saved pre-network failure proof and exact account-scoped provider absence evidence may authorize one operator-only first actual POST under the unchanged UUID and claim, consumed durably before dispatch.

Operator first-dispatch recovery: migration 0243 requires the unchanged UUID, claim, canonical input hash, accepted source receipt, unexpired VIDEO lease, no competing uncertainty/failure/price change and remaining finite implementation budget. Its append-only receipt is consumed before UNKNOWN→SUBMITTING. Exact replays return authorized=false, including a later UNKNOWN, and runtime/reconciler roles cannot invoke it. Never reset PREPARED or alter a claim/source. Ordinary lost submissions remain polling-only.
