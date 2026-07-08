import { expect } from "@playwright/test";
import { test } from "./fixtures";
import { adminClient, createAuthenticatedUser } from "./helpers/direct-auth";
import { BoardDetailPage } from "./pages/board-detail.page";
import { BoardsPage } from "./pages/boards.page";
import { JoinBoardPage } from "./pages/join-board.page";

// Share codes are 8 unambiguous upper-case/digit characters (see
// gen_join_code() in supabase/migrations/20260706120000_init.sql).
const SHARE_CODE_PATTERN = /^[A-Z2-9]{8}$/;

// This spec creates boards and mints its own users per test, so it must not
// ride the shared authenticated storageState (see .claude/rules/playwright.md
// "Specs that mutate board-scoped state must self-isolate").
test.use({ storageState: { cookies: [], origins: [] } });

test("a user creates a board, shares its code, and a second user joins it", async ({
  page,
  boardsPage,
  boardDetailPage,
}) => {
  const owner = await createAuthenticatedUser(page);
  const boardName = `E2E Board ${Date.now()}`;

  try {
    // 1. Create a board via the inline create entry.
    await boardsPage.createBoard(boardName);

    // Creating a board navigates straight to its detail page; wait for that
    // navigation so the mutation is settled before checking the list.
    await expect(boardDetailPage.heading(boardName)).toBeVisible();

    // Go back to the list to confirm the board is now present there.
    await boardsPage.goto();
    await expect(boardsPage.boardEntry(boardName)).toBeVisible();

    // 2. Opening the board shows its share code.
    await boardsPage.boardEntry(boardName).click();
    await expect(boardDetailPage.heading(boardName)).toBeVisible();
    await expect(boardDetailPage.shareHeading).toBeVisible();
    const joinCode = await boardDetailPage.getShareCode();
    expect(joinCode).toMatch(SHARE_CODE_PATTERN);

    // 3. A second user joins via the code on /boards/join.
    const memberContext = await page.context().browser()?.newContext();
    if (!memberContext) {
      throw new Error("failed to open a second browser context");
    }
    const memberPage = await memberContext.newPage();
    const member = await createAuthenticatedUser(memberPage, {
      landOnHome: false,
    });

    try {
      const memberJoinPage = new JoinBoardPage(memberPage);
      await memberJoinPage.goto();
      await memberJoinPage.enterCode(joinCode);

      const memberBoardDetailPage = new BoardDetailPage(memberPage);
      await expect(memberBoardDetailPage.heading(boardName)).toBeVisible();

      const memberBoardsPage = new BoardsPage(memberPage);
      await memberBoardsPage.goto();
      await expect(memberBoardsPage.boardEntry(boardName)).toBeVisible();
    } finally {
      await member.cleanup();
      await memberContext.close();
    }
  } finally {
    // `boards.created_by` is `not null` with `on delete set null`, so
    // deleting the owner while they still own a board fails the FK
    // constraint. Delete the board first so cleanup doesn't fail.
    await adminClient.from("boards").delete().eq("created_by", owner.userId);
    await owner.cleanup();
  }
});
