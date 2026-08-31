import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { PresetImage } from "./PresetImage";

afterEach(cleanup);

describe("PresetImage", () => {
  it("allows tenant-authenticated hosted preset preview routes", () => {
    render(
      <PresetImage
        src="/api/v2/hosted/avatars/44444444-4444-4444-8444-444444444444/preview"
        alt="Hosted presenter"
      />,
    );
    expect(screen.getByRole("img", { name: "Hosted presenter" })).toHaveAttribute(
      "src",
      "/api/v2/hosted/avatars/44444444-4444-4444-8444-444444444444/preview",
    );
  });

  it("allows a bounded hosted style reference preview route", () => {
    render(
      <PresetImage
        src="/api/v2/hosted/styles/44444444-4444-4444-8444-444444444444/preview?reference=4"
        alt="Fourth style reference"
      />,
    );
    expect(screen.getByRole("img", { name: "Fourth style reference" })).toHaveAttribute(
      "src",
      "/api/v2/hosted/styles/44444444-4444-4444-8444-444444444444/preview?reference=4",
    );
  });

  it("rejects out-of-range hosted style reference previews", () => {
    render(
      <PresetImage
        src="/api/v2/hosted/styles/44444444-4444-4444-8444-444444444444/preview?reference=9"
        alt="Invalid style reference"
      />,
    );
    expect(screen.getByRole("img", { name: "Invalid style reference unavailable" })).toBeVisible();
  });

  it("renders a tenant-checked avatar preview URL", () => {
    render(
      <PresetImage
        src="/api/v1/avatar-profiles/avatar_profile_fixture_created_001/versions/avatar_profile_version_fixture_created_001/preview"
        alt="Maya presenter"
      />,
    );

    expect(screen.getByRole("img", { name: "Maya presenter" })).toHaveAttribute(
      "src",
      "/api/v1/avatar-profiles/avatar_profile_fixture_created_001/versions/avatar_profile_version_fixture_created_001/preview",
    );
  });

  it("keeps unsafe sources out of the DOM and falls back after an image error", () => {
    const { rerender } = render(
      <PresetImage src="https://untrusted.example/avatar.png" alt="Maya presenter" />,
    );

    expect(screen.getByRole("img", { name: "Maya presenter unavailable" })).toBeVisible();

    rerender(
      <PresetImage
        src="/api/v1/avatar-profiles/avatar_profile_fixture_created_001/versions/avatar_profile_version_fixture_created_001/preview"
        alt="Maya presenter"
      />,
    );
    fireEvent.error(screen.getByRole("img", { name: "Maya presenter" }));

    expect(screen.getByRole("img", { name: "Maya presenter unavailable" })).toBeVisible();
  });
});
