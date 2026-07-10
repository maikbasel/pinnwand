import { expect } from "@playwright/test";
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
    appShellPage,
    boardDetailPage,
  }) => {
    const owner = await createAuthenticatedUser(page);
    const boardName = `E2E Shell Board ${Date.now()}`;

    try {
      // On the list root, no board is open: the rail is visible and the main
      // pane shows the desktop empty state.
      await expect(appShellPage.rail).toBeVisible();
      await expect(appShellPage.noBoardSelectedHeading).toBeVisible();

      // Creating a board through the rail's create action lists the new board
      // there and navigates straight to its detail page; the rail stays
      // mounted (it lives outside the route outlet) while the board renders in
      // the main pane.
      await appShellPage.createBoardViaRail(boardName);

      await expect(boardDetailPage.heading(boardName)).toBeVisible();
      await expect(appShellPage.rail).toBeVisible();
      await expect(appShellPage.railBoardEntry(boardName)).toHaveAttribute(
        "aria-current",
        "page"
      );

      // Back on the list root, clicking the rail item reopens the board.
      await page.goto("/");
      await expect(appShellPage.noBoardSelectedHeading).toBeVisible();
      await appShellPage.railBoardEntry(boardName).click();
      await expect(page).toHaveURL(BOARD_DETAIL_URL_PATTERN);
      await expect(boardDetailPage.heading(boardName)).toBeVisible();
      await expect(appShellPage.rail).toBeVisible();

      // The account trigger opens the popover; signing out lands on sign-in.
      await expect(appShellPage.accountTrigger).toBeVisible();
      await appShellPage.signOut();
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
    appShellPage,
    boardsPage,
    boardDetailPage,
  }) => {
    const owner = await createAuthenticatedUser(page);
    const boardName = `E2E Shell Board ${Date.now()}`;

    try {
      // On the list root the top bar shows the brand, the full mobile boards
      // list renders as the main content, and the desktop rail is not shown.
      await expect(appShellPage.brandInTopBar).toBeVisible();
      await expect(boardsPage.heading).toBeVisible();
      await expect(appShellPage.rail).not.toBeVisible();

      // Creating a board pushes to its detail route; the top bar swaps to the
      // board's name plus a back control.
      await boardsPage.createBoard(boardName);
      await expect(page).toHaveURL(BOARD_DETAIL_URL_PATTERN);
      await expect(boardDetailPage.heading(boardName)).toBeVisible();
      await expect(appShellPage.topBarBoardName(boardName)).toBeVisible();
      await expect(appShellPage.backToBoardsLink).toBeVisible();

      // The back control returns to the list.
      await appShellPage.backToBoardsLink.click();
      await expect(page).toHaveURL(APP_ROOT_URL_PATTERN);
      await expect(boardsPage.heading).toBeVisible();
      await expect(appShellPage.brandInTopBar).toBeVisible();

      // Scope by depth: the account menu lives on the list root, not on a
      // board route. Reopening the board confirms the account trigger is absent
      // there (the board's ⋯ actions own that slot instead).
      await boardsPage.boardEntry(boardName).click();
      await expect(boardDetailPage.heading(boardName)).toBeVisible();
      await expect(appShellPage.accountTrigger).not.toBeVisible();

      // Back on the list, the compact account menu signs out.
      await appShellPage.backToBoardsLink.click();
      await expect(boardsPage.heading).toBeVisible();
      await expect(appShellPage.accountTrigger).toBeVisible();
      await appShellPage.signOut();
      await expect(page).toHaveURL(SIGN_IN_URL_PATTERN);
    } finally {
      await adminClient.from("boards").delete().eq("created_by", owner.userId);
      await owner.cleanup();
    }
  });
});
