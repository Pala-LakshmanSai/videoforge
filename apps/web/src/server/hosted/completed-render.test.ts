// @vitest-environment node
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { describe, expect, it } from "vitest";
import {
  LIBRARY_VIDEO_DETAILS_SQL,
  LIBRARY_VIDEO_DETAILS_JOINS_SQL,
} from "./library-video-details";
import { HOSTED_COMPLETED_RENDER_SQL } from "./completed-render";

const account = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const workspace = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const project = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const revision = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";
const attempt = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee";
const hash = `sha256:${"a".repeat(64)}`;
function productionQuery(file: string, functionName: string, select: string): string {
  const source = readFileSync(resolve(process.cwd(), `src/server/hosted/${file}`), "utf8");
  const start = source.indexOf(select, source.indexOf(`async function ${functionName}(`));
  return source
    .slice(start, source.indexOf("`", start))
    .replaceAll("${HOSTED_COMPLETED_RENDER_SQL}", () => HOSTED_COMPLETED_RENDER_SQL)
    .replaceAll("${LIBRARY_VIDEO_DETAILS_SQL}", () => LIBRARY_VIDEO_DETAILS_SQL)
    .replaceAll("${LIBRARY_VIDEO_DETAILS_JOINS_SQL}", () => LIBRARY_VIDEO_DETAILS_JOINS_SQL);
}
const librarySql = productionQuery(
  "app.ts",
  "handleHostedLibrary",
  "SELECT attempt.id AS attempt_id",
);
const downloadSql = productionQuery(
  "product.ts",
  "downloadApprovedRender",
  "SELECT authority.object_key",
);

const manifestSql = productionQuery(
  "product.ts",
  "projectManifest",
  "SELECT project.id, project.name AS title",
);

async function database() {
  const db = new PGlite();
  await db.exec(`
    CREATE TABLE projects(id uuid, account_id uuid, workspace_id uuid, name text, project_kind text, status text);
    CREATE TABLE project_revisions(id uuid, account_id uuid, workspace_id uuid, project_id uuid, revision_number integer, status text, voiceover_asset_id uuid);
    CREATE TABLE assets(id uuid, account_id uuid, workspace_id uuid, project_id uuid, kind text, metadata jsonb);
    CREATE TABLE hosted_cpu_job_attempts(id uuid, account_id uuid, workspace_id uuid, project_id uuid, project_revision_id uuid, kind text, state text, created_at timestamptz, retention_deleted_at timestamptz, result_object_key text, result_content_length bigint, result_checksum_sha256 text);
    CREATE TABLE hosted_cpu_upload_authorities(attempt_id uuid, account_id uuid, workspace_id uuid, source text, issued_at timestamptz, object_key text, content_type text, issued_content_length bigint, issued_checksum_sha256 text);
    CREATE TABLE hosted_render_only_runs(id uuid, account_id uuid, workspace_id uuid, state text, output_receipt_id uuid, final_output jsonb);
    INSERT INTO projects VALUES('${project}','${account}','${workspace}','Finished video','USER','ACTIVE');
    INSERT INTO project_revisions VALUES('${revision}','${account}','${workspace}','${project}',1,'LOCKED',null);
    INSERT INTO hosted_cpu_job_attempts VALUES('${attempt}','${account}','${workspace}','${project}','${revision}','RENDER','SUCCEEDED','2026-10-05',null,'final',42,'${hash}');
    INSERT INTO hosted_cpu_upload_authorities VALUES('${attempt}','${account}','${workspace}','PRIMARY_RESULT_OUTPUT',now(),'final','video/mp4',42,'${hash}');
  `);
  await db.exec(`
    ALTER TABLE project_revisions ADD COLUMN revision_config_payload jsonb, ADD COLUMN avatar_profile_id uuid,
      ADD COLUMN avatar_profile_version_id uuid, ADD COLUMN image_style_id uuid, ADD COLUMN image_style_version_id uuid;
    ALTER TABLE assets ADD COLUMN binary_sha256 text;
    CREATE TABLE avatar_profile_versions(id uuid, account_id uuid, workspace_id uuid, profile_id uuid, version_number integer);
    CREATE TABLE avatar_profiles(id uuid, account_id uuid, workspace_id uuid, name text);
    CREATE TABLE image_style_versions(id uuid, account_id uuid, workspace_id uuid, style_id uuid, version_number integer);
    CREATE TABLE image_styles(id uuid, account_id uuid, workspace_id uuid, name text);
    CREATE TABLE hosted_script_projects(project_id uuid, account_id uuid, workspace_id uuid, voice_name text, audio jsonb);
  `);
  return db;
}

