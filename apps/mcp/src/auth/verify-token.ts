import { createRemoteJWKSet, type JWTVerifyGetKey, jwtVerify } from "jose";
import { env } from "../env";

const BEARER_PREFIX = "Bearer ";

export class AuthError extends Error {}

export function makeVerifier(getKey: JWTVerifyGetKey) {
  return async function verifyToken(header: string | undefined) {
    if (!header?.startsWith(BEARER_PREFIX)) {
      throw new AuthError("Missing bearer token");
    }
    const token = header.slice(BEARER_PREFIX.length);
    try {
      const { payload } = await jwtVerify(token, getKey);
      if (!payload.sub) {
        throw new AuthError("Token has no subject");
      }
      return { userId: payload.sub, token };
    } catch (cause) {
      if (cause instanceof AuthError) {
        throw cause;
      }
      throw new AuthError("Invalid or expired token", { cause });
    }
  };
}

// Self-hosted GoTrue signs user JWTs with a symmetric HS256 secret and
// publishes an empty JWKS ({"keys":[]}); Supabase Cloud signs asymmetrically
// (ES256/RS256) and publishes a populated JWKS. Pick the key source by the
// token's own `alg` header so both deployments verify correctly.
export function makeComposedResolver(
  jwks: JWTVerifyGetKey,
  secret: Uint8Array | undefined
): JWTVerifyGetKey {
  return (protectedHeader, token) => {
    if (protectedHeader.alg?.startsWith("HS")) {
      if (!secret) {
        throw new AuthError("HS256 token but no shared secret configured");
      }
      return secret;
    }
    return jwks(protectedHeader, token);
  };
}

const jwksUrl = new URL(
  env.SUPABASE_AUTH_URL
    ? `${env.SUPABASE_AUTH_URL}/.well-known/jwks.json`
    : `${env.SUPABASE_URL}/auth/v1/.well-known/jwks.json`
);
const remoteJwks = createRemoteJWKSet(jwksUrl);
const secretKey = env.SUPABASE_JWT_SECRET
  ? new TextEncoder().encode(env.SUPABASE_JWT_SECRET)
  : undefined;
export const verifyToken = makeVerifier(
  makeComposedResolver(remoteJwks, secretKey)
);
