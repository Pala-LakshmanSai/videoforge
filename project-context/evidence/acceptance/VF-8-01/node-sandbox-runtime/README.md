# VF-8-01 Node sandbox runtime acceptance

Run: 2026-08-11

## Result

PASS. The explicit loopback-only Node `sandbox` mode completed the owned short-video path with
provider calls disabled and external spend `$0`:

1. preflight returned `READY`, zero estimated external cost, and no provider authority;
2. create queued the exact owned voiceover/avatar/style bindings;
3. local ASR, timeline, fixture media barrier, FFmpeg v3, and technical probe reached
   `READY_FOR_REVIEW`;
4. the owned server stopped and restarted over the same workspace-local data root;
5. bootstrap restored the same accepted MP4 checksum;
6. explicit approval enabled download; downloaded bytes matched the accepted SHA-256.

Accepted MP4:

- SHA-256: `sha256:47f3058f831a87b91767929ed0e8715e14959bbeed5ed052bd6995d4ceea3b78`
- bytes: `1999561`
- provider calls: `0`
- external spend: `$0`

The sandbox data root is restricted to a child of workspace `.videoforge/`; missing, relative,
workspace-root, or escaping paths fail closed. Fixture and local modes remain unchanged.
