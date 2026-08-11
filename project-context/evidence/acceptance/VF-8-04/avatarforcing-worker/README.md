# VF-8-04 AvatarForcing worker evidence

Attempts 1 through 3 are bounded failures, not qualification results. All immutable images were public
and digest-verified. Attempt 1 showed provisioning churn without retained handler evidence. Attempt
2 reached one ready worker, but its job remained `IN_PROGRESS` after endpoint health showed an empty
queue and a paid idle worker. No output was produced and no blind dispatch retry occurred.

Attempt 3 used the selective-download image and stopped when RunPod retained one exited worker record
while starting its one replacement. At most one pod was running, the job remained `IN_PROGRESS`, and
no output or model-bootstrap progress was produced. The endpoint and template were deleted immediately;
settled balance delta was `$0`.

Attempt 4 allowed the sequential replacement but RunPod left its only allocation `EXITED` for more
than five minutes. The operator purged the queued request and deleted the exact endpoint and template.
No model-bootstrap progress or output was produced; settled balance delta was `$0.0057522222`.

The operator deleted each exact task-owned endpoint, waited for zero running compute, deleted its
template, and confirmed zero endpoints/templates/workers. Settled balance delta across all attempts
was `$0.1962667361`.

The next corrective image downloads only required pinned model files and emits progress checkpoints.
The runner caps concurrent running compute at one pod, stops after five minutes without a running pod,
handles signals through cleanup, and deletes the
endpoint immediately once its queue is drained instead of paying for an idle worker.
