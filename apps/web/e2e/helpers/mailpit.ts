const MAILPIT_URL = process.env.MAILPIT_URL ?? "http://localhost:8025";
const INITIAL_POLL_MS = 200;
const MAX_POLL_MS = 2000;
const JITTER_MS = 50;
const DEFAULT_TIMEOUT_MS = 15_000;

// Supabase magic-link emails embed the action link with `type=magiclink` and
// either `token=pkce_<hash>` (PKCE flow, default in v2.x) or `token_hash=<hash>`
// (older flows). Matching on `type=magiclink` is the disambiguator if the
// template ever adds a "Confirm your mail" footer link.
const MAGIC_LINK_PATTERN = /href="([^"]*type=magiclink[^"]*)"/;

type MailpitMessage = {
  ID: string;
  Subject: string;
  From: { Address: string; Name: string };
  To: { Address: string; Name: string }[];
};

type MailpitSearchResult = {
  messages: MailpitMessage[];
  total: number;
};

type MailpitMessageDetail = {
  ID: string;
  Subject: string;
  HTML: string;
  Text: string;
};

type MailpitMail = {
  subject: string;
  html: string;
  text: string;
};

async function searchMessages(email: string): Promise<MailpitMessage[]> {
  const res = await fetch(
    `${MAILPIT_URL}/api/v1/search?query=${encodeURIComponent(`to:${email}`)}`
  );
  if (!res.ok) {
    throw new Error(`Mailpit search failed: ${res.status}`);
  }
  const data = (await res.json()) as MailpitSearchResult;
  return data.messages ?? [];
}

async function getMessageDetail(
  messageId: string
): Promise<MailpitMessageDetail> {
  const res = await fetch(`${MAILPIT_URL}/api/v1/message/${messageId}`);
  if (!res.ok) {
    throw new Error(`Mailpit message fetch failed: ${res.status}`);
  }
  return (await res.json()) as MailpitMessageDetail;
}

export async function waitForEmail(
  email: string,
  { timeoutMs = DEFAULT_TIMEOUT_MS }: { timeoutMs?: number } = {}
): Promise<MailpitMail> {
  const start = Date.now();
  let interval = INITIAL_POLL_MS;

  while (Date.now() - start < timeoutMs) {
    const messages = await searchMessages(email);
    const latest = messages[0];
    if (latest) {
      const detail = await getMessageDetail(latest.ID);
      return {
        subject: detail.Subject,
        html: detail.HTML,
        text: detail.Text,
      };
    }
    const jitter = Math.random() * JITTER_MS * 2 - JITTER_MS;
    await new Promise((resolve) => setTimeout(resolve, interval + jitter));
    interval = Math.min(interval * 2, MAX_POLL_MS);
  }

  throw new Error(`No email received for ${email} within ${timeoutMs / 1000}s`);
}

export function extractMagicLink(html: string): string {
  const match = html.match(MAGIC_LINK_PATTERN);
  const link = match?.[1];
  if (!link) {
    throw new Error("No magic link found in email body");
  }
  // Mailpit returns HTML-escaped attribute content. Decode every entity, not
  // just &amp;; if the GoTrue template ever emits &#x2F; or another entity the
  // regex-only path would silently produce a broken URL.
  return decodeHtmlEntities(link);
}

// GoTrue v2.189.0's default magic-link template ends with "Alternatively, enter
// the code: 123456", a single 6-digit run in the body. Matching the digit run
// directly is robust to template-copy wording changes (the digit count is the
// contract, not the prose).
const OTP_CODE_PATTERN = /\b(\d{6})\b/;

export function extractOtpCode(html: string, text?: string): string {
  // Search HTML first (the rendered template), fall back to plaintext.
  const haystacks = [html, text ?? ""].filter(Boolean);
  for (const haystack of haystacks) {
    const match = haystack.match(OTP_CODE_PATTERN);
    if (match?.[1]) {
      return match[1];
    }
  }
  throw new Error("No 6-digit OTP code found in email body");
}

// Zero-dep Node-side entity decode (Playwright's Node runtime has no
// DOMParser). Covers named entities + numeric (decimal + hex) entities.
const HTML_ENTITY_PATTERN = /&(#x?[0-9a-fA-F]+|amp|lt|gt|quot|apos);/g;
const NAMED_ENTITIES: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
};

function decodeNumericEntity(entity: string): string | null {
  const isHex = entity.startsWith("#x") || entity.startsWith("#X");
  const digits = isHex ? entity.slice(2) : entity.slice(1);
  const code = Number.parseInt(digits, isHex ? 16 : 10);
  return Number.isFinite(code) ? String.fromCodePoint(code) : null;
}

function decodeHtmlEntities(input: string): string {
  return input.replace(HTML_ENTITY_PATTERN, (match, entity: string) => {
    const named = NAMED_ENTITIES[entity];
    if (named !== undefined) {
      return named;
    }
    if (entity.startsWith("#")) {
      return decodeNumericEntity(entity) ?? match;
    }
    return match;
  });
}

export async function clearMailbox(email: string): Promise<void> {
  await fetch(
    `${MAILPIT_URL}/api/v1/search?query=${encodeURIComponent(`to:${email}`)}`,
    { method: "DELETE" }
  );
}
