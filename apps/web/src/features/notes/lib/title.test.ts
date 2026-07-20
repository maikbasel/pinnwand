import { describe, expect, it } from "vitest";
import { deriveTitle, UNTITLED_NOTE } from "./title";

describe("deriveTitle", () => {
  it("uses the first non-empty line", () => {
    expect(deriveTitle("Einkaufsliste\nMilch\nBrot")).toBe("Einkaufsliste");
  });

  it("skips leading blank lines", () => {
    expect(deriveTitle("\n\n  Sprintplanung\nDetails")).toBe("Sprintplanung");
  });

  it("falls back for an empty document", () => {
    expect(deriveTitle("")).toBe(UNTITLED_NOTE);
    expect(deriveTitle("   \n  \n")).toBe(UNTITLED_NOTE);
  });

  it("truncates a very long first line", () => {
    const title = deriveTitle("a".repeat(500));
    expect(title).toHaveLength(200);
  });

  it("collapses internal whitespace", () => {
    expect(deriveTitle("Viele    Leerzeichen  hier")).toBe(
      "Viele Leerzeichen hier"
    );
  });
});
