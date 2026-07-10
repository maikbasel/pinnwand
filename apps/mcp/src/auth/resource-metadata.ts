import { env } from "../env";

/** RFC 9728 OAuth 2.0 Protected Resource Metadata. */
export function resourceMetadata() {
  const authBase = env.SUPABASE_AUTH_URL ?? `${env.SUPABASE_URL}/auth/v1`;
  return {
    resource: env.MCP_PUBLIC_URL,
    authorization_servers: [authBase],
    bearer_methods_supported: ["header"],
  };
}
