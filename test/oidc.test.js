import { beforeAll, beforeEach, expect, test, vi } from "vitest";
import { clearJwksCache, verifyActionsToken } from "../src/releases/oidc.js";

const NOW = Date.parse("2026-11-25T12:00:00Z");
const NOW_S = NOW / 1000;
/** @type {CryptoKeyPair} */
let keys;
/** @type {CryptoKeyPair} */
let otherKeys;
/** @type {{ kid: string, kty: string, n: string, e: string }} */
let jwk;

/** @param {Uint8Array | string} value */
const b64url = value =>
  btoa(String.fromCharCode(...(typeof value === "string" ? new TextEncoder().encode(value) : value)))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");

const generate = () =>
  /** @type {Promise<CryptoKeyPair>} */ (
    crypto.subtle.generateKey(
      { name: "RSASSA-PKCS1-v1_5", modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: "SHA-256" },
      true,
      ["sign", "verify"],
    )
  );

beforeAll(async () => {
  keys = await generate();
  otherKeys = await generate();
  const exported = /** @type {JsonWebKey} */ (await crypto.subtle.exportKey("jwk", keys.publicKey));
  jwk = { kid: "key-1", kty: "RSA", n: String(exported.n), e: String(exported.e) };
});

beforeEach(() => clearJwksCache());

const CLAIMS = {
  iss: "https://token.actions.githubusercontent.com",
  aud: "engage",
  exp: NOW_S + 300,
  nbf: NOW_S - 10,
  repository: "oneloneraven/climbing-logbook",
  workflow_ref: "oneloneraven/climbing-logbook/.github/workflows/deploy.yml@refs/tags/v1.14.0",
  ref: "refs/tags/v1.14.0",
  sha: "abc123",
  environment: "production",
  run_id: "4242",
  run_attempt: "1",
};

/** @param {{ claims?: Record<string, unknown>, header?: Record<string, unknown>, signer?: CryptoKey }} [options] */
async function sign({ claims = {}, header = {}, signer = keys.privateKey } = {}) {
  const head = b64url(JSON.stringify({ alg: "RS256", typ: "JWT", kid: "key-1", ...header }));
  const body = b64url(JSON.stringify({ ...CLAIMS, ...claims }));
  const signature = new Uint8Array(
    await crypto.subtle.sign("RSASSA-PKCS1-v1_5", signer, new TextEncoder().encode(`${head}.${body}`)),
  );
  return `${head}.${body}.${b64url(signature)}`;
}

const options = (fetchJwks = vi.fn(async () => ({ keys: [jwk] }))) => ({ audience: "engage", now: NOW, fetchJwks });

test("a good token returns its claims", async () => {
  const claims = await verifyActionsToken(await sign(), options());
  expect(claims).toEqual({
    repository: "oneloneraven/climbing-logbook",
    workflow_ref: CLAIMS.workflow_ref,
    ref: "refs/tags/v1.14.0",
    sha: "abc123",
    environment: "production",
    run_id: "4242",
    run_attempt: "1",
  });
});

test.each([
  ["a bad signature", { signer: "other" }, "signature"],
  ["another algorithm", { header: { alg: "HS256" } }, "algorithm"],
  ["the wrong issuer", { claims: { iss: "https://evil.example" } }, "issuer"],
  ["the wrong audience", { claims: { aud: "someone-else" } }, "audience"],
  ["an expired token", { claims: { exp: NOW_S - 61 } }, "expired"],
  ["a token not yet valid", { claims: { nbf: NOW_S + 61 } }, "not-yet-valid"],
  ["an unknown key", { header: { kid: "key-2" } }, "unknown-key"],
  ["a missing environment", { claims: { environment: undefined } }, "missing-environment"],
])("%s is refused", async (_name, { signer, ...rest }, reason) => {
  const token = await sign({ ...rest, ...(signer === "other" && { signer: otherKeys.privateKey }) });
  await expect(verifyActionsToken(token, options())).rejects.toMatchObject({ message: "oidc-invalid", reason });
});

test("expiry has 60 seconds of leeway", async () => {
  await expect(verifyActionsToken(await sign({ claims: { exp: NOW_S - 59 } }), options())).resolves.toBeTruthy();
});

test("garbage is refused as malformed", async () => {
  for (const token of ["", "a.b", "not.base64!.at-all"])
    await expect(verifyActionsToken(token, options())).rejects.toMatchObject({ message: "oidc-invalid" });
});

test("keys are cached, and an unknown key refreshes them once", async () => {
  const fetchJwks = vi.fn(async () => ({ keys: [jwk] }));
  await verifyActionsToken(await sign(), options(fetchJwks));
  await verifyActionsToken(await sign(), options(fetchJwks));
  expect(fetchJwks).toHaveBeenCalledTimes(1);
  await expect(verifyActionsToken(await sign({ header: { kid: "key-2" } }), options(fetchJwks))).rejects.toThrow();
  expect(fetchJwks).toHaveBeenCalledTimes(2);
});
