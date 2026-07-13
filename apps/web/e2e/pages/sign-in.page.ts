import type { Locator, Page } from "@playwright/test";

const EMAIL_LABEL_PATTERN = /e-mail/i;
const SUBMIT_BUTTON_PATTERN = /anmeldelink senden|wird gesendet/i;
// Self-serve signup is a load-bearing OFF decision: the sign-in surface must
// carry no signup affordance. Specs assert `signupAffordance` is hidden.
const SIGNUP_FORBIDDEN_PATTERN =
  /konto erstellen|noch kein konto|registrieren|sign[\s-]*up/i;
const SIGN_IN_HEADING_PATTERN = /^anmelden$/i;
const OTP_HEADING_PATTERN = /^code eingeben$/i;

// The passwordless sign-in surface (magic link + 6-digit OTP). The real UI
// lands with the `auth` feature slice; this POM defines the stable locators the
// auth specs drive against.
export class SignInPage {
  readonly page: Page;
  readonly heading: Locator;
  readonly emailInput: Locator;
  readonly submitButton: Locator;
  readonly errorRegion: Locator;
  readonly signupAffordance: Locator;
  readonly otpHeading: Locator;

  constructor(page: Page) {
    this.page = page;
    this.heading = page.getByRole("heading", {
      name: SIGN_IN_HEADING_PATTERN,
    });
    this.emailInput = page.getByLabel(EMAIL_LABEL_PATTERN).first();
    this.submitButton = page.getByRole("button", {
      name: SUBMIT_BUTTON_PATTERN,
    });
    this.errorRegion = page.getByRole("alert");
    this.signupAffordance = page.getByText(SIGNUP_FORBIDDEN_PATTERN);
    this.otpHeading = page.getByRole("heading", { name: OTP_HEADING_PATTERN });
  }

  async goto(search?: { redirect?: string }): Promise<void> {
    const query = search?.redirect
      ? `?redirect=${encodeURIComponent(search.redirect)}`
      : "";
    await this.page.goto(`/sign-in${query}`);
  }

  async submit(email: string): Promise<void> {
    await this.emailInput.fill(email);
    await this.submitButton.click();
  }

  // input-otp renders one real <input> per OTP form (maxLength=6, digits-only);
  // typing N characters distributes them across cells.
  async fillOtp(token: string, index = 0): Promise<void> {
    const otpInput = this.page.locator("[data-input-otp]").nth(index);
    await otpInput.focus();
    await this.page.keyboard.type(token);
  }
}
