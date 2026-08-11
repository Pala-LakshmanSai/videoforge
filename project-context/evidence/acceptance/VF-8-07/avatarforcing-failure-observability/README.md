# VF-8-07 AvatarForcing failure-observability evidence

Status: complete; candidate not promoted

- Source commit: `e4ae8cca5c899b416434ab3cf526997cfb2e61a4`
- GitHub Actions image build: `31529443853` (`success`)
- Immutable image: `ghcr.io/pala-lakshmansai/videoforge-avatar-primary@sha256:359ac1ec415e38058b256e6ab52084bf2c38fe0ad5b32e716f4f974e5802b7a1`
- Built-container smoke: dependency import, complete source compile, exact handler registration.
- Worker failures expose only stable code plus SHA-256 of bounded diagnostic bytes; raw output is
  never returned. Runtime evidence drops all unapproved fields.
- Focused proof: 7 Python worker tests and 203 TypeScript web tests passed; lint/typecheck passed.
- External spend: `$0`; RunPod remained absolute zero.

Static runtime audit found one concrete correction before another paid run: owned input is 44.1 kHz,
upstream resamples to 16 kHz through torchaudio, and worker runtime omitted torchaudio. VF-8-08 adds
the exact torch-matched dependency before one bounded resume. `GATE_AVATAR_003` remains open.
