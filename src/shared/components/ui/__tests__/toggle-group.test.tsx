import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { describe, expect, it } from "vitest";
import { ToggleGroup, ToggleGroupItem } from "../toggle-group";

function Controlled() {
  const [value, setValue] = useState<string[]>(["a"]);
  return (
    <ToggleGroup onValueChange={setValue} value={value}>
      <ToggleGroupItem value="a">A</ToggleGroupItem>
      <ToggleGroupItem value="b">B</ToggleGroupItem>
    </ToggleGroup>
  );
}

describe("ToggleGroup", () => {
  it("selects a single value and reflects pressed state", async () => {
    render(<Controlled />);
    const a = screen.getByRole("button", { name: "A" });
    const b = screen.getByRole("button", { name: "B" });
    expect(a).toHaveAttribute("aria-pressed", "true");
    await userEvent.click(b);
    expect(b).toHaveAttribute("aria-pressed", "true");
    expect(a).toHaveAttribute("aria-pressed", "false");
  });
});
