# VideoForge glossary

Status: normative V2 terminology
Read when: naming schemas, API fields, UI labels, scheduler concepts, worker contracts, or prompts.

These terms separate editorial layout, tenant ownership, application admission, provider transport,
and artifact acceptance. Do not shorten them into ambiguous fields.

| Term | Meaning | Owner |
|---|---|---|
| **Account** | One admitted login identity and billing/audit owner in V2 | Auth/control plane |
| **Default workspace** | The account's single private V2 workspace; team/shared workspaces are deferred | Data/control plane |
| **System built-in** | Explicit immutable preset readable by all admitted accounts; it has no user-owned source bytes | Product catalog |
| **Timeline composition** | One of `AVATAR_FULL`, `IMAGE_FULL`, or `AVATAR_SPLIT_IMAGE`; deterministic code selects it | Scheduler/EDL |
| **Image framing** | Image Style traits for subject arrangement, viewpoint, balance, and crop safety inside one still | Image Style profile |
| **In-image shot role** | Deterministic semantic role such as `ENVIRONMENTAL_WIDE`, `HUMAN_MEDIUM`, `HANDS_ACTION`, `OBJECT_EVIDENCE`, `MACRO_DETAIL`, or `REACTION_RESULT` | Scheduler/prompt compiler |
| **Render geometry** | Exact crop, scale, placement, frame-rate conversion, and zoom filters applied by FFmpeg | Renderer |
| **Timeline plan** | Immutable pre-generation frame/word intervals and required asset slots; no generated asset IDs | Scheduler |
| **Resolved render manifest** | Immutable post-barrier binding from every slot to one accepted checksum and exact render instructions | Renderer |
| **Production manifest** | Immutable provenance index binding tenant/revision, prompts, attempts, QA, costs, models/presets, render manifest, approval, and final MP4 | Delivery/audit |
| **Provider workload** | One admitted video generation request or one explicit lower-priority Mage/SoulX preset preview | Scheduler/control plane |
| **Admission** | Atomic database decision allowing one private provider workload to start while its account holds no other active workload and fewer than two different accounts are active globally; eligible videos always precede previews | Scheduler/control plane |
| **Capacity lease** | Durable database record for one admitted account/workload; exactly two global leases may exist and they must belong to different accounts | Scheduler/control plane |
| **Fair account rotation** | Deterministic selection among eligible account heads; an account may reorder its own waiters without changing cross-account turns | Scheduler/control plane |
| **Queue entry** | Tenant-owned waiting/admitted/terminal binding for one immutable video revision or explicit preset-preview request | Queue |
| **Serverless lane** | One queue endpoint plus exact image, model, sealed volume, configuration, and receipt contract for Mage or SoulX | RunPod/control plane |
| **Endpoint deployment record** | Immutable VideoForge record of endpoint/config/image/model/volume/region/GPU/scaler/timeout identities | Operations |
| **Dispatch token** | VideoForge-generated logical-attempt identity persisted before `/run`; it is not a provider idempotency key | Orchestration |
| **Dispatch outbox** | Transactional row proving an admitted, budget-reserved lane request exists before provider submission | Orchestration |
| **Predispatch authority** | Immutable permission binding tenant/revision/lane/request/resources/deadline/spend before `/run` | Security/control plane |
| **Provider assignment** | Persisted post-dispatch authority joining one unique returned or reconciled RunPod job ID to its predispatch token and attempt before status/output acceptance | Orchestration |
| **Provenance receipt** | VideoForge-signed observed-fact record joined to the provider assignment and containing worker ID when exposed, runtime probes, intended model/volume, manifest checks, timings, and output hashes; it is not provider hardware attestation | Worker/control plane |
| **Accepted output** | The sole checksum-bound durable artifact selected for a dispatch token after ownership, authority, receipt, and technical checks | Orchestration/QA |
| **Model volume** | Existing lane-specific sealed 50 GB EU-RO-1 network volume mounted at `/runpod-volume` and treated read-only by the application | RunPod worker |
| **Job scratch** | Unique worker-local mutable directory for one job; all caches/inputs/outputs use it and every terminal path erases it | Worker |
| **Image Style** | Account-private mutable parent or explicit system built-in with immutable published versions | Styles Hub |
| **Image Style version** | Immutable creative profile selected and pinned to a project revision | Styles Hub/project revision |
| **Avatar Profile** | Account-private mutable named parent or explicit system built-in; it is not a generated speech clip | Avatar Hub |
| **Avatar Profile version** | Immutable ready source payload/hash, consent/provenance, runtime source, and profile-specific crop/compatibility evidence | Avatar Hub |
| **Avatar binding** | Server-resolved project snapshot of exact Profile version/hash/source/checksum and compatibility/crop evidence state | Project revision/avatar lane |
| **Avatar renderer profile** | Immutable source-geometry-specific full/split adapter approved for one Avatar Profile version; profiles never cross sources | Avatar adapter/renderer |
| **Attempt** | One authorized provider/model execution with immutable inputs, settings, lineage, cost, and terminal result | Operations |
| **Zero-worker drain** | Provider evidence that both worker classes (`Active + Flex`) total zero and no queued/running endpoint jobs remain; retained-volume billing is reported separately | Operations |
| **Technical acceptance** | Deterministic decode/duration/format/geometry/hash checks; it does not mean a human liked the pixels | QA |
| **Creative acceptance** | Explicit human approval or a separately approved future visual-QA policy | QA/user |
| **Historical global session** | Replay-only CP-era singleton/manual-Pod contract; it is not V2 admission, queue, or provider authority | Historical compatibility |

Rules:

- API/schema fields use `timeline_composition`, `image_framing`, and `in_image_shot_role` exactly.
- DeepSeek never selects timeline composition, timing, or shot role.
- An Image Style can affect image framing, never timeline layout, avatar placement, or render geometry.
- Account/workspace scope comes from the authenticated server principal, never client ownership input.
- RTX 4090 is endpoint configuration, not a user preference. RTX 5090 requires separate per-lane
  qualification before it can enter a GPU fallback list.
- RunPod does not promise exactly-once execution or billing. VideoForge promises at most one accepted
  output and records any duplicate compute/cost.
- The former global-session, GPU-pair, warm-waiter, Pod-lifecycle, Echo, and shared-catalog terms are
  historical schema/evidence labels only.
