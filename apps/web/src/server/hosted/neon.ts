import { Pool } from "@neondatabase/serverless";
import { createPostgreSqlExecutor } from "@videoforge/control-plane/postgres";

import type { HostedNeonPool } from "./configuration";

export function createNeonPool(databaseUrl: string): HostedNeonPool {
  return new Pool({ connectionString: databaseUrl, max: 1 });
}

export function createNeonExecutor(pool: HostedNeonPool) {
  return createPostgreSqlExecutor(pool);
}
