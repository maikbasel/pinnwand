import { useNavigate } from "@tanstack/react-router";
import { REGEXP_ONLY_DIGITS } from "input-otp";
import { type FormEvent, useEffect, useState } from "react";
import {
  InputOTP,
  InputOTPGroup,
  InputOTPSlot,
} from "@/shared/components/ui/input-otp";
import { useSignIn } from "../hooks/use-sign-in";
import { useVerifyOtp } from "../hooks/use-verify-otp";
import {
  classifyEmailSubmitError,
  classifyOtpError,
} from "../lib/classify-auth-error";
import {
  CTA_RESEND,
  CTA_SEND_CODE,
  CTA_SENDING,
  CTA_USE_OTHER_EMAIL,
  CTA_VERIFY,
  CTA_VERIFYING,
  EMAIL_LABEL,
  EMAIL_PLACEHOLDER,
  ERROR_OTP_INVALID,
  ERROR_RATE_LIMIT,
  ERROR_TRANSPORT,
  OTP_HEADING,
  OTP_SENT_NEUTRAL,
  resendCountdownLabel,
  SIGN_IN_HEADING,
  SIGN_IN_SUBHEAD,
} from "../lib/copy";

const OTP_LENGTH = 6;
const OTP_SLOT_POSITIONS = Array.from({ length: OTP_LENGTH }, (_, i) => i);
const RESEND_COOLDOWN_SECONDS = 60;
const RESEND_COOLDOWN_MS = RESEND_COOLDOWN_SECONDS * 1000;
const COUNTDOWN_TICK_MS = 1000;

type Step = "email" | "otp";

function callbackUrl(redirect: string): string {
  const target = encodeURIComponent(redirect);
  return `${window.location.origin}/auth/callback?redirect=${target}`;
}

