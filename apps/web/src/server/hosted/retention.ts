import { hostedRuntimeConfiguration, type HostedRuntimeEnvironment } from "./configuration";
import { sha256 } from "./crypto";
import { createNeonPool } from "./neon";

interface DueRetentionRow extends Record<string, unknown> {
  readonly attempt_id: string;
  readonly object_prefix: string;
}

export async function runHostedRetention(environment: HostedRuntimeEnvironment): Promise<number> {
  const config = hostedRuntimeConfiguration(environment);
  const bucket = environment.PRIVATE_ARTIFACTS;
  if (!bucket) throw new Error("Hosted retention requires the private R2 binding.");
  const pool = createNeonPool(config.neon.databaseUrl);
  let completed = 0;
  try {
    const due = await pool.query<DueRetentionRow>(
      `SELECT * FROM videoforge_due_hosted_cpu_retention($1)`,
      [25],
    );
    for (const row of due.rows) {
      const deleted: string[] = [];
      let cursor: string | undefined;
      do {
        const page = await bucket.list({ prefix: row.object_prefix, cursor, limit: 1_000 });
        const keys = page.objects.map((object) => object.key).sort();
        if (keys.length > 0) {
          await bucket.delete(keys);
          deleted.push(...keys);
        }
        cursor = page.truncated ? page.cursor : undefined;
        if (page.truncated && !cursor) throw new Error("R2 retention pagination lost its cursor.");
      } while (cursor);
      const facts = await sha256(
        JSON.stringify({
          attempt_id: row.attempt_id,
          deleted_keys: deleted.sort(),
          object_prefix: row.object_prefix,
          schema_version: "videoforge-retention-deletion/v1",
        }),
      );
      const result = await pool.query(
        `SELECT videoforge_finish_hosted_cpu_retention($1, $2) AS accepted`,
        [row.attempt_id, facts],
      );
      if (result.rows[0]?.accepted === true) completed += 1;
    }
    return completed;
  } finally {
    await pool.end();
  }
}
