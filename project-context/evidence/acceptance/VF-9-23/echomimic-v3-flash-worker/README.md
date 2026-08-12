# VF-9-23 EchoMimicV3-Flash worker

Provider-free implementation passed at commit `f0829b930e5cf9084312da030f1807a6e269b06f`.
The worker image contains pinned source and minimal inference dependencies, no model weights; exact
weights bootstrap into ephemeral `/models` and fail closed on incomplete or mutated cache.

The sole authorized GHCR build passed import, pinned CLI parser, handler registration, and compile
smokes in run `31612627689`. Published image:
`ghcr.io/pala-lakshmansai/videoforge-avatar-primary@sha256:e4a4b71e5e706ef6da4a62cdc7fa87e0c599e9fe2fa702fea73081ed19b86d73`.
Canonical local verification passed including 38/38 installed-Chrome tests. Hosted verify run
`31612617169` passed. RunPod/model/GPU calls and external provider spend were `$0`.
