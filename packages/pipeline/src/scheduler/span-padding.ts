import { SUPPORTED_SCHEDULER_CONFIG } from "./config.js";

/**
 * The qualified SoulX avatar lane requires every padded span window to hold between 144000 and
 * 485760 samples at 48 kHz, which is 3000 ms to 10120 ms. The ordinary context padding is applied
 * symmetrically, so a short selection that sits against the start or the end of the source audio
 * loses the padding on the clamped side and can fall under that floor. Expanding the opposite side
 * keeps the selection itself untouched and never leaves the source audio.
 */
export const SPAN_PADDED_MIN_MS = 3000;
export const SPAN_PADDED_MAX_MS = 10120;

export function spanPaddedWindowMs(input: {
  readonly selectedStartMs: number;
  readonly selectedEndMsExclusive: number;
  readonly sourceDurationMs: number;
}): { readonly paddedStartMs: number; readonly paddedEndMsExclusive: number } {
  const padding = SUPPORTED_SCHEDULER_CONFIG.selected_span_context_padding_ms;
  let start = Math.max(0, input.selectedStartMs - padding);
  let end = Math.min(input.sourceDurationMs, input.selectedEndMsExclusive + padding);

  // Restore any padding the clamp removed on the opposite side, bounded by the source audio.
  const deficit = SPAN_PADDED_MIN_MS - (end - start);
  if (deficit > 0) {
    const tailRoom = input.sourceDurationMs - end;
    const takeTail = Math.min(deficit, tailRoom);
    end += takeTail;
    start = Math.max(0, start - (deficit - takeTail));
  }

  // A selection wider than the lane maximum cannot be rescued by trimming padding alone; keep the
  // window inside the ceiling and let the caller's contract checks reject a genuinely oversized one.
  if (end - start > SPAN_PADDED_MAX_MS) {
    end = Math.min(end, input.selectedEndMsExclusive);
    start = Math.max(start, end - SPAN_PADDED_MAX_MS);
  }

  return Object.freeze({ paddedStartMs: start, paddedEndMsExclusive: end });
}
