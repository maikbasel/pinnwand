import { useMutation } from "@tanstack/react-query";
import { type VerifyEmailOtpInput, verifyEmailOtp } from "../api/auth";

export function useVerifyOtp() {
  return useMutation<void, Error, VerifyEmailOtpInput>({
    mutationFn: verifyEmailOtp,
    // OTP failures render inline below the code cells; suppress the global
    // toast to avoid doubling up.
    meta: { op: "signIn.verifyOtp", suppressToast: true },
  });
}
