# VF-9-09 compliant Mage quality confirmation

Status: exact safe transport failure; no output and no retry.

- Exact candidate, RTX 4090 allowlist, compliant prompt SHA-256
  `4fa322738100692b9aea5e8d0d65d5b022e5c2a246b35992fa5c7b1b118a8856`, seed
  `20260812`, 1280x720.
- Initial inventory was absolute zero. Template, scale-zero endpoint, and one job were created; dispatch
  acknowledgement was recorded.
- A status read after 150.769 seconds returned `RUNPOD_MUTATION_AMBIGUOUS`. No blind redispatch or
  qualification retry occurred.
- The acknowledged job was cancelled, queue drained, endpoint deleted, template deleted, and an
  independent inventory proved zero pods/workers/endpoints/templates/volumes.
- Starting and ending balances were both `$7.4647326695`; measured spend `$0`.
- No PNG was produced, so image quality remains unconfirmed. The concrete reliability defect is that a
  transient status-read transport ambiguity currently aborts/cancels immediately instead of bounded
  same-job status reconciliation.
