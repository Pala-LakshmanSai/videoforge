import type {
  SqlExecutor,
  SqlPrimitive,
  SqlQueryResult,
  TransactionalSqlExecutor,
} from "../database/ports.js";

export interface PostgreSqlQueryResult<Row extends Record<string, unknown>> {
  readonly rows: readonly Row[];
  readonly rowCount: number | null;
}

export interface PostgreSqlConnection {
  query<Row extends Record<string, unknown>>(
    sql: string,
    parameters?: readonly unknown[],
  ): Promise<PostgreSqlQueryResult<Row>>;
  release?(): void;
}

export interface PostgreSqlPool extends PostgreSqlConnection {
  connect(): Promise<PostgreSqlConnection>;
}

function executor(connection: PostgreSqlConnection): SqlExecutor {
  return Object.freeze({
    async execute(sql: string): Promise<void> {
      await connection.query(sql);
    },
    async query<Row extends Record<string, unknown>>(
      sql: string,
      parameters: readonly SqlPrimitive[] = [],
    ): Promise<SqlQueryResult<Row>> {
      const result = await connection.query<Row>(sql, parameters);
      return Object.freeze({
        rows: Object.freeze([...result.rows]),
        affectedRows: result.rowCount ?? result.rows.length,
      });
    },
  });
}

/**
 * Production PostgreSQL adapter shared by Neon and native PostgreSQL tests. Every transaction owns
 * one connection, rolls back on typed/application failures, and never leaves a request-scoped
 * connection checked out.
 */
export function createPostgreSqlExecutor(pool: PostgreSqlPool): TransactionalSqlExecutor {
  const direct = executor(pool);
  return Object.freeze({
    ...direct,
    async transaction<Value>(work: (transaction: SqlExecutor) => Promise<Value>): Promise<Value> {
      const connection = await pool.connect();
      try {
        await connection.query("BEGIN");
        const value = await work(executor(connection));
        await connection.query("COMMIT");
        return value;
      } catch (error) {
        try {
          await connection.query("ROLLBACK");
        } catch (rollbackError) {
          throw new AggregateError(
            [error, rollbackError],
            "PostgreSQL transaction and rollback both failed.",
          );
        }
        throw error;
      } finally {
        connection.release?.();
      }
    },
  });
}
