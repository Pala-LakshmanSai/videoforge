// @vitest-environment node

import { readFile } from "node:fs/promises";

import { PGlite } from "@electric-sql/pglite";
import { describe, expect, it } from "vitest";

const accountId = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const workspaceId = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const idleProjectId = "11111111-1111-4111-8111-111111111111";
const runningProjectId = "22222222-2222-4222-8222-222222222222";

async function queueQuery(): Promise<string> {
  const source = await readFile(new URL("./app.ts", import.meta.url), "utf8");
  const match = source.match(
    /const projects = await transaction\.query<HostedQueueRow>\(\s*`([\s\S]*?)`,\s*\[accountId, workspaceId\],\s*\)/u,
  );
  if (!match?.[1]) throw new Error("hosted queue query was not found");
  return match[1];
}

describe("hosted queue capability query", () => {
  it("runs on PostgreSQL and reports owner cancellation and deletion capability", async () => {
    const database = new PGlite();
    try {
      await database.exec(`
        CREATE TABLE projects (
          account_id uuid NOT NULL,
          workspace_id uuid NOT NULL,
          id uuid PRIMARY KEY,
          name text NOT NULL,
          status text NOT NULL,
          project_kind text NOT NULL,
          created_at timestamptz NOT NULL
        );
        CREATE TABLE project_revisions (
          account_id uuid NOT NULL,
          workspace_id uuid NOT NULL,
          id uuid PRIMARY KEY,
          project_id uuid NOT NULL
        );
        CREATE TABLE hosted_cpu_job_attempts (
          account_id uuid NOT NULL,
          workspace_id uuid NOT NULL,
          id uuid PRIMARY KEY,
          project_id uuid NOT NULL,
          kind text NOT NULL,
          state text NOT NULL,
          retention_deleted_at timestamptz,
          created_at timestamptz NOT NULL,
          updated_at timestamptz NOT NULL
        );
        CREATE TABLE hosted_voiceover_contexts (
          account_id uuid NOT NULL,
          workspace_id uuid NOT NULL,
          id uuid PRIMARY KEY,
          project_id uuid NOT NULL,
          state text NOT NULL,
          started_at timestamptz,
          finished_at timestamptz,
          created_at timestamptz NOT NULL
        );
        CREATE TABLE hosted_prompt_runs (
          account_id uuid NOT NULL,
          workspace_id uuid NOT NULL,
          id uuid PRIMARY KEY,
          project_id uuid NOT NULL,
          state text NOT NULL
        );
        CREATE TABLE generation_tasks (
          account_id uuid NOT NULL,
          workspace_id uuid NOT NULL,
          id uuid PRIMARY KEY,
          project_revision_id uuid NOT NULL,
          task_key text NOT NULL,
          state text NOT NULL,
          created_at timestamptz NOT NULL
        );
        CREATE TABLE generation_requests (
          account_id uuid NOT NULL,
          workspace_id uuid NOT NULL,
          id uuid PRIMARY KEY,
          project_id uuid NOT NULL,
          state text NOT NULL
        );
        CREATE TABLE serverless_attempts (
          account_id uuid NOT NULL,
          workspace_id uuid NOT NULL,
          id uuid PRIMARY KEY,
          project_id uuid NOT NULL,
          state text NOT NULL
        );
      `);
      await database.exec(`
        INSERT INTO projects VALUES
          ('${accountId}','${workspaceId}','${idleProjectId}','Idle draft','ACTIVE','USER',
            '2026-08-17T10:00:00Z'),
          ('${accountId}','${workspaceId}','${runningProjectId}','Running render','ACTIVE','USER',
            '2026-08-17T09:00:00Z');
        INSERT INTO generation_requests VALUES
          ('${accountId}','${workspaceId}','33333333-3333-4333-8333-333333333333',
            '${idleProjectId}','WAITING'),
          ('${accountId}','${workspaceId}','44444444-4444-4444-8444-444444444444',
            '${runningProjectId}','ACTIVE');
        INSERT INTO hosted_cpu_job_attempts VALUES
          ('${accountId}','${workspaceId}','55555555-5555-4555-8555-555555555555',
            '${runningProjectId}','RENDER','RUNNING',NULL,
            '2026-08-17T09:30:00Z','2026-08-17T09:31:00Z');
      `);

      const result = await database.query<Record<string, unknown>>(await queueQuery(), [
        accountId,
        workspaceId,
      ]);
      const rows = new Map(result.rows.map((row) => [String(row.project_id), row]));

      const idle = rows.get(idleProjectId);
      expect(idle?.state).toBe("WAITING");
      expect(Number(idle?.active_request_count)).toBe(1);
      expect(Number(idle?.active_cpu_count)).toBe(0);
      expect(Number(idle?.total_serverless_count)).toBe(0);
      expect(Number(idle?.dispatching_side_effect_count)).toBe(0);

      const running = rows.get(runningProjectId);
      expect(running?.state).toBe("IN_PROGRESS");
      expect(running?.active_kind).toBe("RENDER");
      expect(running?.cancellable_attempt_id).toBe("55555555-5555-4555-8555-555555555555");
      expect(Number(running?.active_cpu_count)).toBe(1);
    } finally {
      await database.close();
    }
  });
});
