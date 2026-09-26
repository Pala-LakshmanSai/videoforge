# Render concurrency qualification

V2-09, source base `f5e64f7c`, current `ffmpeg-render-v3`, exact installed Windows
FFmpeg 8.1.2. Short synthetic fixtures only. No retained Mexico source manifest or
raw avatar assets were available on this Windows checkout; completed attempt
scratch is removed by the worker.

| Candidate | Baseline wall time | Candidate wall time | CPU work | Decision |
|---|---:|---:|---:|---|
| Two mixed eight-scene chunks concurrently | 63.699s mean | 45.303s mean | 150.836s to 205.430s, **36.2% more** | Reject |
| Two filter threads, mixed eight-scene chunk | 47.494s mean | 44.486s mean | 121.328s to 127.688s, **5.2% more** | Reject |

Concurrent chunk encoding reduced wall time by 28.9% on this Intel i5-11300H
four-core/eight-thread laptop. It doubled sampled child-process private memory
from approximately 803 MiB to 1601 MiB. Each chunk's MP4 bytes were identical
across all eight outputs; the decoded reference has exactly 600 frames. Each
chunk retained the same input decoder, filter, encoder and quality settings.

The sequential/concurrent order was reversed in the second pair. The sequential
pair varied from 58.394s to 69.004s; concurrent pairs took 44.208s and 46.398s.
This exposes laptop timing variability and does not establish production savings.

Two filter threads produced identical files and decoded frames in both image-only
and mixed tests. The image-only result had no dependable improvement and used
more CPU. The mixed result was 6.3% faster but also used more CPU.

CPU seconds measure work, not electrical energy or operating cost. Neither
candidate satisfies the evidence needed for the user's cost and resource
constraints. Preserve current serial chunks and filter settings in the release.
Do not infer an untested hardware eligibility rule from these results.

Exact trials, executable identity and output hashes are in `render-parallel.json`.
No provider calls, paid generation or paid compute were used. No global provider
inventory was queried. Full production timing remains unmeasured.
