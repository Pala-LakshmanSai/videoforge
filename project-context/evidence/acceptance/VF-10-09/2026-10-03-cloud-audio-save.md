# Cloud audio save recovery — 2026-10-03

Checkpoint V2-09, branch `codex/seedance-video`. The user authorized fixing the Cloud-only failure and production publication. Source fixes `43a37ca6`, `29cabb0c`; Linux test isolation `844992af`.

## First failure and preserved identity

The inspected 20m09.104s run saved its transcript, 227 image prompts and 15 of 71 selected audio spans. The failed Cloud span reached native rendering, checking and SAVING, then obtained primary-output upload authority for 437,804 verified bytes. Its primary object and result document were absent from R2. No result-document authority was issued and no image/avatar API jobs were submitted. The terminal code was `MEDIA_EXECUTION_FAILED`, replay count zero. The exact network/HTTP error was not retained; a transient transport failure is an inference, not a confirmed status code. The same source span passed local audio materialization; that output was not uploaded or accepted as a repair.

The old small-output path attempted the upload once. Cloud audio failures were also counted as Local automatic retries; cancelled later spans obscured the aggregate failure, and unsent API lanes appeared failed. All five original reservations are CLEAN with verified cleanup. No terminal attempt, provider inference or accepted-media identity was replayed. The user archived the original project during qualification; its subsequent owner HTTP404 is expected and the archive was preserved.

## Change and qualification

Small Cloud output PUTs now make at most three attempts with fresh exact authority and identical verified bytes. Known transient HTTP/network errors may retry; permanent rejection, identity changes, cancellation and deadline guards stop recovery. Multipart keeps its own reconciliation. HTML/text HTTP failures retain their numeric status; exhausted recovery records `CLOUD_MEDIA_UPLOAD_FAILED` without exposing capabilities. Progress retains failed audio, removes false Local retry counts and marks unsent API lanes BLOCKED.

515 focused web tests, 77 native transport/personal-worker tests and 14 span QA tests pass, along with web/Worker types, changed lint, production build/firewall, secret scan and context validation. [Qualification run37107105656](https://github.com/Pala-LakshmanSai/videoforge/actions/runs/37107105656) passes real offline Linux ASR/span/render, whole-scene/legacy motion and the 77 tests with network disabled. Two pairing tests now mock supported desktop platform facts on Linux. Failed/cancelled predecessor qualification runs published nothing. Temporary publication credentials were removed after success.

Private immutable Cloud image `sha256:dea08f0ad4aa1f02d0ccd26c63e9322a4495899a96f80f29a2c2c8d0706752e0`; all39 packaged Python sources match `sha256:cba210b3032a625fe09f21f707d15880b4dabc53ed8d50093b4e3fdf6187f3e9`; qualified runtime `sha256:8e062f309b35b9bd459dff8a28a57526c0ecc6ae16027d98d2e9574d9022dcea`. Readback downloaded only two small manifest layers. Desktop0.1.47 is unchanged.

## Production and limits

Published source `844992affa241079ca81e28ebe10434e8f8e1aa7`, Worker `35bc258e-1e6b-4658-aeab-038acfdf14c0`, 100% traffic. 51 bindings, 25 secrets and three Workflow identities are preserved. The ongoing authority was cloned for the new runtime with its existing policy; migration249 continues admitting every current/future VideoForge account. Eight actual runtime scopes pass, an unknown account is denied, six valid-session catalogs report Cloud available, and foreign project HTTP404 remains enforced.

All23 public assets are byte-exact; root HTML and router behavior match. Initial public status propagation lag was reconciled read-only, without repeating upload/deploy. Real Chrome verifies an existing same-account Cloud deadline failure: audio FAILED, image/avatar BLOCKED, no false paid-provider terminal warning. Cloud Create remains enabled with the same coverage controls. The exact original 15-saved/55-cancelled/227-unsent case has regression proof and prepublication live reproduction; it cannot receive postpublication UI readback after the user's archive.

Queue behavior is unchanged: submitting **Create project & start** adds the project automatically; further submitted projects wait under one active workload per account and two different accounts globally. Merely filling a form does not enqueue it.

USD0 new provider/compute starts, no new Workflow instance or paid canary. Final complete authenticated RunPod inventory at 07:49Z is zero Pods; historical UNKNOWN cleanup evidence remains unresolved independently. This repair does not claim a fresh paid full-film completion, Local installation acceptance, editorial quality, long-run performance or settled invoice. Private diagnostic/audio/browser evidence stays local and contains no published customer identifiers.
