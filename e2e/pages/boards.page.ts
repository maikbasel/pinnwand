import type { Locator, Page } from "@playwright/test";

const HEADING_PATTERN = /^Pinnwand$/;
const NEW_BOARD_PATTERN = /neues board/i;
const SIGN_OUT_PATTERN = /abmelden/i;

// The boards list, the authenticated landing surface. Right now it renders a
// static placeholder; the real list (owned + joined boards, create dialog,
// join-by-code) lands with the `boards` feature slice, at which point this POM
// grows locators for those controls.
export class BoardsPage {
  readonly page: Page;
  readonly heading: Locator;
  readonly newBoardButton: Locator;
  readonly signOutButton: Locator;

  constructor(page: Page) {
    this.page = page;
    this.heading = page.getByRole("heading", { name: HEADING_PATTERN });
    this.newBoardButton = page.getByRole("button", { name: NEW_BOARD_PATTERN });
    this.signOutButton = page.getByRole("button", { name: SIGN_OUT_PATTERN });
  }

  async goto(): Promise<void> {
    await this.page.goto("/");
  }
}
