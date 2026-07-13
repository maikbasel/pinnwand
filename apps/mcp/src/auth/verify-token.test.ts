import {
  createLocalJWKSet,
  exportJWK,
  generateKeyPair,
  type JWK,
  SignJWT,
} from "jose";
import { describe, expect, it } from "vitest";
import { makeComposedResolver, makeVerifier } from "./verify-token";

const KEY_ID = "test";
const ALG = "ES256";

async function buildVerifier() {
  const { publicKey, privateKey } = await generateKeyPair(ALG, {
    extractable: true,
  });
  const jwk: JWK = await exportJWK(publicKey);
  jwk.alg = ALG;
  jwk.kid = KEY_ID;
  const getKey = createLocalJWKSet({ keys: [jwk] });
  const verifyToken = makeVerifier(getKey);
  const sign = (payload: Record<string, unknown>) =>
    new SignJWT(payload)
      .setProtectedHeader({ alg: ALG, kid: KEY_ID })
      .setIssuedAt()
      .setExpirationTime("1h")
      .sign(privateKey);
  return { verifyToken, sign, getKey };
}

describe("verifyToken", () => {
  it("rejects a missing header", async () => {
    const { verifyToken } = await buildVerifier();
    await expect(verifyToken(undefined)).rejects.toThrow();
  });

  it("rejects a malformed header", async () => {
    const { verifyToken } = await buildVerifier();
    await expect(verifyToken("not-a-bearer-token")).rejects.toThrow();
  });

  it("resolves the userId from a valid token", async () => {
    const { verifyToken, sign } = await buildVerifier();
    const token = await sign({ sub: "user-a" });
    await expect(verifyToken(`Bearer ${token}`)).resolves.toMatchObject({
      userId: "user-a",
    });
  });

  it("rejects a token with no sub", async () => {
    const { verifyToken, sign } = await buildVerifier();
    const token = await sign({});
    await expect(verifyToken(`Bearer ${token}`)).rejects.toThrow();
  });

  it("rejects a token signed by a different key", async () => {
    const { verifyToken } = await buildVerifier();
    const otherKeyPair = await generateKeyPair(ALG, { extractable: true });
    const tamperedToken = await new SignJWT({ sub: "user-a" })
      .setProtectedHeader({ alg: ALG, kid: KEY_ID })
      .setIssuedAt()
      .setExpirationTime("1h")
      .sign(otherKeyPair.privateKey);
    await expect(verifyToken(`Bearer ${tamperedToken}`)).rejects.toThrow();
  });
});

describe("verifyToken (HS256, GoTrue shared secret)", () => {
  const SECRET = "test-gotrue-jwt-secret";

  function signHs256(payload: Record<string, unknown>, secret: string) {
    return new SignJWT(payload)
      .setProtectedHeader({ alg: "HS256" })
      .setIssuedAt()
      .setExpirationTime("1h")
      .sign(new TextEncoder().encode(secret));
  }

  it("resolves the userId from a valid HS256 token via the composed resolver", async () => {
    const { getKey } = await buildVerifier();
    const resolver = makeComposedResolver(
      getKey,
      new TextEncoder().encode(SECRET)
    );
    const verifyToken = makeVerifier(resolver);
    const token = await signHs256({ sub: "user-a" }, SECRET);
    await expect(verifyToken(`Bearer ${token}`)).resolves.toMatchObject({
      userId: "user-a",
    });
  });

  it("rejects an HS256 token signed with the wrong secret", async () => {
    const { getKey } = await buildVerifier();
    const resolver = makeComposedResolver(
      getKey,
      new TextEncoder().encode(SECRET)
    );
    const verifyToken = makeVerifier(resolver);
    const token = await signHs256({ sub: "user-a" }, "wrong-secret");
    await expect(verifyToken(`Bearer ${token}`)).rejects.toThrow();
  });

  it("rejects an HS256 token when no shared secret is configured", async () => {
    const { getKey } = await buildVerifier();
    const resolver = makeComposedResolver(getKey, undefined);
    const verifyToken = makeVerifier(resolver);
    const token = await signHs256({ sub: "user-a" }, SECRET);
    await expect(verifyToken(`Bearer ${token}`)).rejects.toThrow(
      "no shared secret configured"
    );
  });

  it("still resolves asymmetric (ES256) tokens through the composed resolver", async () => {
    const { getKey, sign } = await buildVerifier();
    const resolver = makeComposedResolver(
      getKey,
      new TextEncoder().encode(SECRET)
    );
    const verifyToken = makeVerifier(resolver);
    const token = await sign({ sub: "user-a" });
    await expect(verifyToken(`Bearer ${token}`)).resolves.toMatchObject({
      userId: "user-a",
    });
  });
});
