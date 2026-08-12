# VF-9-21 Elias AvatarForcing sample

The exact private Elias Yoder image and first 10.12 seconds of the exact private voiceover were sent
only to the pinned AvatarForcing worker. No MuseTalk, SkyReels, or LongCat path ran. Private source,
audio, and generated media bytes are not committed.

AvatarForcing inference reached `COMPLETED` four times, but no reviewable MP4 crossed the RunPod
result boundary. Attempt 1 completed in 227233 ms, then a REST inventory timeout interrupted local
result persistence. A zero-spend queued retry was cancelled after a conservative worker-record check.
Attempt 3 completed in 173606 ms but returned no `output_base64`. The final pinned worker
`sha256:b2757bda535ad8daf025efacf4bb9d150bfcb11d16c6b81105f203c24ce83cd3`
added a CRF 20, 4 MiB result-delivery ceiling; it completed inference in 249138 ms but RunPod again
returned no MP4 field. After the user authorized a different transport, one temporary private
persisted-output tunnel passed a live round-trip smoke test. The production job completed in
158952 ms, but the worker returned `AVATAR_OUTPUT_MISSING` before uploading any bytes. The result is
not technically accepted and is not ready for visual review.

Measured VF-9-21 spend is `$0.4496891390`. Combined bounded provider spend for VF-9-19 and VF-9-21
is `$0.9759948112`. No further dispatch is authorized. Independent final inventory at
`2026-08-12T12:50:43.675Z` proved zero Pods, workers, endpoints, private templates, and network
volumes.

Next work requires a worker correction that proves the production URL path creates its expected raw
output before upload, then explicit authority for any new capped job. Do not redispatch this image.
