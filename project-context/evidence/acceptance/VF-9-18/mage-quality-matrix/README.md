# VF-9-18 Mage quality matrix

Status: bounded safe provider failure; no image accepted; user review package unavailable.

## Result

- The pinned corrected Mage image, exact negative prompt, RTX 4090-only endpoint, `workersMin=0`,
  `workersMax=1`, one active job, and `$1.50` cap remained locked.
- Attempt 1 acknowledged one exact job, then bounded status reads exhausted with
  `RUNPOD_READ_AMBIGUOUS`. Cancellation, queue drain, endpoint/template deletion, and absolute-zero
  inventory were confirmed. Measured spend: `$0`.
- Attempt 2 remained queued without a first PNG. Operator cancellation through the PTY terminated
  the package wrapper before its `finally` block, so the exact owned endpoint/template were
  recovered manually and independent absolute-zero inventory was confirmed. Measured spend: `$0`.
- The runner was corrected to expose status and enforce a ten-minute per-job deadline without an
  operator signal.
- Attempt 3 remained `IN_QUEUE`, then the independent inventory boundary observed more than one
  current endpoint worker despite the pinned maximum of one. It failed closed with
  `RUNPOD_WORKER_LIMIT_BREACH`, confirmed cancellation and queue drain, deleted the endpoint and
  template, and confirmed absolute-zero inventory. Measured spend: `$0`.
- No inference completed. PNG count: `0`; first-generation matrix count: `0/40`; retries: `0`.
  Relevance, severe-failure, crop, and style thresholds are unmeasured. No style or execution
  profile is promoted.

## Independent provider facts

Checked 2026-08-12 against RunPod first-party documentation:

- `workersMax` is the maximum number of workers running concurrently.
- `/health` is the provider operation for current worker availability and queue status.

Sources:

- <https://docs.runpod.io/api-reference/endpoints/GET/endpoints>
- <https://docs.runpod.io/serverless/endpoints/operation-reference>

## Evidence checksums

- `attempt-01-read-ambiguity.json`:
  `sha256:a41427696e747045409914bbd15663524617234d4598f68b1273e134b41c9a29`
- `attempt-03-worker-limit.json`:
  `sha256:c0cc423e1dfb28606a1eb0f5293e87e662bf94b9ba16773bdd07b15b3e949388`
- Attempt 2 recovery is recorded separately because the wrapper signal prevented normal evidence
  finalization.

Final independent inventory at `2026-08-12T10:42:15.733Z`: zero pods, workers, endpoints,
templates, and volumes.
