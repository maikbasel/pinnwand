import type { Locator, Page } from "@playwright/test";
import {
  BOARDS_PAGE_HEADING,
  CREATE_BOARD_CTA,
  JOIN_BOARD_CTA,
} from "@/features/boards/lib/copy";

// The boards list, the authenticated landing surface: owned + joined boards,
// the inline create entry, and the link to the join-by-code page.
export class BoardsPage {
  readonly page: Page;
  readonly heading: Locator;
  readonly newBoardButton: Locator;
  readonly createBoardInput: Locator;
  readonly joinBoardLink: Locator;

  constructor(page: Page) {
    this.page = page;
    this.heading = page.getByRole("heading", { name: BOARDS_PAGE_HEADING });
    this.newBoardButton = page.getByRole("button", { name: CREATE_BOARD_CTA });
    this.createBoardInput = page.getByLabel(CREATE_BOARD_CTA);
    this.joinBoardLink = page.getByRole("link", { name: JOIN_BOARD_CTA });
  }

  async goto(): Promise<void> {
    await this.page.goto("/");
  }

  // Each board card renders as a button whose accessible name is the board's
  // name (see BoardCard); `name` is the caller's test data, not UI copy.
  boardEntry(name: string | RegExp): Locator {
    return this.page.getByRole("button", { name });
  }

  async createBoard(name: string): Promise<void> {
    await this.newBoardButton.click();
    await this.createBoardInput.fill(name);
    await this.createBoardInput.press("Enter");
  }
}
