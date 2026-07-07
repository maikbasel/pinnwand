import { test as base } from "@playwright/test";
import { BoardsPage } from "./pages/boards.page";
import { SignInPage } from "./pages/sign-in.page";

type AppFixtures = {
  boardsPage: BoardsPage;
  signInPage: SignInPage;
};

export const test = base.extend<AppFixtures>({
  boardsPage: async ({ page }, use) => {
    await use(new BoardsPage(page));
  },
  signInPage: async ({ page }, use) => {
    await use(new SignInPage(page));
  },
});
