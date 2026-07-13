import { z } from "zod";

const EnvSchema = z.object({
  SUPABASE_URL: z.url(),
  SUPABASE_ANON_KEY: z.string().min(1),
  // Auth server that issues the user JWTs (GoTrue). Defaults to SUPABASE_URL + /auth/v1.
  SUPABASE_AUTH_URL: z.url().optional(),
  // Public URL of THIS mcp server; used in protected-resource metadata.
  MCP_PUBLIC_URL: z.url(),
  // Shared HS256 signing secret for self-hosted GoTrue (GOTRUE_JWT_SECRET).
  // NOT the service role key. Optional: unset on Supabase Cloud, which signs
  // with asymmetric ES256/RS256 and publishes a populated JWKS instead.
  SUPABASE_JWT_SECRET: z.string().min(1).optional(),
  PORT: z.coerce.number().int().positive().default(8787),
  LOG_LEVEL: z
    .enum(["fatal", "error", "warn", "info", "debug", "trace"])
    .default("info"),
});

export type Env = z.infer<typeof EnvSchema>;
export function parseEnv(
  source: NodeJS.ProcessEnv | Record<string, unknown>
): Env {
  return EnvSchema.parse(source);
}
export const env = parseEnv(process.env);
