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
without version readback. The failed instance has not been restarted by this investigation.

Sources: [REST create](https://developers.cloudflare.com/api/resources/workflows/subresources/instances/methods/create/),
[REST status](https://developers.cloudflare.com/api/resources/workflows/subresources/instances/subresources/status/methods/edit/),
[Workflow lifecycle](https://developers.cloudflare.com/workflows/build/trigger-workflows/).
