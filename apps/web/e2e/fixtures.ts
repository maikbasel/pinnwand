import type { Page } from "@playwright/test";
import { test as base } from "@playwright/test";
import {
  type AuthenticatedUser,
  createAuthenticatedUser,
} from "./helpers/direct-auth";
import { AppShellPage } from "./pages/app-shell.page";
import { BoardDetailPage } from "./pages/board-detail.page";
import { BoardsPage } from "./pages/boards.page";
import { JoinBoardPage } from "./pages/join-board.page";
import { SignInPage } from "./pages/sign-in.page";

// Signs a specific page/context in as a fresh admin-provisioned user carrying
// the given display name. Needed (rather than the single implicit `page`) by
// any spec driving more than one browser context at once — e.g. two members
// converging on one note. The caller still owns cleanup via the returned
// `AuthenticatedUser`, matching every other multi-user spec.
export type SignInAs = (
  page: Page,
  displayName: string
) => Promise<AuthenticatedUser>;

type AppFixtures = {
  appShellPage: AppShellPage;
  boardsPage: BoardsPage;
  boardDetailPage: BoardDetailPage;
  joinBoardPage: JoinBoardPage;
  signInPage: SignInPage;
  signInAs: SignInAs;
};

export const test = base.extend<AppFixtures>({
  appShellPage: async ({ page }, use) => {
    await use(new AppShellPage(page));
  },
  boardsPage: async ({ page }, use) => {
    await use(new BoardsPage(page));
  },
  boardDetailPage: async ({ page }, use) => {
    await use(new BoardDetailPage(page));
  },
  joinBoardPage: async ({ page }, use) => {
    await use(new JoinBoardPage(page));
  },
  signInPage: async ({ page }, use) => {
    await use(new SignInPage(page));
  },
  // Playwright statically parses this destructuring pattern to discover which
  // fixtures the callback depends on, so the empty `{}` must stay literal even
  // though nothing is destructured from it.
  // biome-ignore lint/correctness/noEmptyPattern: required by Playwright's fixture dependency parser
  signInAs: async ({}, use) => {
    await use((page, displayName) =>
      createAuthenticatedUser(page, { displayName })
    );
  },
});
