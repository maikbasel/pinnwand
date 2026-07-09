import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { describe, expect, it } from "vitest";
import { Checkbox } from "../checkbox";

function Controlled() {
  const [checked, setChecked] = useState(false);
  return (
    <Checkbox
      aria-label="Alice"
      checked={checked}
      onCheckedChange={setChecked}
    />
  );
}

describe("Checkbox", () => {
  it("toggles checked state on click", async () => {
    render(<Controlled />);
    const box = screen.getByRole("checkbox", { name: "Alice" });
    expect(box).toHaveAttribute("aria-checked", "false");
    await userEvent.click(box);
    expect(box).toHaveAttribute("aria-checked", "true");
  });
});