describe("completed output publication without human approval", () => {
  it("reads the completed revision's pinned settings, historical names and exact narration checksum", async () => {
    const db = await database();
    try {
      await db.exec(`
        INSERT INTO avatar_profiles VALUES('${attempt}','${account}','${workspace}','Renamed avatar');
        INSERT INTO avatar_profile_versions VALUES('${attempt}','${account}','${workspace}','${attempt}',2);
        INSERT INTO image_styles VALUES('${attempt}','${account}','${workspace}','Documentary');
        INSERT INTO image_style_versions VALUES('${attempt}','${account}','${workspace}','${attempt}',3);
        INSERT INTO assets VALUES('${attempt}','${account}','${workspace}','${project}','VOICEOVER','{"filename":"original.mp3"}','${hash}');
        INSERT INTO hosted_script_projects VALUES('${project}','${account}','${workspace}','Original narrator','{"metadata":{"checksum_sha256":"${hash}"}}');
        UPDATE project_revisions SET avatar_profile_id='${attempt}',avatar_profile_version_id='${attempt}',image_style_id='${attempt}',image_style_version_id='${attempt}',voiceover_asset_id='${attempt}',revision_config_payload='{"avatar_binding":{"avatar_display_name_snapshot":"Original avatar"}}';
        INSERT INTO project_revisions(id,account_id,workspace_id,project_id,revision_number,status,revision_config_payload) VALUES('ffffffff-ffff-4fff-8fff-ffffffffffff','${account}','${workspace}','${project}',2,'DRAFT','{"avatar_enabled":false}');
      `);
      const details = async () =>
        (
          await db.query<{ video_details: Record<string, unknown> }>(librarySql, [
            account,
            workspace,
          ])
        ).rows[0]!.video_details;
      expect(await details()).toEqual({
        avatar_enabled: true,
        avatar_name: "Original avatar",
        avatar_version: 2,
        voiceover_name: "Original narrator",
        voiceover_filename: "original.mp3",
        image_style_name: "Documentary",
        image_style_version: 3,
      });
      await db.exec(
        `UPDATE hosted_script_projects SET audio='{"metadata":{"checksum_sha256":"other"}}'; UPDATE image_style_versions SET account_id='${workspace}'; UPDATE project_revisions SET revision_config_payload='{"avatar_enabled":false}' WHERE id='${revision}';`,
      );
      expect(await details()).toMatchObject({
        avatar_enabled: false,
        voiceover_name: null,
        voiceover_filename: "original.mp3",
        image_style_name: null,
        image_style_version: null,
      });
    } finally {
      await db.close();
    }
  });
  it("runs the real Library and download SQL without any reviews table and fails closed on incomplete output", async () => {
    const db = await database();
    try {
      const library = () => db.query(librarySql, [account, workspace]);
      const download = () => db.query(downloadSql, [account, workspace, project, null]);
      expect((await library()).rows).toHaveLength(1);
      expect((await download()).rows).toHaveLength(1);
      expect((await db.query(librarySql, [workspace, account])).rows).toHaveLength(0);
      for (const change of [
        "state='RUNNING'",
        "retention_deleted_at=now()",
        "result_checksum_sha256='sha256:'||repeat('b',64)",
        "result_content_length=41",
        "result_object_key='other'",
      ]) {
        await db.exec(`UPDATE hosted_cpu_job_attempts SET ${change}`);
        expect((await library()).rows).toHaveLength(0);
        expect((await download()).rows).toHaveLength(0);
        await db.exec(
          `UPDATE hosted_cpu_job_attempts SET state='SUCCEEDED',retention_deleted_at=null,result_checksum_sha256='${hash}',result_content_length=42,result_object_key='final'`,
        );
      }
      await db.exec(
        `INSERT INTO hosted_render_only_runs VALUES('${attempt}','${account}','${workspace}','PREPARING',null,null)`,
      );
      expect((await library()).rows).toHaveLength(0);
      await db.exec(
        `UPDATE hosted_render_only_runs SET state='SUCCEEDED',output_receipt_id='${attempt}',final_output=jsonb_build_object('checksumSha256','${hash}')`,
      );
      expect((await library()).rows).toHaveLength(1);
      expect((await download()).rows).toHaveLength(1);
    } finally {
      await db.close();
    }
  });

  it("keeps retained Library history but never downloads an older render after a newer attempt fails", async () => {
    const db = await database();
    try {
      await db.exec(
        `INSERT INTO hosted_cpu_job_attempts VALUES('ffffffff-ffff-4fff-8fff-ffffffffffff','${account}','${workspace}','${project}','${revision}','RENDER','FAILED','2026-10-06',null,null,null,null)`,
      );
      expect((await db.query(librarySql, [account, workspace])).rows).toHaveLength(1);
      expect((await db.query(downloadSql, [account, workspace, project, null])).rows).toHaveLength(
        0,
      );
      expect(
        (await db.query(downloadSql, [account, workspace, project, attempt])).rows,
      ).toHaveLength(1);
      await db.exec(
        `INSERT INTO hosted_cpu_upload_authorities VALUES('${attempt}','${account}','${workspace}','RESULT_DOCUMENT',now(),'document','application/json',100,'sha256:'||repeat('c',64)); UPDATE hosted_cpu_job_attempts SET result_object_key='document',result_content_length=100,result_checksum_sha256='sha256:'||repeat('c',64) WHERE id='${attempt}'`,
      );
      expect((await db.query(librarySql, [account, workspace])).rows).toHaveLength(1);
    } finally {
      await db.close();
    }
  });
  it("runs current-revision provenance SQL with no approval records and never falls back to an earlier render", async () => {
    const db = await database();
    try {
      await db.exec(`
        ALTER TABLE project_revisions ADD COLUMN revision_config_hash text,
          ADD COLUMN avatar_profile_hash text,
          ADD COLUMN style_profile_hash text,
          ADD COLUMN voiceover_binary_sha256 text;
        ALTER TABLE hosted_cpu_job_attempts ADD COLUMN request_sha256 text, ADD COLUMN replay_count integer,
          ADD COLUMN submitted_at timestamptz, ADD COLUMN terminal_at timestamptz;
        CREATE TABLE hosted_project_reviews(account_id uuid, workspace_id uuid, project_id uuid, render_attempt_id uuid, approved_by_user_id uuid, approved_at timestamptz);
      `);
      const rows = () =>
        db.query<{
          object_key: string | null;
          render_attempt_id: string | null;
          revision_state: string;
        }>(manifestSql, [account, workspace, project]);
      expect((await rows()).rows[0]).toMatchObject({
        object_key: "final",
        render_attempt_id: attempt,
        revision_state: "LOCKED",
      });
      await db.exec(
        `INSERT INTO hosted_cpu_job_attempts(id,account_id,workspace_id,project_id,project_revision_id,kind,state,created_at) VALUES('ffffffff-ffff-4fff-8fff-ffffffffffff','${account}','${workspace}','${project}','${revision}','RENDER','FAILED','2026-10-06')`,
      );
      expect((await rows()).rows[0]?.object_key).toBeNull();
      await db.exec(
        `INSERT INTO project_revisions(id,account_id,workspace_id,project_id,revision_number,status) VALUES('11111111-1111-4111-8111-111111111111','${account}','${workspace}','${project}',2,'DRAFT')`,
      );
      expect((await rows()).rows[0]).toMatchObject({
        object_key: null,
        render_attempt_id: null,
        revision_state: "DRAFT",
      });
    } finally {
      await db.close();
    }
  });
});
