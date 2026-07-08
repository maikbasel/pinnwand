import type { Locator, Page } from "@playwright/test";
import { SHARE_PANEL_HEADING } from "@/features/boards/lib/copy";

// Share codes are 8 unambiguous upper-case/digit characters (see
// gen_join_code() in supabase/migrations/20260706120000_init.sql).
const SHARE_CODE_PATTERN = /^[A-Z2-9]{8}$/;

// A single board's detail view: rename, the share panel (join code), and
// delete/leave. The board's own name renders as the page's <h1>.
export class BoardDetailPage {
  readonly page: Page;
  readonly shareHeading: Locator;
  readonly shareCode: Locator;

  constructor(page: Page) {
    this.page = page;
    this.shareHeading = page.getByText(SHARE_PANEL_HEADING, { exact: true });
    this.shareCode = page.getByText(SHARE_CODE_PATTERN);
  }

  // `name` is the board's own name, test data rather than UI copy.
  heading(name: string | RegExp): Locator {
    return this.page.getByRole("heading", { level: 1, name });
  }

  async getShareCode(): Promise<string> {
    return (await this.shareCode.innerText()).trim();
  }
}
