export type SqlPrimitive = string | number | bigint | boolean | Date | Uint8Array | null;

export interface SqlQueryResult<Row extends Record<string, unknown>> {
  readonly rows: readonly Row[];
  readonly affectedRows: number;
}

/** Query-library-neutral minimum used by migrations and future repositories. */
export interface SqlExecutor {
  execute(sql: string): Promise<void>;
  query<Row extends Record<string, unknown>>(
    sql: string,
    parameters?: readonly SqlPrimitive[],
  ): Promise<SqlQueryResult<Row>>;
}

export interface TransactionalSqlExecutor extends SqlExecutor {
  transaction<Value>(work: (transaction: SqlExecutor) => Promise<Value>): Promise<Value>;
}
