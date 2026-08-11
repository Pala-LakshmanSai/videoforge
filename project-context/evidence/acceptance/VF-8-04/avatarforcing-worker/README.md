# VF-8-04 AvatarForcing worker evidence

Attempts 1 and 2 are bounded failures, not qualification results. Both immutable images were public
and digest-verified. Attempt 1 showed provisioning churn without retained handler evidence. Attempt
2 reached one ready worker, but its job remained `IN_PROGRESS` after endpoint health showed an empty
queue and a paid idle worker. No output was produced and no blind dispatch retry occurred.

The operator deleted each exact task-owned endpoint, waited for zero running compute, deleted its
template, and confirmed zero endpoints/templates/workers. Settled balance delta across both attempts
was `$0.1962667361`.

The next corrective image downloads only required pinned model files and emits progress checkpoints.
The runner stops after one worker-allocation retry, handles signals through cleanup, and deletes the
endpoint immediately once its queue is drained instead of paying for an idle worker.
