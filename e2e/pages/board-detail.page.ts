import type { Locator, Page } from "@playwright/test";

// Share codes are 8 unambiguous upper-case/digit characters (see
// gen_join_code() in supabase/migrations/20260706120000_init.sql).
const SHARE_CODE_PATTERN = /^[A-Z2-9]{8}$/;

// A single board's detail view. The board name renders as the page heading
// (desktop header on `md+`, top app bar on mobile); both carry
// `data-testid="board-name"`, and only one is visible per viewport. Sharing,
// renaming, and delete/leave live behind the board actions menu (the `⋯`
// trigger), so the board fills the page.
export class BoardDetailPage {
  readonly page: Page;
  readonly actionsTrigger: Locator;
  readonly shareCode: Locator;

  constructor(page: Page) {
    this.page = page;
    // The actions menu renders in both shells; target the visible one.
    this.actionsTrigger = page
      .getByTestId("board-actions-trigger")
      .filter({ visible: true });
    this.shareCode = page.getByTestId("board-share-code");
  }

  // `name` is the board's own name (test data, not UI copy). Resolves to the
  // visible board-name heading for the current viewport.
  heading(name: string | RegExp): Locator {
    return this.page
      .getByTestId("board-name")
      .filter({ hasText: name })
      .filter({ visible: true });
  }

  // Opens the actions menu, then the share surface (responsive Dialog/Drawer).
  async openShare(): Promise<void> {
    await this.actionsTrigger.click();
    await this.page.getByTestId("board-action-share").click();
  }

  async getShareCode(): Promise<string> {
    await this.openShare();
    return (await this.shareCode.innerText()).trim();
  }
}

export { SHARE_CODE_PATTERN };
