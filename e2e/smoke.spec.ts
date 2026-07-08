import { expect } from "@playwright/test";
import { ACCOUNT_LABEL } from "@/features/navigation/lib/copy";
import { test } from "./fixtures";
import { createAuthenticatedUser } from "./helpers/direct-auth";

// Plumbing check: the containerized stack serves the SPA and it boots against
// the sealed backend (kong + migrated db). The boards route is guarded (see
// e2e/auth.spec.ts), so this needs an authenticated session to reach it. The
// account control renders in both shells (desktop rail + mobile top bar), so it
// is the viewport-agnostic proof the authenticated shell rendered.
test("boards landing renders the app shell", async ({ page }) => {
  const user = await createAuthenticatedUser(page);
  await expect(page.getByRole("button", { name: ACCOUNT_LABEL })).toBeVisible();
  await user.cleanup();
});
