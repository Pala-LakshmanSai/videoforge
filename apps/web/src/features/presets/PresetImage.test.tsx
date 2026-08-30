import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { PresetImage } from "./PresetImage";

afterEach(cleanup);

describe("PresetImage", () => {
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
