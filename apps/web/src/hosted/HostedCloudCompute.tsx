import { useEffect, useMemo, useState } from "react";
import { Metric } from "../components/ui";
import { displayedUsd, formatCostUsd as dollars } from "../lib/cost-display";
import {
  cloudComputeNeedsPolling,
  cloudRentalAccrued,
  type CloudComputeSnapshot,
  type ProjectApiCost,
} from "../lib/cloud-compute";

function duration(milliseconds: number) {
  const seconds = Math.floor(milliseconds / 1000);
  return `${Math.floor(seconds / 3600) ? `${Math.floor(seconds / 3600)}h ` : ""}${Math.floor(seconds / 60) % 60}m ${String(seconds % 60).padStart(2, "0")}s`;
}

export function HostedCloudCompute({
  snapshot,
  apiCost,
  showCompute = true,
  forecast,
}: {
  snapshot: CloudComputeSnapshot;
  apiCost?: ProjectApiCost | null;
  showCompute?: boolean;
  forecast?: { usd: number; detail: string };
}) {
  const clock = useMemo(
    () => ({ at: Date.parse(snapshot.observed_at), received: performance.now() }),
    [snapshot.observed_at],
  );
  const [, setTick] = useState(0);
  const running = cloudComputeNeedsPolling(snapshot);
  useEffect(() => {
    if (!running) return;
    const timer = window.setInterval(() => setTick((value) => value + 1), 1000);
    return () => window.clearInterval(timer);
  }, [running]);
  const now = clock.at + Math.max(0, performance.now() - clock.received);
  const rentals = snapshot.rentals.map((rental) => ({
    rental,
    ...cloudRentalAccrued(rental, now),
  }));
  const milliseconds = rentals.reduce((sum, rental) => sum + (rental.milliseconds ?? 0), 0);
  const usd = rentals.reduce((sum, rental) => sum + (rental.usd ?? 0), 0);
  const totalUsd = displayedUsd(apiCost?.usd ?? 0) + displayedUsd(usd);
  const partialTime = rentals.some((rental) => rental.milliseconds === null);
  const partialCost = rentals.some((rental) => rental.usd === null);
  const knownTime = rentals.some((rental) => rental.milliseconds !== null);
  const knownCost = rentals.some((rental) => rental.usd !== null);
  const active = snapshot.rentals.filter((rental) => rental.status === "RUNNING").length;
  const label = snapshot.rentals.some((rental) => rental.machine.includes("vCPU"))
    ? "Cloud"
    : "GPU";
  const partialTotal = partialCost || !apiCost || apiCost.usd === null || apiCost.unconfirmed;
  return (
    <section className="cloud-compute" aria-label="Cloud compute charges">
      {showCompute && (
        <div className="cloud-compute-metrics">
          <Metric
            label={`${label} uptime`}
            value={
              partialTime && !knownTime
                ? "Unconfirmed"
                : `${partialTime ? "At least " : ""}${duration(milliseconds)}`
            }
            detail={
              active
                ? `${active} machine${active === 1 ? "" : "s"} running · updates every second`
                : running
                  ? "Waiting for rental confirmation"
                  : snapshot.rentals.some((rental) => rental.status !== "NOT_STARTED")
                    ? "All rental clocks stopped"
                    : "No machine rented yet"
            }
            tone="info"
          />
          <Metric
            label={`${label} cost so far`}
            value={
              partialCost && !knownCost
                ? "Unconfirmed"
                : `${partialCost ? "Partial · " : ""}${dollars(usd)}`
            }
            detail="Recorded hourly rate × confirmed rental time · estimate"
            tone="success"
          />
        </div>
      )}
      {apiCost && (
        <div className="cloud-compute-total">
          <Metric
            label="Total cost so far"
            value={
              apiCost.usd === null && !knownCost
                ? "Unconfirmed"
                : `${partialTotal ? "Partial · " : ""}${dollars(totalUsd)}`
            }
            detail={`${apiCost.usd === null ? "API cost unconfirmed" : `${dollars(apiCost.usd)} APIs`} + ${partialCost && !knownCost ? "Cloud cost unconfirmed" : `${dollars(usd)} Cloud compute`} · ${partialTotal ? "partial estimate" : apiCost.estimated || rentals.length > 0 ? "estimate" : "provider-reported API charges"}`}
            tone="success"
          />
        </div>
      )}
      {(rentals.length > 0 || apiCost) && (
        <details className="cloud-compute-breakdown">
          <summary>
            Cost breakdown
            {rentals.length
              ? ` · ${rentals.length} machine rental${rentals.length === 1 ? "" : "s"}`
              : ""}
          </summary>
          {apiCost && (
            <ul>
              {apiCost.breakdown.map((item) => (
                <li key={item.label}>
                  <strong>{item.label}</strong>
                  <span>
                    {item.usd === null ? "Cost unconfirmed" : dollars(item.usd)}
                    {item.unconfirmed ? " · incomplete" : item.estimated ? " · estimate" : ""}
                  </span>
                  {item.usage?.map((usage, index) => (
                    <span key={index}>
                      {usage.provider} · {usage.model} · {usage.submittedRequests} submitted ·{" "}
                      {usage.completedRequests} completed
                      {usage.failedRequests > 0 ? ` · ${usage.failedRequests} failed` : ""}
                      {usage.uncertainRequests > 0
                        ? ` · ${usage.uncertainRequests} unconfirmed`
                        : ""}
                      {usage.requestedSeconds === null
                        ? ""
                        : ` · ${usage.requestedSeconds.toFixed(3)}s requested`}
                      {usage.costBasis === "PROVIDER_REPORTED"
                        ? " · provider-reported charge"
                        : usage.pinnedRateUsd === null
                          ? " · rate unconfirmed"
                          : ` · ${dollars(usage.pinnedRateUsd)}/${usage.rateUnit} · estimated rate${usage.model.includes("flashhead") ? "; requested audio duration is a pricing proxy, not confirmed billable usage" : ""}`}
                    </span>
                  ))}
                </li>
              ))}
            </ul>
          )}
          <ul>
            {rentals.map(({ rental, milliseconds: elapsed, usd: cost }) => (
              <li key={rental.id}>
                <strong>{rental.machine}</strong>
                <span>
                  {rental.status === "NOT_STARTED"
                    ? "Not started"
                    : rental.status === "STOPPED"
                      ? "Stopped"
                      : rental.status === "RUNNING"
                        ? "Running"
                        : "Unconfirmed"}{" "}
                  ·{" "}
                  {rental.hourly_usd === null
                    ? "Rate unconfirmed"
                    : `${dollars(rental.hourly_usd)}/hr`}{" "}
                  · {elapsed === null ? "Uptime unconfirmed" : `${(elapsed / 1000).toFixed(3)}s`} ·{" "}
                  {cost === null ? "Cost unconfirmed" : dollars(cost)}
                </span>
                <span>
                  Placement confirmed: {rental.started_at ?? "Unconfirmed"} · Shutdown confirmed:{" "}
                  {rental.stopped_at ??
                    (rental.status === "RUNNING" ? "Still running" : "Unconfirmed")}
                </span>
              </li>
            ))}
          </ul>
          {forecast && (
            <p>
              API forecast · {dollars(forecast.usd)} · {forecast.detail}. This is planned work, not
              the API amount used in the total.
            </p>
          )}
          <p className="muted">
            This project’s API work and rentals, including earlier attempts.{" "}
            {showCompute &&
              "Rental time runs from confirmed placement to confirmed shutdown; earlier provisioning time and provider billing timestamps are unavailable. Parallel rentals are counted separately. The recorded rate includes temporary disk. "}
            Totals add the displayed API and compute components, rounded to six decimal places.
            Estimated charges; the provider invoice may differ.
          </p>
        </details>
      )}
    </section>
  );
}
