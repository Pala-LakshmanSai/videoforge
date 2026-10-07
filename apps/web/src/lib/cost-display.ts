// Keep accounting values untouched; only round when presenting USD components.
export function displayedUsd(value: number): number {
  return Math.round(value * 1_000_000) / 1_000_000;
}

export function formatCostUsd(value: number): string {
  return `$${displayedUsd(value).toFixed(6)}`;
}

export function apiCostValue(cost: { usd: number | null; unconfirmed: boolean }): string {
  return cost.usd === null
    ? "Unconfirmed"
    : `${cost.unconfirmed ? "Partial · " : ""}${formatCostUsd(cost.usd)}`;
}
