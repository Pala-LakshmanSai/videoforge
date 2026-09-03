// @vitest-environment node

import { readFile } from "node:fs/promises";

import { PGlite } from "@electric-sql/pglite";
import { describe, expect, it } from "vitest";

const accountId = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const workspaceId = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const projectId = "11111111-1111-4111-8111-111111111111";
const oldRevisionId = "22222222-2222-4222-8222-222222222222";
const latestRevisionId = "33333333-3333-4333-8333-333333333333";
const oldTimelineId = "44444444-4444-4444-8444-444444444444";
const latestTimelineId = "55555555-5555-4555-8555-555555555555";

async function generationQuery(): Promise<string> {
  const source = await readFile(new URL("./product.ts", import.meta.url), "utf8");
  const match = source.match(
    /const generation = await transaction\.query\(\s*`([\s\S]*?)`,\s*\[scope\.account_id, scope\.workspace_id, projectId, currentRevisionId\],\s*\)/u,
  );
  if (!match?.[1]) throw new Error("projectDetail generation query was not found");
  return match[1];
}

describe("hosted project detail generation query", () => {
  it("runs on PostgreSQL and follows the selected revision's current timing head", async () => {
    const database = new PGlite();
    try {
      await database.exec(`
        CREATE TABLE project_revisions (
          account_id uuid NOT NULL,
          workspace_id uuid NOT NULL,
          id uuid PRIMARY KEY,
          project_id uuid NOT NULL,
          revision_number integer NOT NULL
        );
        CREATE TABLE revision_timing_heads (
          account_id uuid NOT NULL,
          workspace_id uuid NOT NULL,
          project_revision_id uuid NOT NULL,
          current_timeline_plan_id uuid NOT NULL
        );
        CREATE TABLE timeline_plans (
          account_id uuid NOT NULL,
          workspace_id uuid NOT NULL,
          project_revision_id uuid NOT NULL,
          id uuid PRIMARY KEY,
          canonical_document_hash text NOT NULL,
          plan_sequence integer NOT NULL
        );
        CREATE TABLE timeline_segments (
          account_id uuid NOT NULL,
          workspace_id uuid NOT NULL,
          project_revision_id uuid NOT NULL,
          timeline_plan_id uuid NOT NULL,
          timeline_composition text NOT NULL
        );
        CREATE TABLE generation_tasks (
          id uuid PRIMARY KEY,
          workspace_id uuid NOT NULL,
          project_revision_id uuid NOT NULL,
          task_key text NOT NULL,
          lane text NOT NULL,
          state text NOT NULL,
          created_at timestamptz NOT NULL
        );
        INSERT INTO project_revisions
          (account_id, workspace_id, id, project_id, revision_number)
        VALUES
          ('${accountId}', '${workspaceId}', '${oldRevisionId}', '${projectId}', 1),
          ('${accountId}', '${workspaceId}', '${latestRevisionId}', '${projectId}', 2);
        INSERT INTO revision_timing_heads
          (account_id, workspace_id, project_revision_id, current_timeline_plan_id)
        VALUES
          ('${accountId}', '${workspaceId}', '${oldRevisionId}', '${oldTimelineId}'),
          ('${accountId}', '${workspaceId}', '${latestRevisionId}', '${latestTimelineId}');
        INSERT INTO timeline_plans
          (account_id, workspace_id, project_revision_id, id, canonical_document_hash, plan_sequence)
        VALUES
          ('${accountId}', '${workspaceId}', '${oldRevisionId}', '${oldTimelineId}', 'sha256:${"a".repeat(64)}', 1),
          ('${accountId}', '${workspaceId}', '${latestRevisionId}', '${latestTimelineId}', 'sha256:${"b".repeat(64)}', 1);
        INSERT INTO timeline_segments
          (account_id, workspace_id, project_revision_id, timeline_plan_id, timeline_composition)
        VALUES
          ('${accountId}', '${workspaceId}', '${oldRevisionId}', '${oldTimelineId}', 'IMAGE_FULL'),
          ('${accountId}', '${workspaceId}', '${latestRevisionId}', '${latestTimelineId}', 'IMAGE_FULL'),
          ('${accountId}', '${workspaceId}', '${latestRevisionId}', '${latestTimelineId}', 'AVATAR_SPLIT_IMAGE'),
          ('${accountId}', '${workspaceId}', '${latestRevisionId}', '${latestTimelineId}', 'AVATAR_FULL');
        INSERT INTO generation_tasks
          (id, workspace_id, project_revision_id, task_key, lane, state, created_at)
        VALUES
          ('66666666-6666-4666-8666-666666666661', '${workspaceId}', '${latestRevisionId}', 'image:1', 'IMAGE', 'COMPLETE', now()),
          ('66666666-6666-4666-8666-666666666662', '${workspaceId}', '${latestRevisionId}', 'avatar:1', 'AVATAR', 'FAILED', now()),
          ('66666666-6666-4666-8666-666666666663', '${workspaceId}', '${latestRevisionId}', 'prompt:scene-batch:1', 'PROMPT', 'COMPLETE', now());
      `);

      const result = await database.query<{
        id: string;
        timeline_plan_sha256: string;
        total_segments: number | string;
        image_scene_count: number | string;
        avatar_segment_count: number | string;
        planned_tasks: number | string;
        completed_tasks: number | string;
        failed_tasks: number | string;
      }>(await generationQuery(), [accountId, workspaceId, projectId, latestRevisionId]);

      expect(result.rows).toHaveLength(1);
      expect(result.rows[0]).toMatchObject({
        id: latestTimelineId,
        timeline_plan_sha256: `sha256:${"b".repeat(64)}`,
      });
      expect(Number(result.rows[0]?.total_segments)).toBe(3);
      expect(Number(result.rows[0]?.image_scene_count)).toBe(2);
      expect(Number(result.rows[0]?.avatar_segment_count)).toBe(2);
      expect(Number(result.rows[0]?.planned_tasks)).toBe(2);
      expect(Number(result.rows[0]?.completed_tasks)).toBe(1);
      expect(Number(result.rows[0]?.failed_tasks)).toBe(1);
    } finally {
      await database.close();
    }
  });
});
