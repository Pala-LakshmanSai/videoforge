import { describe, expect, it, vi } from "vitest";

import {
  settleHostedApiJobsBounded,
  selectHostedApiGenerationJobIndex,
  selectHostedApiGenerationJobIndices,
} from "./hosted-api-generation";

type SchedulingJob = {
  lane: "IMAGE" | "AVATAR";
  state: "PREPARED" | "SUBMITTING" | "SUBMITTED" | "UNKNOWN_NO_RETRY" | "SUCCEEDED" | "FAILED";
};

function plan(avatars: number, images: number): SchedulingJob[] {
  // Production projection lists avatar tasks before image tasks.
  return [
    ...Array.from({ length: avatars }, () => ({ lane: "AVATAR", state: "PREPARED" }) as const),
    ...Array.from({ length: images }, () => ({ lane: "IMAGE", state: "PREPARED" }) as const),
  ];
}

function submittedCounts(jobs: readonly SchedulingJob[]) {
  return {
    IMAGE: jobs.filter((job) => job.lane === "IMAGE" && job.state === "SUBMITTED").length,
    AVATAR: jobs.filter((job) => job.lane === "AVATAR" && job.state === "SUBMITTED").length,
  };
}

describe("hosted API generation scheduling", () => {
  it("bounds concurrent provider operations and preserves per-job results", async () => {
    let active = 0;
    let maximum = 0;
    const results = await settleHostedApiJobsBounded(
      Array.from({ length: 8 }, (_, index) => index),
      3,
      async (index) => {
        active += 1;
        maximum = Math.max(maximum, active);
        await new Promise((resolve) => setTimeout(resolve, 2));
        active -= 1;
        if (index === 3) throw new Error("provider read failed");
        return index * 2;
      },
    );
    expect(maximum).toBeLessThanOrEqual(3);
    expect(results.slice(0, 3).map((result) => result.status)).toEqual([
      "fulfilled",
      "fulfilled",
      "fulfilled",
    ]);
    expect(results[3]).toMatchObject({ status: "rejected" });
    expect(results[7]).toMatchObject({ status: "fulfilled", value: 14 });
  });

  it("paces serialized paid starts with a virtual clock", async () => {
    vi.useFakeTimers();
    try {
      const starts: number[] = [];
      const pending = settleHostedApiJobsBounded(
        [0, 1, 2],
        1,
        async (index) => {
          starts.push(Date.now());
          return index;
        },
        1_050,
      );
      await vi.runAllTimersAsync();
      const results = await pending;
      expect(results.map((result) => result.status)).toEqual([
        "fulfilled",
        "fulfilled",
        "fulfilled",
      ]);
      expect(starts[1]! - starts[0]!).toBe(1_050);
      expect(starts[2]! - starts[1]!).toBe(1_050);
      expect(Date.now() - starts[2]!).toBe(1_050);
    } finally {
      vi.useRealTimers();
    }
  });

  it("fills all currently open provider slots in one concurrent dispatch pass", () => {
    const jobs = plan(64, 212);
    const selected = selectHostedApiGenerationJobIndices(jobs, 0);
    expect(selected).toHaveLength(12);
    expect(selected.slice(0, 2).map((index) => jobs[index]!.lane)).toEqual(["IMAGE", "AVATAR"]);
    expect(selected.filter((index) => jobs[index]!.lane === "IMAGE")).toHaveLength(8);
    expect(selected.filter((index) => jobs[index]!.lane === "AVATAR")).toHaveLength(4);
  });

  it("does not dispatch a batch across an uncertain or failed job", () => {
    const uncertain = plan(1, 2);
    uncertain[0]!.state = "UNKNOWN_NO_RETRY";
    expect(selectHostedApiGenerationJobIndices(uncertain, 0)).toEqual([]);

    const failed = plan(1, 2);
    failed[0]!.state = "FAILED";
    expect(selectHostedApiGenerationJobIndices(failed, 0)).toEqual([]);
  });

  it("submits both lanes promptly for one avatar and two images", () => {
    const jobs = plan(1, 2);
    const submitted: SchedulingJob["lane"][] = [];
    for (let observation = 0; observation < jobs.length; observation += 1) {
      const index = selectHostedApiGenerationJobIndex(jobs, observation);
      expect(index).not.toBeNull();
      const job = jobs[index!]!;
      expect(job.state).toBe("PREPARED");
      submitted.push(job.lane);
      job.state = "SUBMITTED";
    }
    expect(submitted.slice(0, 2)).toContain("IMAGE");
    expect(submitted.slice(0, 2)).toContain("AVATAR");
    expect(submittedCounts(jobs)).toEqual({ IMAGE: 2, AVATAR: 1 });
  });

  it("fills bounded image and avatar lanes on a 212-image, 64-avatar plan", () => {
    const jobs = plan(64, 212);
    const first: SchedulingJob["lane"][] = [];
    for (let observation = 0; observation < 12; observation += 1) {
      const index = selectHostedApiGenerationJobIndex(jobs, observation);
      expect(index).not.toBeNull();
      const job = jobs[index!]!;
      expect(job.state).toBe("PREPARED");
      first.push(job.lane);
      job.state = "SUBMITTED";
      const counts = submittedCounts(jobs);
      expect(counts.IMAGE).toBeLessThanOrEqual(8);
      expect(counts.AVATAR).toBeLessThanOrEqual(4);
      expect(counts.IMAGE + counts.AVATAR).toBeLessThanOrEqual(12);
    }
    expect(first.slice(0, 2)).toContain("IMAGE");
    expect(first.slice(0, 2)).toContain("AVATAR");
    expect(submittedCounts(jobs)).toEqual({ IMAGE: 8, AVATAR: 4 });
    expect(jobs[selectHostedApiGenerationJobIndex(jobs, 12)!]?.state).toBe("SUBMITTED");

    // A completed provider task opens one slot without submitting an existing task again.
    jobs.find((job) => job.lane === "IMAGE" && job.state === "SUBMITTED")!.state = "SUCCEEDED";
    const next = selectHostedApiGenerationJobIndex(jobs, 13);
    expect(next).not.toBeNull();
    expect(jobs[next!]!).toMatchObject({ lane: "IMAGE", state: "PREPARED" });
  });

  it("never selects work after an uncertain claim or submits past a failed job", () => {
    const uncertain = plan(1, 2);
    uncertain[0]!.state = "UNKNOWN_NO_RETRY";
    expect(selectHostedApiGenerationJobIndex(uncertain, 0)).toBeNull();
    uncertain[0]!.state = "SUBMITTING";
    expect(selectHostedApiGenerationJobIndex(uncertain, 1)).toBeNull();

    const failed = plan(1, 2);
    failed[0]!.state = "FAILED";
    expect(selectHostedApiGenerationJobIndex(failed, 0)).toBeNull();
    failed[1]!.state = "SUBMITTED";
    expect(selectHostedApiGenerationJobIndex(failed, 1)).toBe(1);
  });
});
