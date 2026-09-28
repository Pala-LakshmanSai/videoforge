# Observed Secure Cloud media rates

Observed 2026-09-28T17:52:03.892488+00:00. RunPod REST v2 catalogue, full NVIDIA GPU; temporary100GB disk allowance USD0.013889/hour. No network volume. These are catalogue observations plus a disk estimate, not billed totals. Request requires16vCPU/64GB RAM; actual placements must pass validation. GPU/host VideoForge speed remains unmeasured until live proof.

| Preference | GPU | GPU USD/hour | All-in100GB estimate | Availability / fallback reason | VideoForge speed |
|---:|---|---:|---:|---|---|
| 1 | NVIDIA RTX PRO 4500 Blackwell Server Edition | 0.7200 | 0.733889 | NONE: Unavailable or unqualified catalogue facts | Unmeasured |
| 2 | NVIDIA RTX PRO 4000 Blackwell | 0.5700 | 0.583889 | NONE: Unavailable or unqualified catalogue facts | Unmeasured |
| 3 | NVIDIA RTX PRO 4500 Blackwell | 0.7200 | 0.733889 | NONE: Unavailable or unqualified catalogue facts | Unmeasured |
| 4 | NVIDIA GeForce RTX 4090 | 0.7400 | 0.753889 | NONE: Unavailable or unqualified catalogue facts | Unmeasured |
| 5 | NVIDIA L40S | 1.0900 | 1.103889 | LOW: Exceeds approved USD0.80/hour | Unmeasured |
| 6 | NVIDIA RTX A6000 | 0.5300 | 0.543889 | NONE: Unavailable or unqualified catalogue facts | Unmeasured |
| 7 | NVIDIA A40 | 0.4900 | 0.503889 | LOW: Eligible catalogue; falls back only after confirmed capacity refusal | Unmeasured |
| 8 | NVIDIA L4 | 0.4900 | 0.503889 | NONE: Unavailable or unqualified catalogue facts | Unmeasured |
| 9 | NVIDIA GeForce RTX 3090 | 0.5000 | 0.513889 | NONE: Unavailable or unqualified catalogue facts | Unmeasured |
| 10 | NVIDIA L40 | 0.8200 | 0.833889 | NONE: Exceeds approved USD0.80/hour | Unmeasured |
| 11 | NVIDIA RTX 6000 Ada Generation | 0.8400 | 0.853889 | NONE: Exceeds approved USD0.80/hour | Unmeasured |
| 12 | NVIDIA RTX PRO 5000 Blackwell | 0.9600 | 0.973889 | NONE: Exceeds approved USD0.80/hour | Unmeasured |
| 13 | NVIDIA GeForce RTX 5090 | 0.9900 | 1.003889 | NONE: Exceeds approved USD0.80/hour | Unmeasured |
| 14 | NVIDIA RTX A5000 | 0.2700 | 0.283889 | NONE: Unavailable or unqualified catalogue facts | Unmeasured |
| 15 | NVIDIA RTX 4000 Ada Generation | 0.2800 | 0.293889 | NONE: Unavailable or unqualified catalogue facts | Unmeasured |
| 16 | NVIDIA RTX A4500 | 0.2500 | 0.263889 | NONE: Unavailable or unqualified catalogue facts | Unmeasured |
| 17 | NVIDIA RTX A4000 | 0.2500 | 0.263889 | NONE: Unavailable or unqualified catalogue facts | Unmeasured |
| 18 | NVIDIA RTX 2000 Ada Generation | 0.2400 | 0.253889 | NONE: Unavailable or unqualified catalogue facts | Unmeasured |

Waiting rents nothing. The order remains Frontier’s reference order; no VideoForge speed ranking is inferred. Immutable runtime identity is in QUALIFIED_RUNTIME.json. Actual rate/resources, billing boundaries and shutdown are separate live gates.

## Observed retained ASR placement

At 18:33 UTC, rank 1 rented with 100GB temporary disk, 16 vCPU and 94GB host RAM. Controller-recorded all-in rate was USD0.733889/hour, matching its estimate; billing was not observed. Processing took 10.956 seconds for the retained 159.216-second voiceover. The first live completion was rejected by an ASR JSON serialization check, so this is execution timing rather than successful ASR acceptance. Complete independent provider inventory confirmed the owned Pod absent at 18:35 UTC.

No fallback was needed. This CPU media measurement does not establish GPU rendering speed or justify changing the preference order. See LIVE_ASR_ACCEPTANCE.json for phase boundaries and cleanup evidence.
