import type { FixtureProblem } from "@videoforge/test-fixtures";

export interface ApiErrorBody {
  error: {
    code: string;
    message: string;
    detail: string;
    retryable: boolean;
    action?: string;
    issues?: unknown;
  };
  type: string;
  title: string;
  status: number;
}

export function apiProblem(
  code: string,
  status: number,
  title: string,
  detail: string,
  retryable: boolean,
  options: { action?: string; issues?: unknown } = {},
): FixtureProblem {
  return {
    type: `https://videoforge.local/problems/${code.toLowerCase().replaceAll("_", "-")}`,
    title,
    status,
    code,
    detail,
    retryable,
    ...(options.action === undefined ? {} : { action: options.action }),
  };
}

export function apiErrorBody(problem: FixtureProblem, issues?: unknown): ApiErrorBody {
  return {
    error: {
      code: problem.code,
      message: problem.title,
      detail: problem.detail,
      retryable: problem.retryable,
      ...(problem.action === undefined ? {} : { action: problem.action }),
      ...(issues === undefined ? {} : { issues }),
    },
    type: problem.type,
    title: problem.title,
    status: problem.status,
  };
}

export function problemResponse(problem: FixtureProblem, issues?: unknown): Response {
  return Response.json(apiErrorBody(problem, issues), {
    status: problem.status,
    headers: {
      "cache-control": "no-store",
      "content-type": "application/problem+json; charset=UTF-8",
    },
  });
}
