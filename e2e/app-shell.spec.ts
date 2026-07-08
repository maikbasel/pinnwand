import { expect, type Locator, type Page } from "@playwright/test";
import { NO_BOARD_SELECTED_HEADING } from "@/features/boards/lib/copy";
import {
  ACCOUNT_LABEL,
  BACK_TO_BOARDS_LABEL,
  BOARDS_NAV_LABEL,
  BRAND_NAME,
  CREATE_BOARD_RAIL_LABEL,
  SIGN_OUT_LABEL,
} from "@/features/navigation/lib/copy";
import { test } from "./fixtures";
import { adminClient, createAuthenticatedUser } from "./helpers/direct-auth";

const SIGN_IN_URL_PATTERN = /\/sign-in/;
const APP_ROOT_URL_PATTERN = /\/$/;
const BOARD_DETAIL_URL_PATTERN = /\/boards\/.+/;

// Every test mints its own board-owning user and deletes the board in
// `finally`, so this spec must not ride the shared authenticated
// storageState (see .claude/rules/playwright.md "Specs that mutate
// board-scoped state must self-isolate").
test.use({ storageState: { cookies: [], origins: [] } });

// The desktop rail nav (see SidebarRail): `aria-label={BOARDS_NAV_LABEL}` on
// the `<nav>`. Board rows render as buttons named for the board.
function rail(page: Page): Locator {
  return page.getByRole("navigation", { name: BOARDS_NAV_LABEL });
}

// The account control shared by the rail (desktop) and the top app bar
// (mobile): `aria-label={ACCOUNT_LABEL}` on the popover trigger, Abmelden as
// the popover's only item (see AccountMenu).
function accountMenuTrigger(page: Page): Locator {
  return page.getByRole("button", { name: ACCOUNT_LABEL });
}

async function signOut(page: Page): Promise<void> {
  await accountMenuTrigger(page).click();
  await page.getByRole("button", { name: SIGN_OUT_LABEL }).click();
}

test.describe("desktop shell", () => {
  // biome-ignore lint/correctness/noEmptyPattern: Playwright requires the destructuring pattern for the fixtures arg even when none are used.
  test.beforeEach(({}, testInfo) => {
    // This spec covers both viewports in one file; each describe block runs
    // only on the projects its layout applies to, not a disabled/pending test.
    // biome-ignore lint/suspicious/noSkippedTests: project-scoped skip, see above
    test.skip(
      testInfo.project.name !== "chromium",
      "desktop rail behavior only applies to the chromium (desktop) project"
    );
  });

  test("rail navigation, account menu sign out, and the empty pane", async ({
    page,
    boardDetailPage,
  }) => {
    const owner = await createAuthenticatedUser(page);
    const boardName = `E2E Shell Board ${Date.now()}`;

    try {
      // On the list root, no board is open: the rail is visible and the main
      // pane shows the desktop empty state.
      await expect(rail(page)).toBeVisible();
      await expect(
        page.getByRole("heading", { name: NO_BOARD_SELECTED_HEADING })
      ).toBeVisible();

      // Creating a board through the rail's create action reveals an inline
      // input inside the boards nav, lists the new board there, and navigates
      // straight to its detail page; the rail stays mounted (it lives outside
      // the route outlet) while the board renders in the main pane. The create
      // action sits above the collapsible boards group, so it is scoped to the
      // sidebar rather than the nav.
      await page.getByRole("button", { name: CREATE_BOARD_RAIL_LABEL }).click();
      const createInput = rail(page).getByRole("textbox");
      await createInput.fill(boardName);
      await createInput.press("Enter");

      await expect(boardDetailPage.heading(boardName)).toBeVisible();
      await expect(rail(page)).toBeVisible();
      const railBoardEntry = rail(page).getByRole("button", {
        name: boardName,
      });
      await expect(railBoardEntry).toHaveAttribute("aria-current", "page");

      // Back on the list root, clicking the rail item reopens the board.
      await page.goto("/");
      await expect(
        page.getByRole("heading", { name: NO_BOARD_SELECTED_HEADING })
      ).toBeVisible();
      await rail(page).getByRole("button", { name: boardName }).click();
      await expect(page).toHaveURL(BOARD_DETAIL_URL_PATTERN);
      await expect(boardDetailPage.heading(boardName)).toBeVisible();
      await expect(rail(page)).toBeVisible();

      // The account trigger opens the popover; signing out lands on sign-in.
      await expect(accountMenuTrigger(page)).toBeVisible();
      await signOut(page);
      await expect(page).toHaveURL(SIGN_IN_URL_PATTERN);
    } finally {
      await adminClient.from("boards").delete().eq("created_by", owner.userId);
      await owner.cleanup();
    }
  });
});

test.describe("mobile shell", () => {
  // biome-ignore lint/correctness/noEmptyPattern: Playwright requires the destructuring pattern for the fixtures arg even when none are used.
  test.beforeEach(({}, testInfo) => {
    // This spec covers both viewports in one file; each describe block runs
    // only on the projects its layout applies to, not a disabled/pending test.
    // biome-ignore lint/suspicious/noSkippedTests: project-scoped skip, see above
    test.skip(
      !testInfo.project.name.startsWith("mobile"),
      "mobile top-bar behavior only applies to the mobile projects"
    );
  });

  test("top bar navigation, back link, and the compact account menu", async ({
    page,
    boardsPage,
    boardDetailPage,
  }) => {
    const owner = await createAuthenticatedUser(page);
    const boardName = `E2E Shell Board ${Date.now()}`;
    const topBar = page.getByRole("banner");
    const backToBoardsLink = page.getByRole("link", {
      name: BACK_TO_BOARDS_LABEL,
    });

    try {
      // On the list root the top bar shows the brand, the full mobile boards
      // list renders as the main content, and the desktop rail is not shown.
      await expect(topBar.getByText(BRAND_NAME, { exact: true })).toBeVisible();
      await expect(boardsPage.heading).toBeVisible();
      await expect(rail(page)).not.toBeVisible();

      // Creating a board pushes to its detail route; the top bar swaps to the
      // board's name plus a back control.
      await boardsPage.createBoard(boardName);
      await expect(page).toHaveURL(BOARD_DETAIL_URL_PATTERN);
      await expect(boardDetailPage.heading(boardName)).toBeVisible();
      await expect(topBar.getByText(boardName, { exact: true })).toBeVisible();
      await expect(backToBoardsLink).toBeVisible();

      // The back control returns to the list.
      await backToBoardsLink.click();
      await expect(page).toHaveURL(APP_ROOT_URL_PATTERN);
      await expect(boardsPage.heading).toBeVisible();
      await expect(topBar.getByText(BRAND_NAME, { exact: true })).toBeVisible();

      // Reopen the board, then sign out through the compact account menu.
      await boardsPage.boardEntry(boardName).click();
      await expect(boardDetailPage.heading(boardName)).toBeVisible();
      await expect(accountMenuTrigger(page)).toBeVisible();
      await signOut(page);
      await expect(page).toHaveURL(SIGN_IN_URL_PATTERN);
    } finally {
      await adminClient.from("boards").delete().eq("created_by", owner.userId);
      await owner.cleanup();
    }
  });
});
