import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { adminIdentity, clearAccessKeyCache, verifyAccessJwt } from "../../src/lib/access.js";

const TEAM = "oneloneraven.cloudflareaccess.com";
const AUD = "test-audience";
const NOW = 1_800_000_000;

/** @type {CryptoKeyPair} */
let keys;
/** @type {JsonWebKey} */
let publicJwk;

/** @param {object} value */
const b64url = value =>
  btoa(String.fromCharCode(...new TextEncoder().encode(JSON.stringify(value))))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");

/**
 * @param {object} [claims]
 * @param {string} [kid]
 */
async function sign(claims = {}, kid = "k1") {
  const header = b64url({ alg: "RS256", kid });
  const payload = b64url({
    aud: [AUD],
    iss: `https://${TEAM}`,
    exp: NOW + 300,
    email: "owner@example.test",
    ...claims,
  });
  const signature = new Uint8Array(
    await crypto.subtle.sign("RSASSA-PKCS1-v1_5", keys.privateKey, new TextEncoder().encode(`${header}.${payload}`)),
  );
  const sig = btoa(String.fromCharCode(...signature))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
  return `${header}.${payload}.${sig}`;
}

const certs = () => vi.fn(async () => Response.json({ keys: [{ ...publicJwk, kid: "k1", alg: "RS256", use: "sig" }] }));

beforeAll(async () => {
  keys = /** @type {CryptoKeyPair} */ (
    await crypto.subtle.generateKey(
      { name: "RSASSA-PKCS1-v1_5", modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: "SHA-256" },
      true,
      ["sign", "verify"],
    )
  );
  publicJwk = /** @type {JsonWebKey} */ (await crypto.subtle.exportKey("jwk", keys.publicKey));
});

beforeEach(clearAccessKeyCache);

describe("verifyAccessJwt", () => {
  const verify = async (/** @type {string} */ token, fetchImpl = certs()) =>
    verifyAccessJwt(token, { teamDomain: TEAM, aud: AUD, fetchImpl, nowS: NOW });

  it("returns the email for a valid token", async () => {
    expect(await verify(await sign())).toEqual({ email: "owner@example.test" });
  });

  it("refuses the wrong audience", async () => {
    expect(await verify(await sign({ aud: ["someone-else"] }))).toBeNull();
  });

  it("refuses the wrong issuer", async () => {
    expect(await verify(await sign({ iss: "https://evil.cloudflareaccess.com" }))).toBeNull();
  });

  it("refuses a token expired by 61 seconds", async () => {
    expect(await verify(await sign({ exp: NOW - 61 }))).toBeNull();
  });

  it("refuses a token with no email", async () => {
    expect(await verify(await sign({ email: undefined }))).toBeNull();
  });

  it("refuses a tampered payload", async () => {
    const [header, , signature] = (await sign()).split(".");
    const forged = b64url({ aud: [AUD], iss: `https://${TEAM}`, exp: NOW + 300, email: "attacker@example.test" });
    expect(await verify(`${header}.${forged}.${signature}`)).toBeNull();
  });

  it("refetches the keys once for an unknown kid, then refuses", async () => {
    const fetchImpl = certs();
    await verify(await sign(), fetchImpl);
    expect(await verify(await sign({}, "k2"), fetchImpl)).toBeNull();
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });
});

describe("adminIdentity", () => {
  const request = (/** @type {string} */ token) =>
    new Request("https://engage.oneloneraven.com/", { headers: { "Cf-Access-Jwt-Assertion": token } });

  it("refuses everything when the audience isn't configured, even a valid token", async () => {
    const env = { APP_ENV: "production", ACCESS_TEAM_DOMAIN: TEAM, ACCESS_AUD: "" };
    expect(await adminIdentity(request(await sign()), env, { fetchImpl: certs(), nowS: NOW })).toBeNull();
  });

  const owned = { APP_ENV: "production", ACCESS_TEAM_DOMAIN: TEAM, ACCESS_AUD: AUD, OWNER_EMAIL: "Owner@Example.test" };

  it("accepts a valid token for the owner, matching the email case-insensitively", async () => {
    expect(await adminIdentity(request(await sign()), owned, { fetchImpl: certs(), nowS: NOW })).toEqual({
      email: "owner@example.test",
    });
  });

  it("refuses a valid token for anyone other than the owner", async () => {
    const token = await sign({ email: "someone@example.test" });
    expect(await adminIdentity(request(token), owned, { fetchImpl: certs(), nowS: NOW })).toBeNull();
  });

  it("refuses even the owner when the owner email isn't configured", async () => {
    const env = { ...owned, OWNER_EMAIL: "" };
    expect(await adminIdentity(request(await sign()), env, { fetchImpl: certs(), nowS: NOW })).toBeNull();
  });

  it("refuses a request with no token", async () => {
    const env = { APP_ENV: "production", ACCESS_TEAM_DOMAIN: TEAM, ACCESS_AUD: AUD };
    expect(await adminIdentity(new Request("https://engage.oneloneraven.com/"), env)).toBeNull();
  });

  it("only skips the check in e2e and local development", async () => {
    const off = { ADMIN_ACCESS_CHECK: "off", ACCESS_TEAM_DOMAIN: "", ACCESS_AUD: "" };
    const bare = new Request("https://localhost/");
    expect(await adminIdentity(bare, { ...off, APP_ENV: "e2e" })).toEqual({ email: "dev@localhost" });
    expect(await adminIdentity(bare, { ...off, APP_ENV: "development" })).toEqual({ email: "dev@localhost" });
    expect(await adminIdentity(bare, { ...off, APP_ENV: "production" })).toBeNull();
    expect(await adminIdentity(bare, { ...off, APP_ENV: "preview" })).toBeNull();
  });
});
