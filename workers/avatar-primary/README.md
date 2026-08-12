# Primary avatar worker

The fixture health path remains provider-free. The production container pins EchoMimicV3-Flash source,
Flash weights, Wan 1.3B InP, and Chinese Wav2Vec revisions; accepts only short span-audio jobs; uploads
the MP4 through a caller-owned signed URL; and returns checksum/probe lineage without URLs.

Qualification alone may use `INLINE_QUALIFICATION_V1`: owned inputs, exact checksums, exactly five
frames, 2 MiB per input, and a 64 MiB output ceiling. Ordinary runtime jobs cannot use inline bytes.

```sh
PYTHONPATH=src python3 -m videoforge_avatar_primary
python3 -m unittest discover -s tests
```

The process can be healthy while the model remains `not_loaded`. RunPod dispatch still requires the
VF-8-03 single-use claim, `workersMin=0`, `workersMax=1`, cancellation, drain, and zero confirmation.
