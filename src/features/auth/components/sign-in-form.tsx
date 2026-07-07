import { useNavigate } from "@tanstack/react-router";
import { REGEXP_ONLY_DIGITS } from "input-otp";
import { type FormEvent, useEffect, useState } from "react";
import { Button } from "@/shared/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
} from "@/shared/components/ui/card";
import { Input } from "@/shared/components/ui/input";
import {
  InputOTP,
  InputOTPGroup,
  InputOTPSlot,
} from "@/shared/components/ui/input-otp";
import { Label } from "@/shared/components/ui/label";
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
      <Card className="w-full max-w-sm">
        <CardHeader className="text-center">
          <h1 className="font-semibold text-2xl tracking-tight">
            {OTP_HEADING}
          </h1>
          <CardDescription>{OTP_SENT_NEUTRAL}</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
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
          <div className="flex flex-col gap-1">
            <Button
              disabled={resendDisabled}
              onClick={() => send()}
              size="sm"
              type="button"
              variant="ghost"
            >
              {remainingSeconds > 0
                ? resendCountdownLabel(remainingSeconds)
                : CTA_RESEND}
            </Button>
            <Button
              onClick={() => {
                setStep("email");
                setCode("");
                setOtpError(null);
              }}
              size="sm"
              type="button"
              variant="link"
            >
              {CTA_USE_OTHER_EMAIL}
            </Button>
          </div>
          <span aria-hidden className="sr-only">
            {verify.isPending ? CTA_VERIFYING : CTA_VERIFY}
          </span>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="w-full max-w-sm">
      <CardHeader className="text-center">
        <h1 className="font-semibold text-2xl tracking-tight">
          {SIGN_IN_HEADING}
        </h1>
        <CardDescription>{SIGN_IN_SUBHEAD}</CardDescription>
      </CardHeader>
      <CardContent>
        <form className="flex flex-col gap-4" onSubmit={onEmailSubmit}>
          <div className="flex flex-col gap-2">
            <Label htmlFor="email">{EMAIL_LABEL}</Label>
            <Input
              autoComplete="email"
              id="email"
              onChange={(e) => setEmail(e.target.value)}
              placeholder={EMAIL_PLACEHOLDER}
              required
              type="email"
              value={email}
            />
          </div>
          {emailError ? (
            <p className="text-destructive text-sm" role="alert">
              {emailError}
            </p>
          ) : null}
          <Button className="w-full" disabled={signIn.isPending} type="submit">
            {signIn.isPending ? CTA_SENDING : CTA_SEND_CODE}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}
