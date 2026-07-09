import { expect, type Locator, type Page } from "@playwright/test";
import {
  ADD_TASK_LABEL,
  ADD_TASK_SUBMIT,
  DELETE_TASK_LABEL,
  SAVE_TASK_LABEL,
  TASK_DELETED_TOAST,
  TASK_TITLE_LABEL,
  TASK_TITLE_PLACEHOLDER,
  UNDO_LABEL,
} from "@/features/tasks/lib/copy";

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

  // --- Tasks ---------------------------------------------------------------
  // A column is a `<section aria-label={label}>` (implicit role "region"); the
  // label is the German column copy (TASK_COLUMNS[n].label), not test data.
  column(columnLabel: string): Locator {
    return this.page.getByRole("region", { name: columnLabel });
  }

  // The detail sheet is a right-side Sheet on desktop and a bottom Drawer on
  // mobile; both present as a single `role="dialog"`. Scoping the field/toggle
  // locators to it keeps them off the board rendered behind.
  get sheet(): Locator {
    return this.page.getByRole("dialog");
  }

  // Every task renders one `data-testid="task-card"`; `title` is caller test
  // data. `visible: true` skips the portaled drag-overlay clone.
  taskCard(title: string): Locator {
    return this.page
      .getByTestId("task-card")
      .filter({ hasText: title })
      .filter({ visible: true });
  }

  cardInColumn(columnLabel: string, title: string): Locator {
    return this.column(columnLabel)
      .getByTestId("task-card")
      .filter({ hasText: title });
  }

  get deletedToast(): Locator {
    return this.page.getByText(TASK_DELETED_TOAST);
  }

  get undoButton(): Locator {
    return this.page.getByRole("button", { name: UNDO_LABEL });
  }

  // Inline quick-add: open the column composer, type the title, submit, then
  // dismiss the still-open composer so the board returns to rest. Waits for the
  // insert to land so the optimistic temp id is swapped for the real row before
  // a follow-up edit targets it (editing a `temp-…` id the server rejects).
  async addTask(columnLabel: string, title: string): Promise<void> {
    await this.page
      .getByRole("button", { name: `${ADD_TASK_LABEL}: ${columnLabel}` })
      .click();
    const input = this.page.getByLabel(TASK_TITLE_PLACEHOLDER);
    await input.fill(title);
    await Promise.all([
      this.page.waitForResponse(
        (response) =>
          response.url().includes("/rest/v1/tasks?") &&
          response.request().method() === "POST"
      ),
      this.page
        .getByRole("button", { name: ADD_TASK_SUBMIT, exact: true })
        .click(),
    ]);
    await input.press("Escape");
  }

  async openTask(title: string): Promise<void> {
    await this.taskCard(title).click();
    await expect(this.sheet).toBeVisible();
  }

  // `fill` sets the DOM value without driving Base UI's controlled onChange, so
  // the form state never updates and Save persists the old title. Real
  // keystrokes (select-all, delete, type) fire onChange per key, matching how a
  // user actually edits.
  async editTitle(newTitle: string): Promise<void> {
    const input = this.sheet.getByLabel(TASK_TITLE_LABEL);
    await input.click();
    await input.press("ControlOrMeta+a");
    await input.press("Delete");
    await input.pressSequentially(newTitle);
  }

  // Picks a column in the sheet's Status ToggleGroup. Each item is a toggle
  // button whose accessible name is exactly the column label.
  async setStatus(columnLabel: string): Promise<void> {
    await this.sheet
      .getByRole("button", { name: columnLabel, exact: true })
      .click();
  }

  async saveTask(): Promise<void> {
    await this.clickSheetAction(SAVE_TASK_LABEL);
  }

  // Routes through the deferred-delete flow: closes the sheet, hides the card,
  // and raises the Undo snackbar.
  async deleteViaSheet(): Promise<void> {
    await this.clickSheetAction(DELETE_TASK_LABEL);
  }

  // The mobile detail sheet is a vaul Drawer whose transform/clip layer wins the
  // pointer hit-test over its own bottom actions, so a real click never lands
  // (the drawer content intercepts at every point of the button). A phone user
  // taps it fine — this is a Playwright-vs-vaul quirk — so dispatch the click
  // directly, which fires React's onClick. The caller's outcome assertion (card
  // moved / deleted) still gates that the action actually took effect.
  private async clickSheetAction(name: string): Promise<void> {
    await this.sheet.getByRole("button", { name }).dispatchEvent("click");
  }
}

export { SHARE_CODE_PATTERN };
