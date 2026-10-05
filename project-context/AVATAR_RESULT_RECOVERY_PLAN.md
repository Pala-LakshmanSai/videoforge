# Avatar result recovery — V2-09 / VF-10-09

User requests root-cause repair, prevention for future projects and production verification.

Observed 5 October 2026: Fal accepted the exact request at 03:43:35 UTC and later
reported COMPLETED with 10.684 seconds inference. Cloudflare API coordinator step29
ran 03:46:01–03:56:01, then recorded WorkflowInternalError. Its automatic retry
accepted the same saved avatar in 4.8 seconds. The downstream render succeeded and
all three existing project rentals became CLEAN. No operator replay was needed.
The provider response does not establish its exact completion timestamp; queue time
before the platform stall is not attributed to inference or claimed eliminated.

Repair sequence:

1. Retain exact native/provider/Workflow evidence and original paid identities.
2. Configure API coordinator attempts for two minutes, two-second constant retry,
   maximum30 retries. This replaces the implicit ten-minute attempt timeout while
   retaining roughly the original hour of total transient-recovery allowance.
3. Prove persisted avatar recovery, unchanged accepted images, no new provider POST,
   and the exact Workflow timeout/retry configuration. Keep existing claim/receipt,
   account-routing, cancellation and UNKNOWN fences.
4. Run affected provider/coordinator tests, Web/Worker types, owned lint/format,
   both bundles, context and secret checks; retain unrelated baseline CI failures.
5. Push and publish the exact reviewed source with current bindings, secrets,
   Workflow registrations and qualified renderer pins. Verify assets/status and
   existing project completion in Chrome. Record release and memory readbacks.

No new generation, Pod rental, model or schema migration is required. Existing
user-requested work completes under its original lifecycle. Shorter retry bounds
prevent this default ten-minute wait; external service outages can still delay work.
