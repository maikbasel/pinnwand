import type { Locator, Page } from "@playwright/test";
import { JOIN_BOARD_CTA, JOIN_PAGE_HEADING } from "@/features/boards/lib/copy";

// The join-by-code page (`/boards/join`): an 8-character OTP-style code
// input that auto-submits once fully typed.
export class JoinBoardPage {
  readonly page: Page;
  readonly heading: Locator;
  readonly codeInput: Locator;
  readonly submitButton: Locator;
  readonly errorRegion: Locator;

  constructor(page: Page) {
    this.page = page;
    this.heading = page.getByRole("heading", { name: JOIN_PAGE_HEADING });
    // input-otp renders a single real <input> carrying the aria-label.
    this.codeInput = page.getByRole("textbox", { name: JOIN_PAGE_HEADING });
    this.submitButton = page.getByRole("button", { name: JOIN_BOARD_CTA });
    this.errorRegion = page.getByRole("alert");
  }

  async goto(): Promise<void> {
    await this.page.goto("/boards/join");
  }

  // Typing the full 8-character code auto-submits (see JoinBoardPage's
  // onCodeChange), so callers don't need to click `submitButton` separately.
  async enterCode(code: string): Promise<void> {
    await this.codeInput.focus();
    await this.page.keyboard.type(code);
  }
}
