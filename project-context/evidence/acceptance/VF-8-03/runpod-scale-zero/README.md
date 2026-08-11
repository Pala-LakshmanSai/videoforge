# VF-8-03 — RunPod scale-zero control adapter

Result: **PASS**

The server-only adapter loads the RunPod key from macOS Keychain, returns redacted inventory, and
implements guarded endpoint policy/update/delete plus async dispatch/status/cancel/health-drain.
It refuses non-zero minimum workers, more than one maximum worker/GPU, unsafe idle/timeout values,
dispatch before exact zero, mutation after ambiguous state, and cleanup without health-confirmed
zero workers and queue.

Live read-only REST inventory at 2026-08-11T17:22:33.641Z found zero Pods, zero Serverless
endpoints, zero templates, zero network volumes, and zero active workers. No RunPod mutation,
compute start, resource creation, model download, or charge occurred.
