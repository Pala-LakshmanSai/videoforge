# VideoForge glossary

Status: normative terminology  
Read when: naming schemas, API fields, UI labels, scheduler concepts, or prompt fields.

These terms intentionally separate editorial layout from the visual treatment inside a generated image. Do not shorten them into an ambiguous `composition` field in code.

| Term | Meaning | Owner |
|---|---|---|
| **Timeline composition** | One of `AVATAR_FULL`, `IMAGE_FULL`, or `AVATAR_SPLIT_IMAGE`; deterministic code decides which layout occupies an output interval | Scheduler/EDL |
| **Image framing** | A reusable Image Style trait describing how subjects are arranged inside one still image—negative space, balance, viewpoint, and crop safety | Image Style profile |
| **In-image shot role** | The scheduler-assigned semantic role for an image, such as `ENVIRONMENTAL_WIDE`, `HUMAN_MEDIUM`, `HANDS_ACTION`, `OBJECT_EVIDENCE`, `MACRO_DETAIL`, or `REACTION_RESULT` | Deterministic scheduler/prompt compiler |
| **Render geometry** | Exact crop, scale, placement, frame rate conversion, and zoom filters applied by FFmpeg | Renderer |
| **Timeline plan** | Immutable pre-generation intervals plus required asset slots; contains no generated asset IDs | Scheduler |
| **Resolved render manifest** | Immutable post-barrier binding from every timeline slot to an accepted asset/checksum and exact render instructions | Renderer |
| **Production manifest** | Immutable downloadable provenance index binding the revision, prompts, attempts, QA, costs, model/style lineage, resolved render manifest, and final MP4 | Delivery/audit |
| **Global app scope** | The one shared MVP namespace for all admitted users, catalogs, projects, queue, usage, and results; it is not a customer tenant or role boundary | Control plane |
| **Admission** | Durable app-access binding created atomically with consumption of one unique, single-use invite code after Better Auth resolves the same verified email; returning admitted users are not prompted again | Auth/control plane |
| **Generation session** | Singleton global execution window opened by the first idle Generate; it owns one immutable Mage/Echo GPU pair until the queue is empty and both Pods are proven absent | Queue/control plane |
| **Session GPU pair** | Exact receipt-bound Mage and Echo offerings selected only when opening an idle generation session and inherited by every queued entry | RunPod control |
| **Queue entry** | Versioned global binding of one project revision to the current generation session; exactly one may be active and all others wait in shared order | Queue |
| **Active lane demand** | Work required by the sole active video for one model lane; only this may create/recreate a Pod or dispatch work | RunPod control |
| **Waiting warm hint** | Presence of a waiting row may retain an already-running exact lane Pod warm, but never creates/recreates one or dispatches work | Queue/RunPod control |
| **Image Style** | Global/system identity with an active published version and optional separate draft version | Styles Hub |
| **Image Style version** | Immutable published creative profile selected and pinned to a project revision | Styles Hub/project revision |
| **Avatar Hub** | Private global catalog shared by admitted users where a source is uploaded once, named, approved, versioned, archived, and selected for later projects | Avatar catalog |
| **Avatar Profile** | Mutable named parent/catalog identity with one active ready version; it is not a generated speech clip | Avatar Hub |
| **Avatar Profile version** | Immutable ready source payload/hash and canonical runtime asset used by projects; replacing source pixels creates another version | Avatar Hub |
| **Avatar binding** | Server-resolved project snapshot of profile ID, exact version/hash, runtime source asset/checksum, preparation/validation profiles, compatibility state at preflight, and matching immutable terminal evidence when one exists | Project revision/avatar worker |
| **Avatar renderer source profile** | Immutable adapter label coupling an accepted Echo asset's measured native dimensions/rate to its exact full/split crops and direct 30 fps conversion; no historical-model profile may be substituted | Avatar adapter/renderer |
| **Attempt** | One provider/model execution with immutable inputs, settings, lineage, cost, and result | Operations |
| **Technical acceptance** | Deterministic decode/duration/format/geometry checks; it is not a claim that a human liked the pixels | QA |
| **Creative acceptance** | Human approval or an explicitly approved future visual-QA policy | QA/user |

Rules:

- API/schema fields use `timeline_composition`, `image_framing`, and `in_image_shot_role` exactly.
- DeepSeek never selects a timeline composition or in-image shot role. It receives the role and writes literal scene content that honors it.
- An Image Style may influence image framing, but never timeline timing, layout, avatar placement, or render geometry.
- GPU selection is always session-scoped in MVP. Never name or store it as a user preference or
  per-project pair.
- `workspace_id` in existing v1 fixtures means historical byte-compatible namespace only; it does
  not imply active MVP multi-tenancy or roles.
