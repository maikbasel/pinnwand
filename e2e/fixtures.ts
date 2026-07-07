import { test as base } from "@playwright/test";
import { BoardDetailPage } from "./pages/board-detail.page";
import { BoardsPage } from "./pages/boards.page";
import { JoinBoardPage } from "./pages/join-board.page";
import { SignInPage } from "./pages/sign-in.page";

type AppFixtures = {
  boardsPage: BoardsPage;
  boardDetailPage: BoardDetailPage;
  joinBoardPage: JoinBoardPage;
  signInPage: SignInPage;
};

export const test = base.extend<AppFixtures>({
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
});
