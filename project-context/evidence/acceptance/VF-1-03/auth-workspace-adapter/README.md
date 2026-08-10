# VF-1-03 auth and workspace authorization adapter

Status: technically verified; VF-1-03 complete

Commits `688c3f631eaaead460ba397646fff64eaad54a2b`,
`4bf79eca9322fadf43dc73cc972edba8cbc9c680`, and
`5dd17d000bf2a8d0ded937555aa5407d06d72504` implement the provider-free auth boundary. It includes
deterministic local sessions, verified-Google-email invitation admission, exact active identity,
workspace and membership checks, post-await session revalidation, and server-session-derived
reviewer identity.

Google admission returns only the two exact durable compare-and-set transitions and requires an
active identity before any materializer can run. The Better Auth integration is truthfully labeled
`better-auth-sdk-wiring-pending-staging`; no live OAuth dependency, handler, account mutation, or
credential was introduced.

Reviewer mutations accept only a bounded recursively frozen plain-data snapshot. The unchecked
input never crosses the boundary. Object and array snapshots have null prototypes, so hidden Proxy
state, late input mutation, inherited reviewer fields, inherited `toJSON`, accessors, cycles,
sparse arrays, and oversized payloads cannot smuggle reviewer identity or execute getters. The
independent adversarial audit closed with no remaining high or medium finding.

The final focused auth suite passed 25/25 and the complete control-plane package passed 104/104.
The uncached repository verification also passed 145 web tests, local Workerd 1/1, and installed
Chrome 34/34 with zero skips. No network provider, credential, cloud mutation, remote, or external
spend was used.

Live Better Auth/Google adapter installation and the durable invitation-membership materialization
transaction remain staging work and require the separately recorded external authorization.
