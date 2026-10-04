import { expect, it } from "vitest";
import { matchesVoiceName } from "./voice-library";

it("matches name prefixes, never letters in the middle of a name", () => {
  expect(matchesVoiceName({ name: "Bob - Calm" }, "b")).toBe(true);
  expect(matchesVoiceName({ name: "Abby" }, "b")).toBe(false);
  expect(matchesVoiceName({ name: "Alice - British" }, "b")).toBe(false);
  expect(matchesVoiceName({ name: "Brian" }, "bri")).toBe(true);
});
it("normalizes spaces, case and accents without changing the displayed name", () => {
  expect(matchesVoiceName({ name: "  Béatrice  - Warm" }, "  BEA ")).toBe(true);
  expect(matchesVoiceName({ name: "Will   Smith" }, "will smith")).toBe(true);
  expect(matchesVoiceName({ name: "李明" }, "李")).toBe(true);
  expect(matchesVoiceName({ name: "Alice" }, "  ")).toBe(true);
});
