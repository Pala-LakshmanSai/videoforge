/**
 * Vitest-only stand-in for the workerd `cloudflare:workers` module.
 *
 * `vitest.config.ts` aliases `cloudflare:workers` here so Workflow entrypoints can be constructed in
 * a plain Node process with a fake step recorder. Production never loads this file: workerd
 * provides the real module, and nothing in the deploy graph imports this path.
 */
export class WorkflowEntrypoint<Environment = unknown, Parameters = unknown> {
  protected readonly ctx: unknown;
  protected readonly env: Environment;

  constructor(ctx: unknown, environment: Environment) {
    this.ctx = ctx;
    this.env = environment;
  }

  async run(_event: unknown, _step: unknown): Promise<unknown> {
    throw new Error("WorkflowEntrypoint test stub: the entrypoint must implement run().");
  }
}
