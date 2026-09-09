import {
  ContractValidationError,
  hashPrevalidatedContractDocument,
  semanticContractIssues,
  type ContractDocument,
  type ContractName,
  type ContractValidationIssue,
  type ValidatedContractDocument,
} from "@videoforge/contracts";

type PrecompiledValidator = ((value: unknown) => boolean) & {
  readonly errors?: readonly {
    readonly instancePath?: string;
    readonly schemaPath?: string;
    readonly keyword?: string;
    readonly message?: string;
    readonly params?: Readonly<Record<string, unknown>>;
  }[] | null;
};

let validatorsPromise: Promise<Record<string, PrecompiledValidator>> | undefined;

function issues(validator: PrecompiledValidator): readonly ContractValidationIssue[] {
  return (validator.errors ?? []).map((error) => ({
    instancePath: error.instancePath ?? "",
    schemaPath: error.schemaPath ?? "#",
    keyword: error.keyword ?? "schema",
    message: error.message ?? "Schema validation failed.",
    params: error.params ?? {},
  }));
}

/** Cloudflare-safe validation boundary. The imported validators are generated ahead of time and
 * never invoke AJV's runtime Function constructor. */
export async function validateAndHashHostedContractDocument<Name extends ContractName>(
  contractName: Name,
  value: unknown,
): Promise<ValidatedContractDocument<Name>> {
  validatorsPromise ??= import(
    "@videoforge/contracts/hosted-generation-contract-validators"
  ).then((module) => module as unknown as Record<string, PrecompiledValidator>);
  const validator = (await validatorsPromise)[contractName];
  if (!validator) throw new Error(`Missing precompiled hosted validator: ${contractName}`);
  if (!validator(value)) throw new ContractValidationError(contractName, issues(validator));
  const document = value as ContractDocument<Name>;
  const semanticIssues = semanticContractIssues(contractName, document);
  if (semanticIssues.length > 0) throw new ContractValidationError(contractName, semanticIssues);
  return hashPrevalidatedContractDocument(contractName, document);
}