export function SignInForm({ redirect }: { redirect: string }) {
  const [step, setStep] = useState<Step>("email");
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [emailError, setEmailError] = useState<string | null>(null);
  const [otpError, setOtpError] = useState<string | null>(null);
  const [cooldownUntil, setCooldownUntil] = useState(0);
  const [now, setNow] = useState(() => Date.now());

  const navigate = useNavigate();
  const signIn = useSignIn();
  const verify = useVerifyOtp();

  const startCooldown = () => {
    // Reset `now` alongside the deadline so the first rendered countdown reads
    // exactly RESEND_COOLDOWN_SECONDS, not one second more from a stale `now`.
    const t = Date.now();
    setNow(t);
    setCooldownUntil(t + RESEND_COOLDOWN_MS);
  };

  useEffect(() => {
    if (cooldownUntil === 0) {
      return;
    }
    const id = window.setInterval(() => {
      const t = Date.now();
      setNow(t);
      if (t >= cooldownUntil) {
        window.clearInterval(id);
      }
    }, COUNTDOWN_TICK_MS);
    return () => window.clearInterval(id);
  }, [cooldownUntil]);

  const remainingSeconds = Math.max(0, Math.ceil((cooldownUntil - now) / 1000));
  const resendDisabled =
    signIn.isPending || verify.isPending || remainingSeconds > 0;

  async function send(): Promise<void> {
    // On the OTP step this runs as a resend, so surface failures below the code
    // cells; on the email step, under the email field. The 422 anti-enumeration
    // path stays silent either way, so neither surface leaks whether the address
    // is enrolled.
    const showError = step === "otp" ? setOtpError : setEmailError;
    showError(null);
    try {
      await signIn.mutateAsync({ email, redirectTo: callbackUrl(redirect) });
      setStep("otp");
      startCooldown();
    } catch (error) {
      const kind = classifyEmailSubmitError(error);
      if (kind === "anti-enumeration") {
        // Never reveal that the address is unknown. Advance as if sent, and
        // run the cooldown so the resend cadence is indistinguishable from a
        // real send.
        startCooldown();
        setStep("otp");
        return;
      }
      if (kind === "rate-limit") {
        // The server is throttling; back off before allowing another attempt.
        startCooldown();
        showError(ERROR_RATE_LIMIT);
        return;
      }
      // Transport failure: nothing left the device, so don't lock resend. The
      // user can retry the moment connectivity returns.
      showError(ERROR_TRANSPORT);
    }
  }

  function onEmailSubmit(event: FormEvent): void {
    event.preventDefault();
    send();
  }

  async function onVerify(value: string): Promise<void> {
    setOtpError(null);
    try {
      await verify.mutateAsync({ email, token: value });
      await navigate({ to: redirect });
    } catch (error) {
      const kind = classifyOtpError(error);
      setCode("");
      if (kind === "rate-limit") {
        setOtpError(ERROR_RATE_LIMIT);
      } else if (kind === "invalid-or-expired") {
        setOtpError(ERROR_OTP_INVALID);
      } else {
        setOtpError(ERROR_TRANSPORT);
      }
    }
  }

  function onCodeChange(value: string): void {
    setCode(value);
    if (value.length === OTP_LENGTH && !verify.isPending) {
      onVerify(value);
    }
  }

  if (step === "otp") {
    return (
      <div className="flex w-full max-w-sm flex-col gap-4">
        <div className="text-center">
          <h1 className="font-semibold text-2xl tracking-tight">
            {OTP_HEADING}
          </h1>
          <p className="mt-2 text-muted-foreground text-sm">
            {OTP_SENT_NEUTRAL}
          </p>
        </div>
        <div className="flex justify-center">
          <InputOTP
            aria-label={OTP_HEADING}
            disabled={verify.isPending}
            maxLength={OTP_LENGTH}
            onChange={onCodeChange}
            pattern={REGEXP_ONLY_DIGITS}
            value={code}
          >
            <InputOTPGroup>
              {OTP_SLOT_POSITIONS.map((position) => (
                <InputOTPSlot index={position} key={position} />
              ))}
            </InputOTPGroup>
          </InputOTP>
        </div>
        {otpError ? (
          <p className="text-center text-destructive text-sm" role="alert">
            {otpError}
          </p>
        ) : null}
        <button
          className="text-muted-foreground text-sm underline-offset-4 hover:underline disabled:opacity-60"
          disabled={resendDisabled}
          onClick={() => send()}
          type="button"
        >
          {remainingSeconds > 0
            ? resendCountdownLabel(remainingSeconds)
            : CTA_RESEND}
        </button>
        <button
          className="text-muted-foreground text-sm underline-offset-4 hover:underline"
          onClick={() => {
            setStep("email");
            setCode("");
            setOtpError(null);
          }}
          type="button"
        >
          {CTA_USE_OTHER_EMAIL}
        </button>
        <span aria-hidden className="sr-only">
          {verify.isPending ? CTA_VERIFYING : CTA_VERIFY}
        </span>
      </div>
    );
  }

  return (
    <div className="flex w-full max-w-sm flex-col gap-4">
      <div className="text-center">
        <h1 className="font-semibold text-2xl tracking-tight">
          {SIGN_IN_HEADING}
        </h1>
        <p className="mt-1 text-muted-foreground text-sm">{SIGN_IN_SUBHEAD}</p>
      </div>
      <form className="flex flex-col gap-3" onSubmit={onEmailSubmit}>
        <label className="flex flex-col gap-1 text-sm" htmlFor="email">
          <span className="text-muted-foreground">{EMAIL_LABEL}</span>
          <input
            autoComplete="email"
            className="rounded-md border bg-background px-3 py-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
            id="email"
            onChange={(e) => setEmail(e.target.value)}
            placeholder={EMAIL_PLACEHOLDER}
            required
            type="email"
            value={email}
          />
        </label>
        {emailError ? (
          <p className="text-destructive text-sm" role="alert">
            {emailError}
          </p>
        ) : null}
        <button
          className="rounded-md bg-primary px-4 py-2 font-medium text-primary-foreground text-sm disabled:opacity-60"
          disabled={signIn.isPending}
          type="submit"
        >
          {signIn.isPending ? CTA_SENDING : CTA_SEND_CODE}
        </button>
      </form>
    </div>
  );
}
