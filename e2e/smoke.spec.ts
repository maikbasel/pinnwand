import { expect } from "@playwright/test";
import { test } from "./fixtures";
import { createAuthenticatedUser } from "./helpers/direct-auth";

// Plumbing check: the containerized stack serves the SPA and it boots against
// the sealed backend (kong + migrated db). The boards route is guarded (see
// e2e/auth.spec.ts), so this needs an authenticated session to reach it.
test("boards landing renders the app shell", async ({ page, boardsPage }) => {
  const user = await createAuthenticatedUser(page);
  await expect(boardsPage.heading).toBeVisible();
  await expect(boardsPage.newBoardButton).toBeVisible();
  await user.cleanup();
});
