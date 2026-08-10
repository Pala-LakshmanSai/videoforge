# VF-1-05 durable repository and workflow adapters

Status: technically verified; VF-1-05 complete

Commits `4f6702bf1457f666c33ef1d279688096362231b8`,
`e8b528c26f9a471e6eb2a246d5626ea4ad7b2b47`,
`bc5ea3202842e01e5f12c345590a55b659df5a6c`, and
`859fc7c8a097050a51dadc6e8a076f6817f9ffc1` add the durable callback/mutation receipt
migrations, concrete PGlite repositories and unit-of-work, local outbox transport, lease fencing,
signed callback processing, reconciliation, cancellation, and accepted-result pairing. Commit
`ce18e938e2f6f60f45c97753ff02811a512de443` contains the final formatting-only gate repair.

All 13 fixed canonical repository scenario bodies execute against fresh concrete adapters. Every
one of the 35 idempotent command signatures (34 unique methods because cancellation is overloaded)
uses a same-transaction exact-input/result receipt. Changed inputs or operations conflict; exact
replays return the original result even after later domain state changes; concurrency, rollback,
result hash integrity, workspace scoping, and bounded codecs are covered.

The workflow adapter fences exact lease state, worker owner, and current trusted time before any
settlement. Unknown acknowledgement is quarantined without blind retry; only explicit
definitely-not-sent may re-enter retry. Callback HMAC binds the exact event/task/attempt/payload
descriptor, claims a durable nonce first, and commits receipt, append-only event, and derived state
in one transaction. Stale workers, cancellation ambiguity, replay, payload mutation, and rollback
are adversarially covered.

The final control-plane suite passed 104/104 and the independent audit closed with no remaining
high or medium finding. The full uncached repository gate passed with zero Turbo cache hits,
Workerd 1/1, Chrome 34/34, and no dependency vulnerability at high severity.

This is local correctness evidence, not a Neon or Cloudflare deployment claim. The correctness-first
first-receipt lock serializes on a workspace row; real multi-session PostgreSQL contention and
head-of-line latency remain a required staging measurement after separate authorization.
