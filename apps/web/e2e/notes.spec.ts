import type { Browser, BrowserContext, Page } from "@playwright/test";
import { expect } from "@playwright/test";
import { type SignInAs, test } from "./fixtures";
import { adminClient } from "./helpers/direct-auth";
import { BoardDetailPage } from "./pages/board-detail.page";
import { BoardsPage } from "./pages/boards.page";
import { JoinBoardPage } from "./pages/join-board.page";

const NOTES_TAB_LABEL = "Notizen";
const CREATE_NOTE_LABEL = "Notiz erstellen";
const NOTE_EDITOR_LABEL = "Notiz bearbeiten";
const PARAGRAPH_LABEL = "Absatz";
const REALTIME_TIMEOUT_MS = 20_000;
const OFFLINE_MERGE_TIMEOUT_MS = 30_000;

// This spec creates boards + notes and mints its own users per test, so it
// must not ride the shared authenticated storageState (see
// .claude/rules/playwright.md "Specs that mutate board-scoped state must
// self-isolate").
test.use({ storageState: { cookies: [], origins: [] } });

// The editor is a ProseMirror `contenteditable` div carrying
// `aria-label="Notiz bearbeiten"` but no explicit `role`. Chromium's
// accessibility tree computes its role as "generic" rather than "textbox" for
// a contenteditable root with block children, so `getByRole("textbox", ...)`
// never matches it (confirmed against the running app) — `getByLabel` matches
// on the aria-label attribute directly, independent of computed role.
function noteEditor(page: Page) {
  return page.getByLabel(NOTE_EDITOR_LABEL);
}

async function openNotesTab(page: Page): Promise<void> {
  await page.getByRole("tab", { name: NOTES_TAB_LABEL }).click();
}

async function createNote(page: Page): Promise<void> {
  await page.getByRole("button", { name: CREATE_NOTE_LABEL }).click();
}

// Every note-list row renders two buttons: the note itself (named for its
// title) and a delete action named `${title} löschen`. Accessible-name
// matching is substring by default, so the delete button also matches an
// unqualified `getByRole("button", { name: title })` — `exact: true` is
// required to land on the note row alone.
function noteListEntry(page: Page, title: string) {
  return page.getByRole("button", { name: title, exact: true });
}

const BACK_TO_LIST_LABEL = "Zurück";

// On mobile the notes panel is master-detail stack navigation: creating (and
// so selecting) a note pushes a full-screen editor and hides the list behind
// it, dismissed via the "Zurück" affordance (see .claude/rules/frontend/
// mobile-first.md "Master-detail split"). Desktop shows both panes at once,
// so the button is always rendered but `md:hidden` (CSS `display:none`) —
// Playwright's role query reads the accessibility tree, which excludes
// `display:none` nodes, so a plain existence check is still deterministic
// per viewport rather than a timing-dependent conditional.
async function returnToNotesList(page: Page): Promise<void> {
  const backButton = page.getByRole("button", { name: BACK_TO_LIST_LABEL });
  if ((await backButton.count()) > 0) {
    await backButton.click();
  }
}

type SharedBoardSession = {
  aliceContext: BrowserContext;
  bobContext: BrowserContext;
  alicePage: Page;
  bobPage: Page;
  cleanup: () => Promise<void>;
};

// Alice creates a fresh board, Bob joins it by share code, and both land on
// its Notizen tab. Every two-member test below needs this, so it is
// extracted rather than repeated (mirrors the two-context setup in
// tasks.spec.ts's realtime test).
async function setUpSharedBoardSession(
  browser: Browser,
  signInAs: SignInAs
): Promise<SharedBoardSession> {
  const aliceContext = await browser.newContext();
  const bobContext = await browser.newContext();
  const alicePage = await aliceContext.newPage();
  const bobPage = await bobContext.newPage();

  const alice = await signInAs(alicePage, "Alice");
  const bob = await signInAs(bobPage, "Bob");

  const boardsPage = new BoardsPage(alicePage);
  const aliceBoardDetail = new BoardDetailPage(alicePage);
  const boardName = `E2E Notes ${Date.now()}`;
  await boardsPage.createBoard(boardName);
  await expect(aliceBoardDetail.heading(boardName)).toBeVisible();
  const joinCode = await aliceBoardDetail.getShareCode();
  await alicePage.keyboard.press("Escape");
  await expect(aliceBoardDetail.shareCode).toBeHidden();

  const bobJoinPage = new JoinBoardPage(bobPage);
  await bobJoinPage.goto();
  await bobJoinPage.enterCode(joinCode);
  const bobBoardDetail = new BoardDetailPage(bobPage);
  await expect(bobBoardDetail.heading(boardName)).toBeVisible();

  await openNotesTab(alicePage);
  await openNotesTab(bobPage);

  return {
    aliceContext,
    bobContext,
    alicePage,
    bobPage,
    cleanup: async () => {
      // `boards.created_by` is `not null` with `on delete set null`, so the
      // board must go before the owning user does (same ordering as
      // tasks.spec.ts). Notes/note_updates cascade off the board.
      await adminClient.from("boards").delete().eq("created_by", alice.userId);
      await alice.cleanup();
      await bob.cleanup();
      await aliceContext.close();
      await bobContext.close();
    },
  };
}

