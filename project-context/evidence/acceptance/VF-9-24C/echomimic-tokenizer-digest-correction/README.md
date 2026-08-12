# VF-9-24C EchoMimic tokenizer digest correction

Corrected the truncated pinned SHA-256 for `base/google/umt5-xxl/tokenizer.json` by restoring its
final `b`. Added a regression assertion that every required digest is exactly 64 characters and
that this immutable revision pin is present.

Canonical local verification passed, including 38/38 installed-Chrome tests. Hosted verify run
`31622000295` and exact-entrypoint image build run `31621999971` passed. Published image:
`ghcr.io/pala-lakshmansai/videoforge-avatar-primary@sha256:d0e487d13bf19b74d09af5c7bb3b800eb2faa75dcce6eca9e155a48b0403ffe9`.
RunPod calls and spend were `$0`.
