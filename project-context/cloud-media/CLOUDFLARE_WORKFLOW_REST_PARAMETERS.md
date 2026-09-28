# Cloudflare Workflow REST parameter compatibility

Verified 2026-09-28 during scoped staging qualification. Production routing remained unchanged.

The Workers binding accepts `{ id, params: object }`. REST v4 creates an instance with
`{ instance_id, params: JSON.stringify(object) }`. The REST create API ignored the SDK `id`
field and generated a different instance ID; the accepted response was reconciled by its
actual ID without a second create request. Preserve create intents and reconcile successful
response IDs before considering any retry.

The CPU instance created with the correct REST fields returned JSON-encoded string params
and passed that string to `WorkflowEvent.payload`. The previous UUID validator rejected it
before its first step. Independent readback showed an errored instance with zero steps;
DB observation showed no reservation, admission or budget debit. This was startup failure,
not proof of Cloud media execution.

`hosted-workflow.ts` now decodes one bounded JSON string at the existing lineage trust
boundary, accepts the binding object, and requires exactly the same three UUID fields.
Tests cover string/object parity, malformed and non-exact inputs, and cross-tenant rejection
before provider observation. Operator readback checks decode params independently and
compare the exact committed account/workspace/attempt lineage.

Recovery must use the known instance identity and preserve the create intent. The official
status API supports `PATCH .../status` with `{ status: "restart" }`; there is no documented
version selector in that request. Restart cancels in-progress steps and erases intermediate
state. Do not use it to replay a paid create, and do not assume it runs new deployed code
without version readback. The operator sent one guarded restart after registering the new Workflow definitions.
The immediate queued readback still showed the old version. A later independent readback
showed the same instance running the newly registered version, with the UUID boundary
and durable Cloud observations completed. No coordination alias or second create was needed.
This demonstrates startup recovery for this instance, not media output acceptance.

Sources: [REST create](https://developers.cloudflare.com/api/resources/workflows/subresources/instances/methods/create/),
[REST status](https://developers.cloudflare.com/api/resources/workflows/subresources/instances/subresources/status/methods/edit/),
[Workflow lifecycle](https://developers.cloudflare.com/workflows/build/trigger-workflows/).

## Register Workflow definitions after Worker version deployment

The verified staging Worker version changed while each Workflow resource still listed only
its original definition version. Installed Wrangler's `triggersDeploy` performs a PUT for
each locally defined Workflow, using only `script_name` and `class_name`; version upload
and deployment alone did not register those definitions in this qualification.

The operator updated only the two existing staging resources. Independent readback verified
new definition version IDs, unchanged existing instance versions, Worker deployment,
bindings, ten secrets, query redaction, limits and retention. No new instances were created.
A later restart readback established that the existing ASR instance adopted the new definition.

## Terminal SQL parameter inference

Native PostgreSQL read-only PREPARE reproduced SQLSTATE `42883` in the terminal event insert:
`md5($1::text ...)` inferred `$1` as text, while two later comparisons used `attempt_id=$1`
against UUID columns. This rolled back the attempted CPU failure settlement and left the
owned reservation in STOPPING with the CPU attempt OUTBOXED. Runtime column permissions
were independently present. The two comparisons now explicitly use `$1::uuid`.

All 57 SQL statements extracted from the corrected controller compiled under the actual
runtime role in read-only transactions, without executing any mutating statement. A
PostgreSQL engine regression reproduces the old error, compiles the fixed event insert,
and verifies that repeating it produces one event with the exact tenant and attempt lineage.

The earlier placement observations returned RECONCILING without advancing the candidate
or round, despite a valid catalogue with qualifying candidates. Their initial exception
remains unproven; elapsed placement time alone does not establish provider capacity rejection.
