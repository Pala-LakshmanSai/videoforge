# Project API and compute cost accuracy — 7 October 2026

Checkpoint V2-09 / VF-10-09. User requests accurate project totals from actual API work, generated media counts, machine identity and runtime. No new generation or compute is authorized or used for this repair.

## Evidence and cause

The screenshot project has 7 successful Kie image requests and 2 successful Fal avatar requests with requested audio durations 2.020 + 5.040 = 7.060 seconds. No scene-video request exists. Its known API subtotal is USD0.064544: images0.028000, avatars0.035300, context0.000083 and Luna prompts0.001161. The old top card rounded the plan forecast to USD0.06, whereas the total used incurred API data and four-decimal compute. The screenshot equation USD0.0645 + USD0.0308 = USD0.0953 was correct; the top card had different scope and precision.

Three clean rentals all recorded NVIDIA RTX PRO 4500 Blackwell Server Edition at USD0.7338888889/hour including temporary disk. Confirmed placement-to-cleanup intervals total151.099012 seconds, giving USD0.030803 after six-decimal rounding. The reconciling displayed total is USD0.095347. PostgreSQL timestamps retain microseconds; browser arithmetic uses milliseconds, below the displayed money precision for these rates.

Provider billing timestamps were not retained. Reservation-created-to-cleanup covers160.019326 seconds, but reservation creation precedes a paid machine and is not a defensible exact billing start. Do not replace the confirmed interval with an invented actual charge. The interface explicitly describes this limitation. Kie/Fal prices remain rate estimates, Fal duration is a proxy rather than confirmed billable usage, and missing narration charges stay unconfirmed. No invoice-accuracy claim is made.

## Repair

- The main API card uses the identical incurred-cost source as the total; planned API forecast moves into the breakdown. USD components use six decimals, and the displayed total adds the displayed components without altering stored accounting precision.
- Breakdown shows provider/model, submitted/completed/failed/uncertain request counts, precise requested durations, rate and provider-reported versus estimate basis. Rentals show recorded machine/rate, milliseconds of confirmed duration, and placement/shutdown timestamps. Parallel rentals and earlier attempts remain counted once.
- Saved successful prompt responses contribute their known costs while unresolved, through the existing tenant-scoped loader. Original and replacement identities are unique, refunds apply once, and settlements remain authoritative. Missing/invalid data stays partial; this read path never dispatches or replays work.
- Definite pre-submission rejections are excluded consistently. A missing scene-video plan does not discard a reported charge or hide unknown liability. Reservations are not incurred legacy charges.

## Qualification and publication

Provider-free regression, native runtime-role/RLS readback, build and Chrome evidence are recorded with the final release below. Private raw evidence remains under `.videoforge/cost-accuracy-20261007/` in the primary workspace. This report contains no credentials or private provider payloads.


Local qualification: 515 focused checks across Progress, compute arithmetic/timers, SQL costs and hosted route contracts pass after the final backend repair (231 backend tests and 284 UI/compute tests). The actual-workspace Chrome fixture visibly reconciles USD0.064544 + USD0.030803 = USD0.095347 and opens the precise provider/rental breakdown. Live native PostgreSQL under the production runtime role reproduces the screenshot project subtotal, request counts and tenant filtering. Multiple corrections, missing plan/cost, refunded/settled charges, failed/unsubmitted requests, reservation-only legacy rows and partial totals have regression coverage. No schema or stored project rows change.


Production acceptance: executable `02244e044cf8392d95e36ae899485e6fbe74593b`, Worker `4d04325e-bbf1-4624-8f79-f70bc99c6007` at100percent. Native schema288 is unchanged. All36 public assets match exact size/SHA256, private unauthenticated endpoint401,55bindings/27secret names, Cloud Desktop pins and three Workflow IDs are preserved. Qualified Workflow versions registered as video45573a7f, paire946fb78 and continuation9a87cf6d. The existing coordinator and active jobs were not restarted; the changed read-only cost projection is served by the current Worker.

Signed-in real Chrome on the exact screenshot project displays API USD0.064544 + compute USD0.030803 = total USD0.095347. Expanded breakdown verifies7submitted/7completed images,2submitted/2completed avatars,7.060 requested seconds, individual rental intervals30.901/58.711/61.487 seconds, recorded hourly rate and stopped state. The independent forecast is USD0.064577: planned212/30 avatar seconds differ from submitted7.060 seconds. The distinction is intentional and now visible. Existing completed stages and retained-video link remain present. Final Chrome screenshot/DOM and release receipts are private evidence.

No new inference, media generation, resource allocation, provider retry or native database mutation occurred. All three existing project rentals remain CLEAN. Final types, focused lint/format, both builds/firewall, context, secret scan and independent review passed. Inherited repository-wide formatting/Python lint failures and provider invoice reconciliation remain separate; no universal invoice precision or new full-video run is claimed.
