# VF-9-24A EchoMimic observability repair

Exited/terminated endpoint history no longer counts as active concurrency. The qualification runner
now records a durable redacted journal before the first mutation and after resource, job, worker,
progress, cancellation, deletion, and final-inventory transitions. The worker emits entrypoint,
startup, progress, and classified bootstrap-failure events.

Canonical local verification passed, including 38/38 installed-Chrome tests and 219/219 web tests.
The hosted image smoke executed the exact default Docker entrypoint and published
`ghcr.io/pala-lakshmansai/videoforge-avatar-primary@sha256:79e799a1312168123aed0809cc93c9d83047bef2354ff5dbac77caed64da87f1`
in run `31618931186`. Hosted verify run `31618929757` passed. RunPod calls and spend were `$0`.

No sample rerun is authorized until the user supplies a fresh exact RunPod spend cap.
