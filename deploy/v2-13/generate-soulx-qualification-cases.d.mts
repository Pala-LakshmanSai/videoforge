export declare function generateSoulXQualificationCase(input: {
  attemptId: string;
  seconds: 2 | 4 | 6 | 10;
  sourceAssetId: string;
  sourceSha256: string;
  sourceReservationId: string;
  audioAssetId: string;
  audioSha256: string;
  audioReservationId: string;
  outputReservationId: string;
}): Readonly<Record<string, unknown>>;
export declare function validateSoulXQualificationCase(value: unknown, seconds: number): boolean;
export declare const SOULX_WHOLE_SPAN_QUALIFICATION_SECONDS: readonly [2, 4, 6, 10];
export declare function generateSoulXWholeSpanQualificationCase(input: {
  attemptId: string;
  sourceAssetId: string;
  sourceSha256: string;
  sourceReservationId: string;
  spans: readonly {
    seconds: 2 | 4 | 6 | 10;
    audioAssetId: string;
    audioSha256: string;
    audioReservationId: string;
    outputReservationId: string;
  }[];
}): Readonly<Record<string, unknown>>;
export declare function validateSoulXWholeSpanQualificationCase(value: unknown): boolean;
