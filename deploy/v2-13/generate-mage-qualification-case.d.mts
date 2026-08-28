export declare const MAGE_QUALIFICATION_MODEL_REVISION: string;
export declare const MAGE_QUALIFICATION_ITEM_COUNT: 32;
export declare function generateMageQualificationCase(input: {
  attemptId: string;
  outputUrls: readonly string[];
  sha256Utf8(value: string): string;
}): Readonly<Record<string, unknown>>;
export declare function validateMageQualificationCase(
  value: unknown,
  sha256Utf8?: (value: string) => string,
): boolean;
