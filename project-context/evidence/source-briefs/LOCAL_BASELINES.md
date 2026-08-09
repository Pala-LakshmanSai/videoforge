# Local baseline brief

Snapshot: 2026-08-08  
Purpose: preserve only the proven lessons needed by VideoForge so a new chat does not need to load unrelated repositories.

These absolute paths are optional local evidence, not build dependencies.

## QuickCut/video-production software

- Path: `/Volumes/ESD-USB/video production software`
- Snapshot commit: `1838955297cbe24a49b9b6da5d1c1be90ca1d249`
- Reuse:
  - `src/providers/transcription/whisper-local.ts`: native `whisper.cpp base.en`, FFmpeg 16 kHz mono normalization, greedy decode, word-like JSON offsets, Metal/FlashAttention locally.
  - Postgres/queue progress pattern with SSE and polling fallback.
  - Simple editorial flow and human-readable stage UI.
- Improve:
  - Reconcile decoded words against an optional supplied exact script.
  - Use true FFprobe audio duration, not last spoken-word end.
  - Durable multi-user attempts/outbox/cost and authoritative provider reconciliation.
- Do not copy the entire repo or treat its implementation as current VideoForge authority.

## ImageForge

- Path: `/Volumes/ESD-USB/ImageForge`
- Snapshot commit: `e2dc46825cab8ecba7a5babff18d31d27b58f6e9`
- Reuse:
  - Dark visual tokens/primitives and truthful pending/blocker UX.
  - Owner-bound task/worker leases, immutable artifacts/checksums, authoritative RunPod reconciliation, fail-closed paid mutations.
- Do not copy its desktop/local-queue/image-only architecture wholesale.

## VoiceStamp

- Path: `/Users/lakshmansai/Desktop/VoiceStamp/app.py`
- SHA-256: `7d8b12eac18d0051e320a137f8ed249a42222b867f5bfb12320bd01f1f30bcc8`
- Reuse: compact `faster-whisper` CPU INT8 implementation with word timestamps and JSON.
- VideoForge local M4 preference remains QuickCut's measured `whisper.cpp` Metal path; production may benchmark both inside the image/media worker once.

## Portability rule

If these paths are missing, continue from this brief and owned/synthetic fixtures. Do not block implementation, alter decisions, or put private source files into VideoForge.
