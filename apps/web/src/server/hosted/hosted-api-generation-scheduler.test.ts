import { describe, expect, it } from "vitest";

import { selectHostedApiGenerationJobIndex } from "./hosted-api-generation";

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
