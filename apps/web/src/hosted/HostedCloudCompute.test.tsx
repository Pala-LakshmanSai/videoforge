import { act, cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { CloudComputeSnapshot, CloudRental } from "../lib/cloud-compute";
import { HostedCloudCompute } from "./HostedCloudCompute";
import { hostedProjectPollInterval } from "./HostedProductScreens";

const start = "2026-10-05T09:00:00.000Z";
const rental: CloudRental = {
  id: "rental",
  machine: "RTX 4090",
  hourly_usd: 0.8,
  started_at: start,
  stopped_at: null,
  status: "RUNNING",
};
const snapshot = (
  rentals: CloudRental[],
  observed_at = "2026-10-05T09:15:00.000Z",
): CloudComputeSnapshot => ({ observed_at, rentals });
const metric = (label: string) => within(screen.getByText(label).parentElement!);

beforeEach(() => {
  vi.spyOn(performance, "now").mockReturnValue(0);
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("live Cloud compute display", () => {
  it("advances using elapsed monotonic time, ignores the computer's wall clock, and freezes on shutdown", () => {
    vi.useFakeTimers();
    let elapsed = 0;
    vi.spyOn(performance, "now").mockImplementation(() => elapsed);
    vi.spyOn(Date, "now").mockReturnValue(0);
    const view = render(<HostedCloudCompute snapshot={snapshot([rental])} />);
    expect(metric("GPU uptime").getByText("15m 00s")).toBeInTheDocument();
    expect(metric("GPU cost so far").getByText("$0.200000")).toBeInTheDocument();
    elapsed = 60_000;
    act(() => vi.advanceTimersByTime(60_000));
    expect(metric("GPU uptime").getByText("16m 00s")).toBeInTheDocument();
    expect(metric("GPU cost so far").getByText("$0.213333")).toBeInTheDocument();

    view.rerender(
      <HostedCloudCompute
        snapshot={snapshot(
          [{ ...rental, status: "STOPPED", stopped_at: "2026-10-05T09:15:30.000Z" }],
          "2026-10-05T09:17:00.000Z",
        )}
      />,
    );
    elapsed += 3_600_000;
    act(() => vi.advanceTimersByTime(3_600_000));
    expect(metric("GPU uptime").getByText("15m 30s")).toBeInTheDocument();
    expect(metric("GPU cost so far").getByText("$0.206667")).toBeInTheDocument();
    expect(vi.getTimerCount()).toBe(0);
  });

  it("sums simultaneous rentals and exposes each recorded machine and rate", () => {
    render(
      <HostedCloudCompute
        snapshot={snapshot([
          rental,
          { ...rental, id: "second", machine: "16 vCPU / 64 GB RAM", hourly_usd: 0.4 },
        ])}
      />,
    );
    expect(metric("Cloud uptime").getByText("30m 00s")).toBeInTheDocument();
    expect(metric("Cloud cost so far").getByText("$0.300000")).toBeInTheDocument();
    expect(screen.getByText("2 machines running · updates every second")).toBeInTheDocument();
    expect(screen.getByText("Cost breakdown · 2 machine rentals")).toBeInTheDocument();
    expect(screen.getByText(/Running · \$0.800000\/hr/)).toBeInTheDocument();
    expect(screen.getByText(/Running · \$0.400000\/hr/)).toBeInTheDocument();
  });

  it("identifies incomplete costs and distinguishes unknown rentals from machines never rented", () => {
    const unknown = {
      ...rental,
      id: "unknown",
      started_at: null,
      hourly_usd: null,
      status: "UNCONFIRMED" as const,
    };
    const view = render(<HostedCloudCompute snapshot={snapshot([rental, unknown])} />);
    expect(metric("GPU uptime").getByText("At least 15m 00s")).toBeInTheDocument();
    expect(metric("GPU cost so far").getByText("Partial · $0.200000")).toBeInTheDocument();
    view.rerender(<HostedCloudCompute snapshot={snapshot([unknown])} />);
    expect(metric("GPU uptime").getByText("Unconfirmed")).toBeInTheDocument();
    expect(metric("GPU cost so far").getByText("Unconfirmed")).toBeInTheDocument();
    view.rerender(<HostedCloudCompute snapshot={snapshot([])} />);
    expect(metric("GPU uptime").getByText("0m 00s")).toBeInTheDocument();
    expect(metric("GPU cost so far").getByText("$0.000000")).toBeInTheDocument();
    expect(screen.getByText("No machine rented yet")).toBeInTheDocument();
    expect(screen.queryByText(/Cost breakdown/)).not.toBeInTheDocument();
  });

  it("combines recorded API work with accrued RunPod cost and preserves incomplete-charge labels", () => {
    const apiCost = {
      usd: 1.16,
      unconfirmed: false,
      estimated: true,
      breakdown: [
        { label: "Images", usd: 0.36, estimated: false },
        { label: "Avatar", usd: 0.8, estimated: true },
      ],
    };
    const view = render(
      <HostedCloudCompute snapshot={snapshot([{ ...rental, hourly_usd: 2 }])} apiCost={apiCost} />,
    );
    expect(metric("Total cost so far").getByText("$1.660000")).toBeInTheDocument();
    expect(
      metric("Total cost so far").getByText("$1.160000 APIs + $0.500000 Cloud compute · estimate"),
    ).toBeInTheDocument();
    expect(screen.getByText("Images")).toBeInTheDocument();
    expect(screen.getByText("Avatar")).toBeInTheDocument();
    view.rerender(
      <HostedCloudCompute
        snapshot={snapshot([{ ...rental, hourly_usd: null }])}
        apiCost={apiCost}
      />,
    );
    expect(metric("Total cost so far").getByText("Partial · $1.160000")).toBeInTheDocument();
    view.rerender(
      <HostedCloudCompute
        snapshot={snapshot([rental])}
        apiCost={{ ...apiCost, unconfirmed: true }}
      />,
    );
    expect(metric("Total cost so far").getByText("Partial · $1.360000")).toBeInTheDocument();
    view.rerender(
      <HostedCloudCompute
        snapshot={snapshot([rental])}
        apiCost={{ ...apiCost, usd: null, unconfirmed: false }}
      />,
    );
    expect(metric("Total cost so far").getByText("Partial · $0.200000")).toBeInTheDocument();
    view.rerender(
      <HostedCloudCompute
        snapshot={snapshot([{ ...rental, started_at: null, status: "UNCONFIRMED" }])}
        apiCost={{ ...apiCost, usd: null, unconfirmed: true }}
      />,
    );
    expect(metric("Total cost so far").getByText("Unconfirmed")).toBeInTheDocument();
  });

  it("shows API totals for Local projects without suggesting a GPU was rented", () => {
    render(
      <HostedCloudCompute
        snapshot={snapshot([])}
        showCompute={false}
        apiCost={{ usd: 0.8, unconfirmed: false, estimated: false, breakdown: [] }}
      />,
    );
    expect(metric("Total cost so far").getByText("$0.800000")).toBeInTheDocument();
    expect(screen.queryByText("GPU uptime")).not.toBeInTheDocument();
    expect(screen.queryByText("GPU cost so far")).not.toBeInTheDocument();
    expect(screen.getByText(/provider-reported API charges/)).toBeInTheDocument();
  });

  it("keeps terminal projects polling until the rental's powered-off state is confirmed", () => {
    type Detail = NonNullable<Parameters<typeof hostedProjectPollInterval>[0]>;
    for (const status of ["FAILED", "SUCCEEDED"]) {
      const detail = {
        attempts: [],
        stages: [{ status }],
        cost: { cloud_compute: snapshot([rental]) },
      } as unknown as Detail;
      expect(hostedProjectPollInterval(detail)).toBe(2_000);
      expect(
        hostedProjectPollInterval({
          ...detail,
          cost: {
            cloud_compute: snapshot([{ ...rental, started_at: null, status: "UNCONFIRMED" }]),
          },
        }),
      ).toBe(2_000);
      expect(
        hostedProjectPollInterval({
          ...detail,
          cost: {
            cloud_compute: snapshot([
              { ...rental, stopped_at: "2026-10-05T09:15:00Z", status: "STOPPED" },
            ]),
          },
        }),
      ).toBe(false);
      expect(
        hostedProjectPollInterval({
          ...detail,
          cost: {
            cloud_compute: snapshot([{ ...rental, started_at: null, status: "NOT_STARTED" }]),
          },
        }),
      ).toBe(false);
    }
  });
});

it("shows recorded request counts and precise proxy usage, with an additive rounded total", () => {
  render(
    <HostedCloudCompute
      snapshot={snapshot([
        { ...rental, hourly_usd: 0.0000056, status: "STOPPED", stopped_at: "2026-10-05T09:15:00Z" },
      ])}
      apiCost={{
        usd: 0.0645394,
        estimated: true,
        unconfirmed: false,
        breakdown: [
          {
            label: "Avatar footage",
            usd: 0.0353,
            estimated: true,
            usage: [
              {
                provider: "FAL",
                model: "fal-ai/flashhead/audio-to-video",
                submittedRequests: 3,
                completedRequests: 2,
                failedRequests: 1,
                uncertainRequests: 0,
                requestedSeconds: 7.06,
                pinnedRateUsd: 0.005,
                rateUnit: "second",
                costBasis: "PINNED_RATE_ESTIMATE",
              },
            ],
          },
        ],
      }}
    />,
  );
  expect(
    screen.getByText(/3 submitted · 2 completed · 1 failed · 7.060s requested/),
  ).toBeInTheDocument();
  expect(screen.getByText(/not confirmed billable usage/)).toBeInTheDocument();
  expect(screen.getByText(/900.000s/)).toBeInTheDocument();
  // Raw sum rounds to .064541; component rounding must not display a contradictory equation.
  expect(metric("Total cost so far").getByText("$0.064540")).toBeInTheDocument();
  expect(
    metric("Total cost so far").getByText("$0.064539 APIs + $0.000001 Cloud compute · estimate"),
  ).toBeInTheDocument();
});
