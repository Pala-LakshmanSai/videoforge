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
