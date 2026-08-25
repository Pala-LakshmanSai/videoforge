import type { api as FixtureApi } from "./api";

export class ApiError extends Error {
  constructor(
    message: string,
    readonly code: string,
    readonly status: number,
    readonly retryable: boolean,
    readonly action?: string,
    readonly issues?: unknown,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

function hostedOnly(): never {
  throw new Error("Fixture API is unavailable in the hosted production client.");
}

/**
 * Production aliases fixture API imports to this fail-closed surface. Hosted screens use their
 * tenant-private endpoints directly; reaching this object means a route boundary regressed.
 */
export const api = new Proxy(Object.create(null) as typeof FixtureApi, {
  get: () => hostedOnly,
});