test.describe("Notizen", () => {
  test("creates a note and types into it", async ({
    page,
    boardsPage,
    boardDetailPage,
    signInAs,
  }) => {
    const owner = await signInAs(page, "Alice");
    const boardName = `E2E Notes ${Date.now()}`;

    try {
      await boardsPage.createBoard(boardName);
      await expect(boardDetailPage.heading(boardName)).toBeVisible();
      await openNotesTab(page);
      await createNote(page);

      const editor = noteEditor(page);
      await editor.click();
      await editor.pressSequentially("Sprintplanung");

      // The derived title is written after a debounce (UPDATE_FLUSH_MS in
      // lib/note-doc.ts) that is cancelled if the editor unmounts first — on
      // mobile, `returnToNotesList` unmounts it by navigating back to the
      // list. Waiting for the PATCH here (not a sleep) guarantees the title
      // lands before that navigation races it, on every viewport.
      await page.waitForResponse(
        (response) =>
          response.url().includes("/rest/v1/notes") &&
          response.request().method() === "PATCH"
      );
      await returnToNotesList(page);
      await expect(noteListEntry(page, "Sprintplanung")).toBeVisible();
    } finally {
      await adminClient.from("boards").delete().eq("created_by", owner.userId);
      await owner.cleanup();
    }
  });

  test("markdown shortcut converts a block, and the bar converts it back", async ({
    page,
    boardsPage,
    boardDetailPage,
    signInAs,
  }) => {
    const owner = await signInAs(page, "Alice");
    const boardName = `E2E Notes ${Date.now()}`;

    try {
      await boardsPage.createBoard(boardName);
      await expect(boardDetailPage.heading(boardName)).toBeVisible();
      await openNotesTab(page);
      await createNote(page);

      const editor = noteEditor(page);
      await editor.click();
      await editor.pressSequentially("## Überschrift");
      await expect(editor.locator("h2")).toHaveText("Überschrift");

      // No input rule removes a heading, which is why the format bar is not
      // optional.
      await page.getByRole("button", { name: PARAGRAPH_LABEL }).click();
      await expect(editor.locator("h2")).toHaveCount(0);
      // The heading input rule leaves its own trailing empty paragraph behind,
      // so more than one <p> exists here — scope to the one carrying the text.
      await expect(
        editor.locator("p").filter({ hasText: "Überschrift" })
      ).toBeVisible();
    } finally {
      await adminClient.from("boards").delete().eq("created_by", owner.userId);
      await owner.cleanup();
    }
  });

  test("two members converge on one note", async ({ browser, signInAs }) => {
    const session = await setUpSharedBoardSession(browser, signInAs);
    const { alicePage, bobPage } = session;

    try {
      await createNote(alicePage);
      const aliceEditor = noteEditor(alicePage);
      await aliceEditor.click();
      await aliceEditor.pressSequentially("Von Alice");

      await expect(noteListEntry(bobPage, "Von Alice")).toBeVisible({
        timeout: REALTIME_TIMEOUT_MS,
      });
      await noteListEntry(bobPage, "Von Alice").click();
      const bobEditor = noteEditor(bobPage);
      await expect(bobEditor).toContainText("Von Alice", {
        timeout: REALTIME_TIMEOUT_MS,
      });

      await bobEditor.click();
      await bobEditor.press("End");
      await bobEditor.pressSequentially(" und Bob");
      await expect(aliceEditor).toContainText("und Bob", {
        timeout: REALTIME_TIMEOUT_MS,
      });
    } finally {
      await session.cleanup();
    }
  });

  test("live carets: the other member's cursor label is visible", async ({
    browser,
    signInAs,
  }) => {
    const session = await setUpSharedBoardSession(browser, signInAs);
    const { alicePage, bobPage } = session;

    try {
      await createNote(alicePage);
      const aliceEditor = noteEditor(alicePage);
      await aliceEditor.click();
      await aliceEditor.pressSequentially("Live-Notiz");

      await expect(noteListEntry(bobPage, "Live-Notiz")).toBeVisible({
        timeout: REALTIME_TIMEOUT_MS,
      });
      await noteListEntry(bobPage, "Live-Notiz").click();
      const bobEditor = noteEditor(bobPage);
      await expect(bobEditor).toContainText("Live-Notiz", {
        timeout: REALTIME_TIMEOUT_MS,
      });

      // Bob places a cursor in the shared doc; Alice's editor renders his
      // awareness caret with his display name as the label.
      await bobEditor.click();
      await bobEditor.press("End");
      await bobEditor.pressSequentially(" Bob tippt");

      await expect(
        aliceEditor.locator(".collaboration-carets__label")
      ).toContainText("Bob", { timeout: REALTIME_TIMEOUT_MS });
    } finally {
      await session.cleanup();
    }
  });

  test("offline edits from both members merge on reconnect", async ({
    browser,
    signInAs,
  }) => {
    test.setTimeout(90_000);
    const session = await setUpSharedBoardSession(browser, signInAs);
    const { aliceContext, bobContext, alicePage, bobPage } = session;

    try {
      await createNote(alicePage);
      const aliceEditor = noteEditor(alicePage);
      await aliceEditor.click();
      await aliceEditor.pressSequentially("Start");

      await expect(noteListEntry(bobPage, "Start")).toBeVisible({
        timeout: REALTIME_TIMEOUT_MS,
      });
      await noteListEntry(bobPage, "Start").click();
      const bobEditor = noteEditor(bobPage);
      await expect(bobEditor).toContainText("Start", {
        timeout: REALTIME_TIMEOUT_MS,
      });

      // Both go offline and edit. This is the case last-write-wins cannot
      // handle and the reason this feature uses a CRDT at all: the durable
      // append is a resumable TanStack mutation that pauses offline and
      // replays on reconnect (see use-note-doc.ts).
      await aliceContext.setOffline(true);
      await bobContext.setOffline(true);

      await aliceEditor.click();
      await aliceEditor.press("End");
      await aliceEditor.pressSequentially(" A-Zusatz");

      await bobEditor.click();
      await bobEditor.press("End");
      await bobEditor.pressSequentially(" B-Zusatz");

      await aliceContext.setOffline(false);
      await bobContext.setOffline(false);

      // Neither edit is lost, on either side.
      await expect(aliceEditor).toContainText("A-Zusatz", {
        timeout: OFFLINE_MERGE_TIMEOUT_MS,
      });
      await expect(aliceEditor).toContainText("B-Zusatz", {
        timeout: OFFLINE_MERGE_TIMEOUT_MS,
      });
      await expect(bobEditor).toContainText("A-Zusatz", {
        timeout: OFFLINE_MERGE_TIMEOUT_MS,
      });
      await expect(bobEditor).toContainText("B-Zusatz", {
        timeout: OFFLINE_MERGE_TIMEOUT_MS,
      });
    } finally {
      await session.cleanup();
    }
  });

  test("realtime: a note one member creates or renames appears for the other", async ({
    browser,
    signInAs,
  }) => {
    const session = await setUpSharedBoardSession(browser, signInAs);
    const { alicePage, bobPage } = session;

    try {
      // Creation: Bob's list gains the new (untitled) note without a reload.
      // `public.notes` must be in the realtime publication for this to fire —
      // the bug this journey guards against.
      await createNote(alicePage);
      await expect(bobPage.getByText("Unbenannte Notiz")).toBeVisible({
        timeout: REALTIME_TIMEOUT_MS,
      });

      // Rename: typing a new first line updates the derived title, and that
      // update also propagates to Bob's list without a reload.
      const aliceEditor = noteEditor(alicePage);
      await aliceEditor.click();
      await aliceEditor.pressSequentially("Team-Retro");

      await expect(noteListEntry(bobPage, "Team-Retro")).toBeVisible({
        timeout: REALTIME_TIMEOUT_MS,
      });
    } finally {
      await session.cleanup();
    }
  });
});
