import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { Button } from "./ui";

describe("Button", () => {
  it("locks duplicate clicks whenever an action is busy", () => {
    render(
      <Button busy disabled={false}>
        Approve final
      </Button>,
    );

    const button = screen.getByRole("button", { name: "Approve final" });
    expect(button).toBeDisabled();
    expect(button).toHaveAttribute("aria-busy", "true");
  });
});
