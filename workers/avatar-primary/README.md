# Primary avatar worker

The fixture health path remains provider-free. The production container pins AvatarForcing source,
AvatarForcing weights, Wan 1.3B, and Wav2Vec revisions; accepts only short span-audio jobs; uploads
the MP4 through a caller-owned signed URL; and returns checksum/probe lineage without URLs.

```sh
PYTHONPATH=src python3 -m videoforge_avatar_primary
python3 -m unittest discover -s tests
```

The process can be healthy while the model remains `not_loaded`. RunPod dispatch still requires the
VF-8-03 single-use claim, `workersMin=0`, `workersMax=1`, cancellation, drain, and zero confirmation.
