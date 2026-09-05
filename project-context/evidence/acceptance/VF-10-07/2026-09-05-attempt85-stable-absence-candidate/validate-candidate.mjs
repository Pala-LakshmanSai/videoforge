import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "../../../../..");
const proposalPath = resolve(import.meta.dirname, "combined-live-proposal.json");
const proposalBytes = await readFile(proposalPath);
const proposal = JSON.parse(proposalBytes);
const hash = `sha256:${createHash("sha256").update(proposalBytes).digest("hex")}`;
if (hash !== "sha256:e983f2b5ed1fd1d78d2c07f3e0154ad9e824f993a71aa12b321150f958d3b540") throw new Error("proposal");
if (proposal.control_source_commit !== "2fccf2ed7257613f4a12017562243a8aeb889138") throw new Error("control");
if (proposal.repair.initial_absence_required_consecutive_exact_reads !== 3 || proposal.repair.initial_absence_max_attempts !== 6 || proposal.repair.retry_only_unconfirmed_transport_or_provider_failure !== true || proposal.repair.preexisting_worker_stops_immediately !== true) throw new Error("absence contract");
if (proposal.placement_and_cost.maximum_cumulative_finite_spend_usd !== 4.5 || proposal.placement_and_cost.remaining_allowance_usd !== 1.992690361890709) throw new Error("cap");
const activation = await readFile(resolve(root, "apps/web/src/server/providers/v207-activation-authority.ts"), "utf8");
if (!activation.includes(hash) || !activation.includes('V207_APPROVED_AUTHORITY_SHA256: string | null = null') || !activation.includes('V207_APPROVED_FINITE_CAP_USD: number | null = null') || !activation.includes('V207_APPROVED_EXECUTION_ENTRYPOINT = "disposable-live-orchestrator-v1"')) throw new Error("activation");
console.log("PASS Attempt85 stable-absence candidate sealed; executable authority absent");
