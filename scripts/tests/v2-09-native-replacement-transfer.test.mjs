import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { readStoppedNativeReplacementTransfer as read } from "../../deploy/v2-09/execute-native-qualified-replacement.mjs";
import { hashNativeBrowser as hash } from "../../deploy/v2-09/native-browser-continuation.mjs";
const raw = (b) => "sha256:" + createHash("sha256").update(b).digest("hex");
function fixture(t) {
  const root = mkdtempSync(join(tmpdir(), "v209-transfer-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const plan = {
    output_root: root + "-new",
    prior_root: "/private/prior",
    prior_authority_sha256: "prior",
    prior_state_sha256: "original-raw",
    authority: { authority_id: "new", caps: { max_incremental_usd: 2 } },
    predecessor: { versionId: "v" },
  };
  const old = { ...plan, output_root: root, authority: { ...plan.authority, authority_id: "old" } };
  const archive = { status: "AWAITING_INTERACTIVE_CHROME_LOGIN", operations: ["original22"] };
  const put = (name, value) => {
    const bytes = JSON.stringify(value);
    writeFileSync(join(root, name), bytes, { mode: 0o600 });
    return raw(bytes);
  };
  const recovery = {
    root,
    plan_sha256: put("replacement-plan.json", old),
    archive_sha256: put("predecessor-state.json", archive),
  };
  const transfer = {
    schema_version: "videoforge.v2-09-predecessor-transferred/v1",
    prior_state_sha256: hash(archive),
    successor_plan_sha256: recovery.plan_sha256,
    normal_resume_disabled: true,
  };
  recovery.stop_sha256 = put("replacement-stop.json", {
    status: "STOPPED_NO_RETRY",
    containment: "NOT_DEPLOYED",
    error_code: "BOUNDED_OPERATION_FAILED",
    generate_clicks: 0,
  });
  recovery.journal_sha256 = put("cloudflare-replacement-journal.json", {
    schema_version: "videoforge.v2-09-qualified-replacement-journal/v1",
    authority_sha256: hash(old.authority),
    predecessor_sha256: hash(old.predecessor),
    state: "CLAIMED",
    events: [],
    inherited_secret_count: 22,
    introduced_secret_names: [],
    retained_r2_deleted: false,
  });
  recovery.claim_sha256 = put("replacement-claim.json", {
    plan_sha256: recovery.plan_sha256,
    single_use: true,
  });
  recovery.transfer_sha256 = put("transfer-receipt.json", transfer);
  recovery.operation_sha256 = put("operation-1.json", {
    id: "claim-qualified-replacement",
    status: "COMPLETED",
    result: transfer,
    result_sha256: hash(transfer),
  });
  plan.transfer_recovery = recovery;
  return { plan, root, put, archive, live: Buffer.from(JSON.stringify(transfer)) };
}
test("stopped read-only claim transfers archived original proof without restoring old state", (t) => {
  const f = fixture(t);
  assert.deepEqual(read(f.plan, f.live), f.archive);
  assert.equal(JSON.parse(f.live).normal_resume_disabled, true);
});
test("any mutation journal or later operation forbids successor recovery", (t) => {
  for (const name of [
    "migration-journal.jsonl",
    "activation-journal.jsonl",
    "operation-2.json",
    "replacement-receipt.json",
  ]) {
    const f = fixture(t);
    f.put(name, {});
    assert.throws(() => read(f.plan, f.live), /TRANSFER_RECOVERY_MUTATION/);
  }
});
test("even resealed ambiguous CF intent and changed live tombstone fail closed", (t) => {
  const f = fixture(t);
  const j = JSON.parse(readFileSync(join(f.root, "cloudflare-replacement-journal.json")));
  j.events.push({ kind: "DEPLOY_INTENT" });
  f.plan.transfer_recovery.journal_sha256 = f.put("cloudflare-replacement-journal.json", j);
  assert.throws(() => read(f.plan, f.live), /TRANSFER_RECOVERY_EVIDENCE/);
  const g = fixture(t);
  const live = JSON.parse(g.live);
  live.normal_resume_disabled = false;
  assert.throws(
    () => read(g.plan, Buffer.from(JSON.stringify(live))),
    /TRANSFER_RECOVERY_EVIDENCE/,
  );
});
