# Fal source and frame preparation speed

Checkpoint V2-09; baseline application commit `f5e64f7c`, production worker 0.1.42.
This local provider-free comparison changes only reusable source preparation and
clip-private allocation reuse. It preserves registration, collar anchoring, cubic
remapping, blend calculations, 25fps, libx264 veryfast CRF18 and two encoder threads.

## Changes

- `prepare_fal_source()` verifies the source checksum once and stores the resized
  1080p background, ORB features and blend mask as read-only arrays. The caller
  owns this object for one job. Its identity is resolved path plus SHA256; each
  clip checks path, size and modification time before reuse.
- Source preparation hashes and decodes the same held bytes, with file identity,
  size and timestamp checks before/after reading and preparation. It releases the
  encoded-byte buffer before creating features. A path is never reopened between
  hashing and decoding.
- Every clip still estimates its own transform and owns fresh optical-flow state,
  inverse maps, floating-point blend buffer and output buffers. No moving frame
  state is reused between clips.
- Remapping and blending use reusable arrays while retaining the same individual
  float32 multiply/add operations and uint8 conversion. Input frames stay intact.

## Local measurements

The comparison used Python 3.12.14, OpenCV 4.10.0, NumPy 2.5.3 and the same pinned
FFmpeg executable for both variants. Native tests were coordinated with the other
agents to avoid overlapping CPU-heavy benchmarks. `results.json` contains every
repeat, source/tool hashes and output parity facts.

| Workload | Baseline median | Candidate median | Reduction |
|---|---:|---:|---:|
| 100 raw frames, 512px registered region, four repeats | 2.393s | 1.926s | 19.52% |
| 100 raw frames, 1024px registered region, four repeats | 4.824s | 4.542s | 5.84% |
| Complete 75-frame wide clip, three repeats, reused source | 2.445s | 1.981s | 18.96% |

All raw-frame digests match, including the large region. All six encoded MP4 files
are byte-identical, and their decoded video digests match. Candidate source
preparation itself costs 0.137s median, versus 0.131s for old preparation; the
benefit comes from doing it once instead of once per clip. Applying those medians
to 90 clips sharing a source gives 11.83s old preparation versus 0.137s new
preparation. That calculation is an extrapolation, not a measured 90-clip job.

The large-region repeats are noisier than the small-region repeats. These are
synthetic detailed backgrounds and moving crops, not accepted retained production
avatars. They support the mechanical parity and local optimization; they do not
establish a full-video or overall production speed percentage. Electricity and
whole-process peak memory were not measured. No extra inference, transfer,
concurrency, GPU/provider action, or paid compute was used.

After the source-read identity hardening, one cheap 75-frame clip pair was rerun.
Both encoded files remain byte-identical and the decoded digest matches every
original output. The final source identity is recorded in
`final-source-verification.json` (SHA256
`133e76ef36c3472f8cae7cb692a3069455c3c9858b29d586dd4e4bafcf0f4e51`).
The pair took 1.854s baseline and 1.587s candidate (14.43% reduction); this is a
single identity verification, not a new repeated timing qualification. The raw
frame blend/remap implementation was unchanged by the source-read hardening.

## Verification and reproduction

`test_fal_wide.py`: 14 tests pass, including source checksum/path/replacement
rejection, cached registration parity, normal and clipped/rotated exact output
pixels, unchanged face/input pixels, collar behavior, clip-state reset, alignment
fallback and existing crop safeguards. Further tests bind hashing and decoding to
identical bytes, reject same-size mutation during preparation and preserve the
empty-source error. Focused Ruff and diff checks pass.

Run `benchmark.py --baseline <frozen-fal_wide.py> --ffmpeg <pinned-ffmpeg.exe>
--scratch <temporary-directory>` with the image-media source on PYTHONPATH. The
baseline file is the `fal_wide.py` blob at `f5e64f7c`; its SHA256 and FFmpeg identity
are recorded in `results.json`. Generated synthetic source, clips and output media
stay outside the repository.

Remaining integration/release gates are owned by the root task: combined render
tests, exact installer CI, installed-worker verification and ordinary job timing.
No deployment, commit, push or provider inventory refresh was performed by this
subtask. Current paid-compute state was not queried; no paid compute was started.
