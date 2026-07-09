import type { Locator, Page } from "@playwright/test";
import { NO_BOARD_SELECTED_HEADING } from "@/features/boards/lib/copy";
import {
  ACCOUNT_LABEL,
  BACK_TO_BOARDS_LABEL,
  BOARDS_NAV_LABEL,
  BRAND_NAME,
  CREATE_BOARD_RAIL_LABEL,
} from "@/features/navigation/lib/copy";

/**
 * The persistent authed chrome: the desktop sidebar rail and the mobile top
 * app bar, plus the shared account menu. Encapsulates every selector the shell
 * specs (desktop rail, mobile top bar, auth, smoke) touch, so those specs
 * carry no raw selectors (see .claude/rules/playwright.md).
 */
export class AppShellPage {
  readonly page: Page;
  readonly rail: Locator;
  readonly accountTrigger: Locator;
  readonly topBar: Locator;
  readonly backToBoardsLink: Locator;
  readonly brandInTopBar: Locator;
  readonly noBoardSelectedHeading: Locator;
  readonly railCreateButton: Locator;

  constructor(page: Page) {
    this.page = page;
    // The desktop rail nav (SidebarRail): `aria-label={BOARDS_NAV_LABEL}` on
    // the <nav>; board rows render as buttons named for the board.
    this.rail = page.getByRole("navigation", { name: BOARDS_NAV_LABEL });
    // The account control shared by the rail (desktop) and the top app bar
    // (mobile): `aria-label={ACCOUNT_LABEL}` on the popover trigger.
    this.accountTrigger = page.getByRole("button", { name: ACCOUNT_LABEL });
    this.topBar = page.getByRole("banner");
    this.backToBoardsLink = page.getByRole("link", {
      name: BACK_TO_BOARDS_LABEL,
    });
    this.brandInTopBar = this.topBar.getByText(BRAND_NAME, { exact: true });
    this.noBoardSelectedHeading = page.getByRole("heading", {
      name: NO_BOARD_SELECTED_HEADING,
    });
    this.railCreateButton = page.getByRole("button", {
      name: CREATE_BOARD_RAIL_LABEL,
    });
  }

  async signOut(): Promise<void> {
    await this.accountTrigger.click();
    // The sign-out row is a Base UI menu item (role="menuitem"), not a button,
    // so target its e2e testid rather than a button role.
    await this.page.getByTestId("account-signout").click();
  }

  // A board row inside the desktop rail (`name` is board test data, not copy).
  railBoardEntry(name: string | RegExp): Locator {
    return this.rail.getByRole("button", { name });
  }

  // The board's name shown in the mobile top app bar (`name` is test data).
  topBarBoardName(name: string): Locator {
    return this.topBar.getByText(name, { exact: true });
  }

  // Create a board through the rail's create action: reveals an inline input
  // inside the boards nav, then submits it.
  async createBoardViaRail(name: string): Promise<void> {
    await this.railCreateButton.click();
    const createInput = this.rail.getByRole("textbox");
    await createInput.fill(name);
    await createInput.press("Enter");
  }
}
