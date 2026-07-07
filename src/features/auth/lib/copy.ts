// German UI copy for the auth surface. No em dashes.
export const SIGN_IN_HEADING = "Anmelden";
export const SIGN_IN_SUBHEAD = "Melde dich mit deiner E-Mail an.";
export const EMAIL_LABEL = "E-Mail";
export const EMAIL_PLACEHOLDER = "du@beispiel.de";
export const CTA_SEND_CODE = "Anmeldelink senden";
export const CTA_SENDING = "Wird gesendet …";
export const OTP_HEADING = "Code eingeben";
export const OTP_SENT_NEUTRAL =
  "Falls ein Konto mit dieser Adresse existiert, ist ein Code unterwegs. Klicke den Link in der E-Mail oder gib den 6-stelligen Code ein.";
export const CTA_VERIFY = "Anmelden";
export const CTA_VERIFYING = "Wird geprüft …";
export const CTA_USE_OTHER_EMAIL = "Andere E-Mail verwenden";
export const CTA_RESEND = "Code erneut senden";
export function resendCountdownLabel(seconds: number): string {
  return `Erneut senden in ${seconds}s`;
}
export const ERROR_RATE_LIMIT =
  "Zu viele Versuche. Warte einen Moment und versuche es erneut.";
export const ERROR_TRANSPORT =
  "Verbindung fehlgeschlagen. Prüfe dein Netz und versuche es erneut.";
export const ERROR_OTP_INVALID =
  "Der Code ist ungültig oder abgelaufen. Fordere einen neuen an.";
export const CALLBACK_HEADING = "Anmeldung läuft …";
export const CALLBACK_BODY = "Einen Moment, wir bestätigen deinen Link.";
export const CALLBACK_ERROR_HEADING = "Anmeldung fehlgeschlagen";
export const CALLBACK_ERROR_TIMEOUT =
  "Das dauert länger als gewohnt. Der Link ist womöglich abgelaufen oder wurde auf einem anderen Gerät angefragt. Gib stattdessen den Code aus der E-Mail auf der Anmeldeseite ein.";
export const BACK_TO_SIGN_IN = "Zurück zur Anmeldung";
export const SIGN_OUT = "Abmelden";
