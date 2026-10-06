# Voice age and single star control — 2026-10-06

Checkpoint V2-09 / VF-10-09. User authorizes Age filtering, visible age details, removal of the separate Save button, functional verification and production publication. No paid generation or compute.

Use the existing facet/listbox/count/reset flow. Explicit catalog tags and descriptive name suffixes supply voice age categories; unlabelled voices show Not specified. Preserve name-only search, privacy, sorting, previews, import, script voice selection and Create draft retention. One star toggles saved/starred together; existing saved-only records remain filled and removable, with no migration or silent preference mutation.

Base executable e294ed16 / Worker bdbd7395 at 100%, native279; preserve 55 bindings, 27 secrets, resources, three Workflow identities and qualified Desktop/Cloud pins. No instance restart or provider work.

Local verification: 302 focused UI tests pass, including explicit/unknown age, all filter combinations and reset, save-only records, star add/remove, preview/script flows, account isolation and Create draft retention. Installed Chrome passes Create navigation and voice filters at 1280/390px. Types, lint, changed-file formatting, both builds, bundle firewall, context and secret scans pass. Broad verify remains blocked by inherited 127 formatting issues and missing uv0.8.13; simultaneous local Chrome initially occupied port4173, the separate rerun passes Cloudflare fixture read/error/idempotency/preview-byte parity. Production publication and acceptance pending. Inherited broad CI formatting/uv, Local/full-film, provider funding, editorial and invoice gates remain separate.
