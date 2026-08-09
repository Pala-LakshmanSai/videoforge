import Ajv2020 from "ajv/dist/2020.js";
import type { AnySchemaObject, ErrorObject, ValidateFunction } from "ajv";

import type { CreateProjectRequest } from "./create-project.js";
import {
  canonicalSchemaDocuments,
  contractNames,
  contractSchemaIds,
  type ContractName,
} from "./schemas.js";

export interface ContractValidationIssue {
  instancePath: string;
  schemaPath: string;
  keyword: string;
  message: string;
  params: Readonly<Record<string, unknown>>;
}

export interface ContractValidationSuccess<T> {
  success: true;
  data: T;
}

export interface ContractValidationFailure {
  success: false;
  issues: readonly ContractValidationIssue[];
}

export type ContractValidationResult<T> = ContractValidationSuccess<T> | ContractValidationFailure;

export class ContractValidationError extends Error {
  readonly contractName: ContractName;
  readonly issues: readonly ContractValidationIssue[];

  constructor(contractName: ContractName, issues: readonly ContractValidationIssue[]) {
    super(
      `Invalid ${contractName} contract (${issues.length} issue${issues.length === 1 ? "" : "s"}).`,
    );
    this.name = "ContractValidationError";
    this.contractName = contractName;
    this.issues = issues;
  }
}

export function createContractAjv(): Ajv2020 {
  const ajv = new Ajv2020({ allErrors: true, strict: true });
  for (const contractName of contractNames) {
    ajv.addSchema(canonicalSchemaDocuments[contractName] as unknown as AnySchemaObject);
  }
  return ajv;
}

const ajv = createContractAjv();

export const contractValidators = Object.freeze(
  Object.fromEntries(
    contractNames.map((contractName) => {
      const validator = ajv.getSchema(contractSchemaIds[contractName]);
      if (!validator) throw new Error(`Ajv did not register ${contractSchemaIds[contractName]}.`);
      return [contractName, validator];
    }),
  ) as Record<ContractName, ValidateFunction>,
);

const normalizeIssues = (
  errors: ErrorObject[] | null | undefined,
): readonly ContractValidationIssue[] =>
  (errors ?? []).map((error) => ({
    instancePath: error.instancePath,
    schemaPath: error.schemaPath,
    keyword: error.keyword,
    message: error.message ?? "Schema validation failed.",
    params: error.params as Readonly<Record<string, unknown>>,
  }));

export function validateContract(
  contractName: "createProjectRequest",
  value: unknown,
): ContractValidationResult<CreateProjectRequest>;
export function validateContract<T = unknown>(
  contractName: ContractName,
  value: unknown,
): ContractValidationResult<T>;
export function validateContract<T = unknown>(
  contractName: ContractName,
  value: unknown,
): ContractValidationResult<T> {
  const validator = contractValidators[contractName];
  if (validator(value)) return { success: true, data: value as T };
  return { success: false, issues: normalizeIssues(validator.errors) };
}

export function assertContract<T = unknown>(contractName: ContractName, value: unknown): T {
  const result = validateContract<T>(contractName, value);
  if (!result.success) throw new ContractValidationError(contractName, result.issues);
  return result.data;
}
