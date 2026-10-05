export interface CloudRental {
  readonly id: string;
  readonly machine: string;
  readonly hourly_usd: number | null;
  readonly started_at: string | null;
  readonly stopped_at: string | null;
  readonly status: "RUNNING" | "STOPPED" | "UNCONFIRMED" | "NOT_STARTED";
}

export interface CloudComputeSnapshot {
  readonly observed_at: string;
  readonly rentals: readonly CloudRental[];
}

export interface ProjectApiCost {
  readonly usd: number | null;
  readonly unconfirmed: boolean;
  readonly estimated: boolean;
  readonly breakdown: readonly {
    readonly label: string;
    readonly usd: number | null;
    readonly estimated: boolean;
    readonly unconfirmed?: boolean;
  }[];
}

export function cloudRentalAccrued(rental: CloudRental, now: number) {
  if (rental.status === "NOT_STARTED") return { milliseconds: 0, usd: 0 };
  const start = Date.parse(rental.started_at ?? "");
  const end = rental.stopped_at === null ? now : Date.parse(rental.stopped_at);
  const milliseconds =
    Number.isFinite(start) && Number.isFinite(end) ? Math.max(0, end - start) : null;
  const rate = rental.hourly_usd;
  return {
    milliseconds,
    usd:
      milliseconds !== null && rate !== null && Number.isFinite(rate) && rate > 0
        ? (milliseconds * rate) / 3_600_000
        : null,
  };
}

export function cloudComputeNeedsPolling(snapshot: CloudComputeSnapshot | null | undefined) {
  return (
    snapshot?.rentals.some(
      (rental) => rental.stopped_at === null && rental.status !== "NOT_STARTED",
    ) ?? false
  );
}
