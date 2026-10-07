// @vitest-environment node
import { PGlite } from "@electric-sql/pglite";
import { expect, it } from "vitest";
import type { SqlExecutor } from "@videoforge/control-plane";
import { readProjectVoiceover } from "./project-voiceover";

it("admits only the owner's current verified narration and exact retained receipt", async () => {
  const db = new PGlite();
  const transaction: SqlExecutor = {
    async execute(sql) {
      await db.exec(sql);
    },
    async query(sql, parameters) {
      const result = await db.query(sql, parameters ? [...parameters] : []);
      return {
        rows: result.rows,
        affectedRows: result.affectedRows ?? result.rows.length,
      } as Awaited<ReturnType<SqlExecutor["query"]>>;
    },
  } as SqlExecutor;
  const scope = { account_id: "owner", workspace_id: "workspace", user_id: "user" };
  const checksum = `sha256:${"a".repeat(64)}`;
  try {
    await db.exec(`
      CREATE TABLE projects(id text,account_id text,workspace_id text,status text,project_kind text);
      CREATE TABLE project_revisions(id text,account_id text,workspace_id text,project_id text,status text,revision_number int,voiceover_asset_id text,voiceover_binary_sha256 text);
      CREATE TABLE assets(id text,account_id text,workspace_id text,project_id text,kind text,state text,binary_sha256 text,object_key text,byte_size bigint,content_type text,metadata jsonb);
      CREATE TABLE artifact_reservations(id text,account_id text,workspace_id text,project_id text,asset_id text,state text,object_key text,project_revision_id text);
      CREATE TABLE artifact_receipts(id text,account_id text,workspace_id text,reservation_id text,deleted_at timestamptz,object_key text,checksum_sha256 text,content_length bigint,content_type text,committed_at timestamptz);
      CREATE TABLE cloud_media_asr_recoveries(account_id text,workspace_id text,project_id text,project_revision_id text,source_receipt_id text);
      INSERT INTO projects VALUES('project','owner','workspace','ACTIVE','USER');
      INSERT INTO project_revisions VALUES('revision','owner','workspace','project','LOCKED',1,'asset','${checksum}');
      INSERT INTO assets VALUES('asset','owner','workspace','project','VOICEOVER','VERIFIED','${checksum}','tenant/source',24,'audio/mpeg','{"filename":"episode.mp3"}');
      INSERT INTO artifact_reservations VALUES('reservation','owner','workspace','project','asset','COMMITTED','tenant/source','revision');
      INSERT INTO artifact_receipts VALUES('receipt','owner','workspace','reservation',NULL,'tenant/source','${checksum}',24,'audio/mpeg',now());
    `);
    const read = () => readProjectVoiceover(transaction, scope, "project");
    expect(await read()).toMatchObject({
      revision_id: "revision",
      object_key: "tenant/source",
      content_type: "audio/mpeg",
      voiceover_filename: "episode.mp3",
    });
    expect(
      await readProjectVoiceover(transaction, { ...scope, account_id: "foreign" }, "project"),
    ).toBeUndefined();
    expect(
      await readProjectVoiceover(transaction, { ...scope, workspace_id: "foreign" }, "project"),
    ).toBeUndefined();
    for (const [sql, restore] of [
      ["UPDATE assets SET state='UPLOADING'", "UPDATE assets SET state='VERIFIED'"],
      ["UPDATE assets SET kind='FINAL_VIDEO'", "UPDATE assets SET kind='VOICEOVER'"],
      [
        "UPDATE artifact_reservations SET state='ISSUED'",
        "UPDATE artifact_reservations SET state='COMMITTED'",
      ],
      [
        "UPDATE artifact_receipts SET deleted_at=now()",
        "UPDATE artifact_receipts SET deleted_at=NULL",
      ],
      [
        "UPDATE artifact_receipts SET object_key='foreign/source'",
        "UPDATE artifact_receipts SET object_key='tenant/source'",
      ],
      [
        "UPDATE artifact_receipts SET content_length=25",
        "UPDATE artifact_receipts SET content_length=24",
      ],
      [
        "UPDATE artifact_receipts SET content_type='audio/wav'",
        "UPDATE artifact_receipts SET content_type='audio/mpeg'",
      ],
      [
        "UPDATE artifact_receipts SET checksum_sha256='sha256:wrong'",
        `UPDATE artifact_receipts SET checksum_sha256='${checksum}'`,
      ],
      [
        "UPDATE project_revisions SET voiceover_binary_sha256='sha256:wrong'",
        `UPDATE project_revisions SET voiceover_binary_sha256='${checksum}'`,
      ],
    ]) {
      await db.exec(sql!);
      expect(await read(), sql).toBeUndefined();
      await db.exec(restore!);
    }
    await db.exec(
      "UPDATE assets SET content_type='audio/wav',metadata='{\"filename\":\"episode.wav\"}'; UPDATE artifact_receipts SET content_type='audio/wav';",
    );
    expect(await read()).toMatchObject({
      content_type: "audio/wav",
      voiceover_filename: "episode.wav",
    });
    await db.exec(
      `INSERT INTO project_revisions VALUES('successor','owner','workspace','project','LOCKED',2,'asset','${checksum}');`,
    );
    // A missing successor source must never silently expose an older revision's narration.
    expect(await read()).toBeUndefined();
    await db.exec(
      "INSERT INTO cloud_media_asr_recoveries VALUES('foreign','workspace','project','successor','receipt');",
    );
    expect(await read()).toBeUndefined();
    await db.exec(
      "INSERT INTO cloud_media_asr_recoveries VALUES('owner','workspace','project','successor','receipt');",
    );
    expect(await read()).toMatchObject({ revision_id: "successor", content_type: "audio/wav" });
    await db.exec("UPDATE projects SET status='ARCHIVED';");
    expect(await read()).toBeUndefined();
  } finally {
    await db.close();
  }
});
