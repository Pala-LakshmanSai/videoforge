# VF-8-17 SkyReels stage-visible resume evidence

Status: exact safe provider failure; manual cleanup recovered absolute zero; no redispatch

- Immutable worker image:
  `sha256:8f94062164794c19036605282968a96dd098a09aa91d066b9eaafbb5577f48c9`.
- One A100-80GB-only five-second job used the pinned 960x960 source and selected audio.
- RunPod status polling returned HTTP 503 while the job was `IN_PROGRESS`; the cancellation guard
  confirmed cancellation. No worker result, progress value, or MP4 was accepted.
- Initial automated deletion met transient HTTP 500 responses after the worker had reached `EXITED`.
  No worker was running and `workersMin` stayed zero. Bounded manual retries then deleted the exact
  endpoint and template with HTTP 204. A separate later inventory proved zero Pods, endpoints,
  templates, volumes, and active workers.
- Observed spend was `$0.6784048000`, below the `$2.10` cap. No second dispatch occurred.
- Two bounded SkyReels resumes now produced no candidate. Stop paid retries; continue the locked
  Mage image lane while preserving SkyReels as unpromoted.
