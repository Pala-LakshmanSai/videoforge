export type SqlPrimitive = string | number | bigint | boolean | Date | Uint8Array | null;

export interface SqlQueryResult<Row extends Record<string, unknown>> {
  readonly rows: readonly Row[];
  readonly affectedRows: number;
}

/** Query-library-neutral minimum used by migrations and future repositories. */
export interface SqlExecutor {
  /**
   * Execute one trusted SQL batch without parameters. Migration adapters must support the exact
   * committed multi-statement PostgreSQL file as one transactional batch.
   */
  execute(sql: string): Promise<void>;
  query<Row extends Record<string, unknown>>(
    sql: string,
    parameters?: readonly SqlPrimitive[],
  ): Promise<SqlQueryResult<Row>>;
}

export interface TransactionalSqlExecutor extends SqlExecutor {
  transaction<Value>(work: (transaction: SqlExecutor) => Promise<Value>): Promise<Value>;
}
