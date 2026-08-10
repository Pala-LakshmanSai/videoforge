# VF-0D-01 provider-neutral sandbox harness

Status: technically verified; VF-0D-01 complete

Commits `674c588876333b358dc73a24e64c6a78b9211f93` and
`1155b8ae92ae38731cfdb4840d7abc3d7f1608b2` add the isolated
`@videoforge/provider-sandbox` package without a provider SDK, network transport, credential read,
or model dependency.

The harness checks authorization before any transport operation and binds immutable task, attempt,
owner, profile, input, deadline, cancellation, reservation, and cap facts into canonical evidence.
Reservations, reports, settlements, refunds, and first-class overruns reconcile truthfully across
retries. Unknown acknowledgements keep their commitment until reconciliation; confirmed
non-dispatch refunds it. Timeout, cancellation, cleanup, compound failure, cost overrun, malformed
runtime result, and incompatible fake-scenario paths all fail visibly.

Adversarial regressions cover cyclic/accessor/extra-field inputs, single-read canonicalization,
runtime shape validation, forged/subclassed/proxied transports, and post-import intrinsic tampering.
The deterministic fake is privately branded and validates exact options before registration. The
final independent review reported no open high- or medium-priority correctness finding.

All 39 package tests, lint, typecheck, build, formatting, source scan, full uncached repository
verification, dependency audit, and diff check passed. Provider/network/credential activity was
zero and external spend was `$0`. This evidence does not activate the planned provider
qualification envelope; that remains a separate user-authority checkpoint.
