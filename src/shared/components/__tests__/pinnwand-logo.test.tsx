import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { PinnwandLogo } from "../pinnwand-logo";

describe("PinnwandLogo", () => {
  it("renders an accessible image with the default variant", () => {
    const { getByRole, container } = render(<PinnwandLogo />);
    const svg = getByRole("img", { name: "Pinnwand" });
    expect(svg.tagName.toLowerCase()).toBe("svg");
    expect(container.querySelector(".pinnwand-logo-default")).not.toBeNull();
    expect(container.querySelector(".pinnwand-bg")).not.toBeNull();
    expect(container.querySelector(".pinnwand-glyph")).not.toBeNull();
  });

  it("applies the requested variant class", () => {
    const { container } = render(<PinnwandLogo variant="mono" />);
    expect(container.querySelector(".pinnwand-logo-mono")).not.toBeNull();
  });

  it("sizes both dimensions when size is given", () => {
    const { container } = render(<PinnwandLogo size={32} />);
    const svg = container.querySelector("svg");
    expect(svg?.getAttribute("width")).toBe("32");
    expect(svg?.getAttribute("height")).toBe("32");
  });

  it("marks itself decorative when title is null", () => {
    const { container } = render(<PinnwandLogo title={null} />);
    const svg = container.querySelector("svg");
    expect(svg?.getAttribute("aria-hidden")).toBe("true");
    expect(svg?.getAttribute("role")).toBeNull();
  });
});
