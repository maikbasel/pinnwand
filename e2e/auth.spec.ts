import { expect } from "@playwright/test";
import { test } from "./fixtures";
import { adminClient, createAuthenticatedUser } from "./helpers/direct-auth";
import { extractOtpCode, waitForEmail } from "./helpers/mailpit";

// Mirrors the `e2e-` sweep in global-teardown.ts so a failed run still gets
// cleaned up by the next one, on top of the explicit `finally` cleanup below.
const OTP_TEST_EMAIL_PREFIX = "e2e-otp-";

const SIGN_IN_URL_PATTERN = /\/sign-in/;
const APP_ROOT_URL_PATTERN = /\/$/;

test("redirects an anonymous visitor to sign-in", async ({
  page,
  signInPage,
}) => {
  await page.goto("/boards/some-board-id");
  await expect(page).toHaveURL(SIGN_IN_URL_PATTERN);
  await expect(signInPage.heading).toBeVisible();
  await expect(signInPage.emailInput).toBeVisible();
});

test("an authenticated user reaches the app and can sign out", async ({
  page,
  boardsPage,
}) => {
  const user = await createAuthenticatedUser(page);
  await expect(page).toHaveURL(APP_ROOT_URL_PATTERN);
  await expect(boardsPage.heading).toBeVisible();

  await boardsPage.signOutButton.click();

  await expect(page).toHaveURL(SIGN_IN_URL_PATTERN);
  await user.cleanup();
});

test("signs in with the real 6-digit OTP delivered by email", async ({
  page,
  signInPage,
}) => {
  const email = `${OTP_TEST_EMAIL_PREFIX}${Date.now()}@example.com`;
  const { data, error } = await adminClient.auth.admin.createUser({
    email,
    email_confirm: true,
  });
  if (error || !data.user) {
    throw new Error(
      `admin.createUser failed for ${email}: ${error?.message ?? "no user returned"}`
    );
  }
  const userId = data.user.id;

  try {
    await signInPage.goto();
    await signInPage.submit(email);
    await expect(signInPage.otpHeading).toBeVisible();

    const mail = await waitForEmail(email);
    const code = extractOtpCode(mail.html, mail.text);
    await signInPage.fillOtp(code);

    await expect(page).toHaveURL(APP_ROOT_URL_PATTERN);
  } finally {
    await adminClient.auth.admin.deleteUser(userId);
  }
});
