import { TASK_COLUMNS } from "@pinnwand/contracts";
import { expect } from "@playwright/test";
import { test } from "./fixtures";
import { adminClient, createAuthenticatedUser } from "./helpers/direct-auth";
import { BoardDetailPage } from "./pages/board-detail.page";
import { JoinBoardPage } from "./pages/join-board.page";

// Share codes are 8 unambiguous upper-case/digit characters (see
// gen_join_code() in supabase/migrations/20260706120000_init.sql).
const SHARE_CODE_PATTERN = /^[A-Z2-9]{8}$/;

const OFFEN = TASK_COLUMNS[0].label;
const ERLEDIGT = TASK_COLUMNS[3].label;

// This spec creates boards + tasks and mints its own users per test, so it must
// not ride the shared authenticated storageState (see .claude/rules/playwright.md
// "Specs that mutate board-scoped state must self-isolate").
test.use({ storageState: { cookies: [], origins: [] } });

test("a member creates, edits, moves, and deletes a task", async ({
  page,
  boardsPage,
  boardDetailPage,
}) => {
  const owner = await createAuthenticatedUser(page);
  const boardName = `E2E Tasks ${Date.now()}`;
  const title = `Aufgabe ${Date.now()}`;
  const editedTitle = `${title} bearbeitet`;

  try {
    await boardsPage.createBoard(boardName);
    await expect(boardDetailPage.heading(boardName)).toBeVisible();

    // Create: the new card lands in the column it was added to.
    await boardDetailPage.addTask(OFFEN, title);
    await expect(boardDetailPage.cardInColumn(OFFEN, title)).toBeVisible();

    // Edit: renaming through the detail sheet updates the card in place.
    await boardDetailPage.openTask(title);
    await boardDetailPage.editTitle(editedTitle);
    await boardDetailPage.saveTask();
    await expect(
      boardDetailPage.cardInColumn(OFFEN, editedTitle)
    ).toBeVisible();

    // Move: switching the sheet's Status relocates the card to the target
    // column and clears it from the origin.
    await boardDetailPage.openTask(editedTitle);
    await boardDetailPage.setStatus(ERLEDIGT);
    await boardDetailPage.saveTask();
    await expect(
      boardDetailPage.cardInColumn(ERLEDIGT, editedTitle)
    ).toBeVisible();
    await expect(boardDetailPage.cardInColumn(OFFEN, editedTitle)).toBeHidden();

    // Delete: the deferred-delete flow hides the card immediately and offers
    // Undo.
    await boardDetailPage.openTask(editedTitle);
    await boardDetailPage.deleteViaSheet();
    await expect(boardDetailPage.deletedToast).toBeVisible();
    await expect(boardDetailPage.undoButton).toBeVisible();
    await expect(boardDetailPage.taskCard(editedTitle)).toBeHidden();
  } finally {
    // `boards.created_by` is `not null` with `on delete set null`, so deleting
    // the owner while they still own a board fails the FK constraint. Delete
    // the board first so cleanup doesn't fail.
    await adminClient.from("boards").delete().eq("created_by", owner.userId);
    await owner.cleanup();
  }
});

test("realtime: a task one member adds appears for another", async ({
  page,
  boardsPage,
  boardDetailPage,
}) => {
  // A self-hosted realtime channel can be slow to deliver its first event after
  // a cold subscribe; give the whole journey room beyond the 30s default.
  test.setTimeout(90_000);
  const owner = await createAuthenticatedUser(page);
  const boardName = `E2E Realtime ${Date.now()}`;
  const title = `Live ${Date.now()}`;

  try {
    await boardsPage.createBoard(boardName);
    await expect(boardDetailPage.heading(boardName)).toBeVisible();
    const joinCode = await boardDetailPage.getShareCode();
    expect(joinCode).toMatch(SHARE_CODE_PATTERN);
    // Close the share surface so it doesn't sit over the board.
    await page.keyboard.press("Escape");
    await expect(boardDetailPage.shareCode).toBeHidden();

    const memberContext = await page.context().browser()?.newContext();
    if (!memberContext) {
      throw new Error("failed to open a second browser context");
    }
    const memberPage = await memberContext.newPage();
    const member = await createAuthenticatedUser(memberPage, {
      landOnHome: false,
    });

    try {
      // Member joins by code and lands on the shared board (realtime now
      // subscribed on their side).
      const memberJoinPage = new JoinBoardPage(memberPage);
      await memberJoinPage.goto();
      await memberJoinPage.enterCode(joinCode);

      const memberBoardDetailPage = new BoardDetailPage(memberPage);
      await expect(memberBoardDetailPage.heading(boardName)).toBeVisible();

      // The board heading renders as soon as the board mounts, but the realtime
      // channel subscribes a beat later. An insert that lands before the
      // SUBSCRIBED handshake is dropped with nothing to re-trigger it, so wait
      // for the member's channel to actually report subscribed before the owner
      // writes — a real handshake signal, not a blind sleep.
      await expect(memberBoardDetailPage.realtimeSubscribed).toBeVisible({
        timeout: 20_000,
      });

      // Owner adds a task; it must surface on the member's board without a
      // reload, driven by the realtime invalidation.
      await boardDetailPage.addTask(OFFEN, title);
      await expect(
        memberBoardDetailPage.cardInColumn(OFFEN, title)
      ).toBeVisible({ timeout: 20_000 });
    } finally {
      await member.cleanup();
      await memberContext.close();
    }
  } finally {
    await adminClient.from("boards").delete().eq("created_by", owner.userId);
    await owner.cleanup();
  }
});
