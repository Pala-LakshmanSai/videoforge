# V2-09 / VF-10-09: prompt flow continuity

Status: local and isolated live qualification passed; production publication pending.

## Authority and scope

User requested a careful multi-agent audit, repair, verification and production release under USD3 total new spend. The user withdrew recovery of the two unwanted videos. No original video is resumed; saved prompts, paid identities and receipts remain intact. The user explicitly prioritizes stage continuity over exact image fidelity and forbids added image inspection or other model calls.

## Cause

The original failures were successful Runware GPT-6 Luna responses rejected by local character/semantic checks. They were not HTTP429/concurrency failures; two concurrent requests through the same key succeeded. An early probe additionally exposed blanket screen rejection for physical dashboard cleaning. The final live probe also demonstrated that an array count constraint does not prevent duplicate scene IDs: eight returned rows included one duplicate and omitted another scene.

## Shared repair

Fresh `runware-luna-grounded-v6` / requestv43 / profile13 accepts usable structured responses without semantic, grounding, wording, screen-detection or character-length rejection. Visual constraints remain creation guidance. Stored output is normalized locally; raw responses remain durable and unchanged. Code-assigned batch/shot-role values override model echoes. First known unique scene rows are retained; missing prompts use their own narration/context, never another scene's duplicate or unknown-ID content. Complete structured JSON may be accepted with finish_reason length; malformed JSON and provider refusals remain distinguishable failures.

Compiler-v7 and the Kie adapter shorten deterministically to the real800-character provider envelope. There is no paid semantic correction, image inspection or extra compression model. Historical policies and accepted output bytes remain pinned.

Native295–297 add immutable profiles with unchanged model/rates and preserve capability permissions. Native298 extends the existing stranded-workload settlement during future admission: only failed prompt work with settled cost, exact succeeded receipts and no outstanding compute/media/cleanup may release its account slot. Unknown or active work stays fenced. The old videos are not restarted by this cleanup.

## Verification

- All225 original accepted scenes and source hashes preserved;32 historical v41 requests reproduce byte-for-byte.
- All71 earlier v41/v42 saved responses accepted under v43 in one provider-free replay each.
- Offline401-scene traversal:361 first provider outputs plus40 explicit fixtures, Kie419–797 characters.
- Full web suite3356 passed,1existing skipped; web types/lint/Cloudflare build and native Workerd transport passed. Final source-reconciliation focused100 tests passed; final pipeline341 tests, types/build/lint passed. Native focused26 tests passed with1existing PostgreSQL-only skip; seven-case reclaim regression passed.
- Native real rollback295–298 preserves all row fingerprints, historical journal, ACL and RLS. Exact incident rollback settlement releases2 leases and marks2 requestsFAILED while preserving225 prompts and all receipts/costs/tasks/media; full rollback restores everything.
- Final live v43 qualification401/401 scenes accepted across41 batches and41 provider receipts. Zero corrective calls. One omitted scene uses its own narration fallback; the original duplicate content is never reassigned. The23 saved receipts were reused locally and only18 never-submitted requests continued. Cumulative verification costUSD0.165680; zero unresolved provider liabilities.

## Remaining gates

Clean commit/push; guarded native/Worker publication; existing coordinator idle adoption after an unrelated active voiceover reaches terminal/archive completion; asset/private-access/Chrome verification. No new GPU, image, avatar or video generation is authorized by this prompt-only test. General provider outages, billing failures and malformed responses remain external failure cases; no universal error-free guarantee is claimed.
