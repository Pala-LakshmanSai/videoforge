# VF-9-24B corrected EchoMimic sample attempt

One job executed on RTX 4090 but failed before model-ready with
`AVATAR_BOOTSTRAP_CACHE_MUTATED`; no inference or MP4 occurred. Provider terminal recovery measured
`167326` ms queue delay and `71112` ms execution. Exact balance delta was `$0.0260412778`.

Diagnosis compared every selected runtime hash to the immutable first-party revisions and found one
truncated tokenizer digest: the committed expectation omitted the final `b`. `VF-9-24C` owns the
provider-free correction and new image build. This attempt cannot be retried under its consumed
one-attempt authority.

The runner cleanup was interrupted by transient API reads, so exact scoped manual API cleanup
deleted the temporary endpoint and template. Three subsequent reads proved zero Pods, running Pods,
active workers, endpoints, private templates, and network volumes with a stable balance.
