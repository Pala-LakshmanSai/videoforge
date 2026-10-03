# Create and queue handoff — 2026-10-03

Checkpoint V2-09; branch `codex/seedance-video`. User explicitly authorized fixing slow Create/queue handoff and publishing. Production source `9e64470dfee5e6e280b0c507d64cf24d6fbbc3f0`, Worker `2a02ff20-1a41-4354-a367-6a7e3659d2ca`, traffic100%. Publication/status readback succeeded; no ambiguous outcome or duplicate deploy.

## Cause and repair

The inspected33-second user project was created at07:56:35Z, READY/locked after4seconds, and its ASR attempt persisted the next second. Generation admission followed about34seconds later. The browser awaited create, upload, commit and CPU submission sequentially. The CPU route awaited both the exact per-attempt Workflow create and an additional shared continuation-driver check inside its transaction. Individual remote-call timings were not retained, so the complete34seconds cannot be attributed specifically to the driver. The pending UI also displayed a saved-request retry warning while its submission was still running.

Browser CPU submission now awaits the exact Workflow acceptance, then protects the shared-driver check with the actual Cloudflare request `waitUntil`. Internal scheduler calls retain their awaited behavior. Exact Workflow failure still rejects admission; durable attempt/spec/outbox identity, account concurrency and paid replay protections remain. Pending Create says the project is being saved and added to the queue; the saved original-request warning appears only after pending submission ends. No optimistic duplicate submission or background acknowledgement of a failed exact Workflow was introduced.

## Validation and live proof

-254 focused tests pass: stalled shared-driver handoff, internal awaited behavior, exact Workflow rejection, existing adapters/pair guards/queue and Create pending/retry UI. Web/Worker TypeScript and changed lint pass.
-Production and staging builds and bundle firewalls pass. Optional request-context handoff adds exactly211bytes to each static closure. Reviewed limits were remeasured to2,806,738 production and2,803,663 staging; quarantine, forbidden import/provider/native and other growth checks remain. No new dependency.
-Context validation, secret scan and diff checks pass. All39 qualified native Cloud source checksums and Desktop0.1.47 inputs remain unchanged.
-Publication preserves51bindings,25secrets and three Workflow resource identities. All23 public payloads match; the two router-handled asset entries are expected. All four native runtime/config pins match the prior qualified Cloud audio release.
-Seven authenticated account catalogs return Cloud available. Owner project/queue200; another account's project access404. Admission-derived Cloud access from migration0249 remains; no second Cloud allowlist or grant was added.
-An exact READY commit confirmation returned763ms; the identical successful ASR request returned493ms, HTTP200/idempotent replay with the original attempt. The ASR attempt set was unchanged. These are confirmation timings, not a fresh first-submission benchmark.
-Real Chrome reads the published Create Cloud-enabled state and intact coverage controls, the Queue, and the existing project at100% with all production stages complete and GPU released. The existing video continued naturally through publication: seven accepted images, two avatar clips, successful render/review. No new test project or paid generation was submitted; no playback/editorial acceptance is claimed here.

## Spend, cleanup and limits

This repair initiated zero provider inference or paid compute. Existing user work and billing remain separate. At08:09Z, all three rentals for the inspected video are durably CLEAN, and a complete direct RunPod inventory contains zero Pods. Historical UNKNOWN cleanup is preserved and is not resolved by an empty current inventory.

Cloud image remains `sha256:dea08f0ad4aa1f02d0ccd26c63e9322a4495899a96f80f29a2c2c8d0706752e0`, source `sha256:cba210b3032a625fe09f21f707d15880b4dabc53ed8d50093b4e3fdf6187f3e9`, runtime `sha256:8e062f309b35b9bd459dff8a28a57526c0ecc6ae16027d98d2e9574d9022dcea`. Ongoing ordinary pay-per-use policy is unchanged.

Fresh first-submission latency, full-film editorial/playback, installed Local, representative long-film performance and settled invoices remain separate gates; focused checks do not establish whole-repository CI green. Creating a project with **Create project & start** submits it automatically; additional projects wait for the same-account workload slot. Filling a form alone does not enqueue.

Private HTTP, asset, deployment, Chrome and cleanup receipts are retained under `.videoforge/create-handoff-20261003` in the operator checkout. They contain no new paid attempt authority and are not public release artifacts.

## Voiceover title autofill follow-up

User requested filename-derived titles on voiceover selection. Published source `218bcc81f1356e609bc882a559d9240fa57fd8a8`, Worker `e0b23b9b-2564-439f-9f8e-ddee76e06816`, traffic100%. Valid picker/drop selections fill a blank title from the filename without its final .mp3/.wav extension, case-insensitively; other periods remain. Replacing the voiceover updates an unchanged suggestion, while manual titles remain. The240-character title limit, file validation, pending/locked request protection and durable project identity remain.

All222 HostedProductScreens tests, web TypeScript, changed lint, production build, bundle firewall, context/secret/diff checks pass. Picker MP3/uppercase extension, replacement WAV, preserved manual title and existing dropped-WAV behavior have component proof. An initial test invocation from the repository root lacked the web jsdom setup; rerunning from apps/web passed. No dependency install occurred.

Worker bundle is byte-identical to the prior release; all51bindings,25secrets,three Workflow identities and four native runtime pins remain. All23 public payloads match and Chrome loads the published Create screen. A live Chrome file selection was not performed; component upload proof is kept distinct from browser page readback. No project submission, provider request or paid compute was started/stopped. Existing long-film, installed Local, editorial and invoice gates remain. Private release receipts live under `.videoforge/voiceover-title-20261003`.
