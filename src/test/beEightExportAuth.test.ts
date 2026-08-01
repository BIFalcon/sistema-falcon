import { describe, it, expect, beforeEach } from "vitest";
import {
  authenticate,
  verifyJwt,
  verifyLegacyToken,
  checkRateLimit,
  rateLimitMax,
  __resetRateLimitForTests,
  EXPECTED_ISS,
  EXPECTED_AUD,
  DEFAULT_SUB,
  SCOPE_READ,
  SCOPE_SENSITIVE,
  sha256Hex,
} from "../../supabase/functions/be-eight-export/auth.ts";
import {
  classifyColumn,
  visibleColumns,
  blockedColumns,
  stripRow,
  TABLE_DENYLIST,
} from "../../supabase/functions/be-eight-export/catalog.ts";

type _Fail = { ok: false; status: number; errorCode: string; message: string; reason: string };
const asFail = (r: unknown) => r as _Fail;

// ---------------------------------------------------------------------------
// Helpers: real ES256 keypair + JWT signing (mirrors what Be Eight will do).
// ---------------------------------------------------------------------------

const b64url = (bytes: Uint8Array) =>
  btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const b64urlJson = (obj: unknown) =>
  b64url(new TextEncoder().encode(JSON.stringify(obj)));

let publicJwk: Record<string, unknown>;
let privateKey: CryptoKey;
let jwks: { keys: Record<string, unknown>[] };

async function setupKeys(kid = "be-eight-2026-07") {
  const pair = await crypto.subtle.generateKey(
    { name: "ECDSA", namedCurve: "P-256" },
    true,
    ["sign", "verify"],
  );
  privateKey = pair.privateKey;
  const jwk = await crypto.subtle.exportKey("jwk", pair.publicKey);
  publicJwk = { kty: "EC", crv: "P-256", x: jwk.x, y: jwk.y, kid, alg: "ES256", use: "sig" };
  jwks = { keys: [publicJwk] };
}

async function signJwt(
  claims: Record<string, unknown>,
  header: Record<string, unknown> = {},
): Promise<string> {
  const h = b64urlJson({ alg: "ES256", typ: "JWT", kid: publicJwk.kid, ...header });
  const p = b64urlJson(claims);
  const sig = new Uint8Array(
    await crypto.subtle.sign(
      { name: "ECDSA", hash: { name: "SHA-256" } },
      privateKey,
      new TextEncoder().encode(`${h}.${p}`),
    ),
  );
  return `${h}.${p}.${b64url(sig)}`;
}

function baseClaims(over: Record<string, unknown> = {}) {
  const now = Math.floor(Date.now() / 1000);
  return {
    iss: EXPECTED_ISS,
    aud: EXPECTED_AUD,
    sub: DEFAULT_SUB,
    iat: now,
    exp: now + 120,
    jti: crypto.randomUUID(),
    scope: SCOPE_READ,
    ...over,
  };
}

const envWith = (over: Record<string, string> = {}) => {
  const vars: Record<string, string> = {
    BE_EIGHT_EXPORT_JWKS_JSON: JSON.stringify(jwks),
    BE_EIGHT_EXPORT_TOKEN: "legacy-standard-token-value",
    BE_EIGHT_EXPORT_PRIVILEGED_TOKEN: "legacy-privileged-token-value",
    BE_EIGHT_EXPORT_ALLOW_LEGACY_TOKEN: "true",
    ...over,
  };
  return (k: string) => vars[k];
};

beforeEach(async () => {
  await setupKeys();
  __resetRateLimitForTests();
});

describe("be-eight-export auth", () => {
  it("1. no Authorization header -> 401", async () => {
    const r = await authenticate(null, envWith());
    expect(r.ok).toBe(false);
    if (!r.ok) expect(asFail(r).status).toBe(401);
  });

  it("2. invalid token -> 401", async () => {
    const r = await authenticate("Bearer totally-wrong", envWith());
    expect(r.ok).toBe(false);
    if (!r.ok) expect(asFail(r).status).toBe(401);
  });

  it("3. valid JWT with export:read -> allowed, standard scope", async () => {
    const r = await authenticate(`Bearer ${await signJwt(baseClaims())}`, envWith());
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.mode).toBe("jwt");
      expect(r.scope).toBe("standard");
      expect(r.sub).toBe(DEFAULT_SUB);
      expect(r.kid).toBe(publicJwk.kid);
    }
  });

  it("4. expired JWT -> 401", async () => {
    const now = Math.floor(Date.now() / 1000);
    const t = await signJwt(baseClaims({ iat: now - 600, exp: now - 300 }));
    const r = await authenticate(`Bearer ${t}`, envWith());
    expect(r.ok).toBe(false);
    if (!r.ok) expect([401]).toContain(asFail(r).status);
  });

  it("4b. JWT with TTL over 5 minutes -> 401", async () => {
    const now = Math.floor(Date.now() / 1000);
    const t = await signJwt(baseClaims({ iat: now, exp: now + 3600 }));
    const r = await authenticate(`Bearer ${t}`, envWith());
    expect(r.ok).toBe(false);
  });

  it("5. wrong iss -> 401", async () => {
    const r = await authenticate(`Bearer ${await signJwt(baseClaims({ iss: "someone-else" }))}`, envWith());
    expect(r.ok).toBe(false);
    if (!r.ok) expect(asFail(r).status).toBe(401);
  });

  it("6. wrong aud -> 401", async () => {
    const r = await authenticate(`Bearer ${await signJwt(baseClaims({ aud: "other-api" }))}`, envWith());
    expect(r.ok).toBe(false);
    if (!r.ok) expect(asFail(r).status).toBe(401);
  });

  it("7. unauthorized sub -> 403", async () => {
    const r = await authenticate(`Bearer ${await signJwt(baseClaims({ sub: "attacker" }))}`, envWith());
    expect(r.ok).toBe(false);
    if (!r.ok) expect(asFail(r).status).toBe(403);
  });

  it("7b. configured extra subject is accepted", async () => {
    const r = await authenticate(
      `Bearer ${await signJwt(baseClaims({ sub: "connectors-service-stg" }))}`,
      envWith({ BE_EIGHT_EXPORT_ALLOWED_SUBJECTS: "connectors-service-prd,connectors-service-stg" }),
    );
    expect(r.ok).toBe(true);
  });

  it("8. unknown kid -> 401", async () => {
    const r = await authenticate(`Bearer ${await signJwt(baseClaims(), { kid: "nope" })}`, envWith());
    expect(r.ok).toBe(false);
    if (!r.ok) expect(asFail(r).status).toBe(401);
  });

  it("9. non-ES256 alg (incl. alg=none) -> 401", async () => {
    for (const alg of ["none", "HS256", "RS256"]) {
      const h = b64urlJson({ alg, typ: "JWT", kid: publicJwk.kid });
      const p = b64urlJson(baseClaims());
      const r = await authenticate(`Bearer ${h}.${p}.`, envWith());
      expect(r.ok).toBe(false);
    }
  });

  it("9b. tampered payload -> 401 (signature check)", async () => {
    const t = await signJwt(baseClaims());
    const [h, , s] = t.split(".");
    const forged = `${h}.${b64urlJson(baseClaims({ scope: `${SCOPE_READ} ${SCOPE_SENSITIVE}` }))}.${s}`;
    const r = await authenticate(`Bearer ${forged}`, envWith());
    expect(r.ok).toBe(false);
  });

  it("10. jti is unique per token and hashed deterministically (replay key)", async () => {
    const c1 = baseClaims();
    const h1 = await sha256Hex(`${DEFAULT_SUB}:${c1.jti}`);
    const h2 = await sha256Hex(`${DEFAULT_SUB}:${c1.jti}`);
    const h3 = await sha256Hex(`${DEFAULT_SUB}:${baseClaims().jti}`);
    expect(h1).toBe(h2); // same jti -> same PK -> DB unique violation -> rejected
    expect(h1).not.toBe(h3);
    expect(h1).not.toContain(String(c1.jti));
  });

  it("10b. missing jti -> 401", async () => {
    const claims = baseClaims();
    delete (claims as Record<string, unknown>).jti;
    const r = await authenticate(`Bearer ${await signJwt(claims)}`, envWith());
    expect(r.ok).toBe(false);
  });

  it("11/12. export:sensitive controls privileged scope", async () => {
    const readOnly = await authenticate(`Bearer ${await signJwt(baseClaims())}`, envWith());
    expect(readOnly.ok && readOnly.scopes.includes(SCOPE_SENSITIVE)).toBe(false);
    const priv = await authenticate(
      `Bearer ${await signJwt(baseClaims({ scope: `${SCOPE_READ} ${SCOPE_SENSITIVE}` }))}`,
      envWith(),
    );
    expect(priv.ok).toBe(true);
    if (priv.ok) {
      expect(priv.scope).toBe("privileged");
      expect(priv.scopes).toContain(SCOPE_SENSITIVE);
    }
  });

  it("11b. JWT without export:read -> 403", async () => {
    const r = await authenticate(`Bearer ${await signJwt(baseClaims({ scope: "something:else" }))}`, envWith());
    expect(r.ok).toBe(false);
    if (!r.ok) expect(asFail(r).status).toBe(403);
  });

  it("13. legacy tokens still work while the flag is on", async () => {
    const std = verifyLegacyToken("legacy-standard-token-value", envWith());
    expect(std.ok).toBe(true);
    if (std.ok) expect(std.scope).toBe("standard");
    const priv = verifyLegacyToken("legacy-privileged-token-value", envWith());
    expect(priv.ok).toBe(true);
    if (priv.ok) expect(priv.scope).toBe("privileged");
  });

  it("13b. legacy tokens are routed through authenticate() unchanged", async () => {
    const r = await authenticate("Bearer legacy-standard-token-value", envWith());
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.mode).toBe("legacy");
  });

  it("14. legacy tokens rejected once the flag is off", async () => {
    const env = envWith({ BE_EIGHT_EXPORT_ALLOW_LEGACY_TOKEN: "false" });
    const r = await authenticate("Bearer legacy-privileged-token-value", env);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(asFail(r).status).toBe(401);
    // JWT keeps working with legacy disabled.
    const jwt = await authenticate(`Bearer ${await signJwt(baseClaims())}`, env);
    expect(jwt.ok).toBe(true);
  });

  it("26. failures never echo the presented credential", async () => {
    const r = await authenticate("Bearer super-secret-value", envWith());
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(JSON.stringify(r)).not.toContain("super-secret-value");
      expect(asFail(r).message).toBe("Invalid or missing credentials");
    }
  });

  it("28. rate limit allows a full sync but rejects abuse", () => {
    const max = rateLimitMax(envWith());
    expect(max).toBe(1200);
    for (let i = 0; i < max; i++) {
      expect(checkRateLimit("jwt:sub", max).allowed).toBe(true);
    }
    expect(checkRateLimit("jwt:sub", max).allowed).toBe(false);
    // Other credentials are unaffected.
    expect(checkRateLimit("jwt:other", max).allowed).toBe(true);
  });

  it("28b. rate limit is configurable", () => {
    expect(rateLimitMax(envWith({ BE_EIGHT_EXPORT_RATE_LIMIT_PER_MIN: "50" }))).toBe(50);
    expect(rateLimitMax(envWith({ BE_EIGHT_EXPORT_RATE_LIMIT_PER_MIN: "abc" }))).toBe(1200);
  });

  it("verifyJwt rejects a signature from a foreign key", async () => {
    const good = await signJwt(baseClaims());
    await setupKeys("be-eight-2026-07"); // new keypair, same kid
    const r = await verifyJwt(good, jwks.keys, { allowedSubjects: [DEFAULT_SUB] });
    expect(r.ok).toBe(false);
  });
});

describe("be-eight-export dynamic catalog", () => {
  it("16. password_setup_tokens is denied entirely", () => {
    expect(TABLE_DENYLIST.has("password_setup_tokens")).toBe(true);
  });

  it("17/21. technical secret columns are always blocked (incl. new ones)", () => {
    const cols = [
      "id", "password_hash", "reset_token", "api_key", "client_secret",
      "refresh_token", "access_token", "otp_code", "private_key",
      "authorization_header", "signature", "webhook_secret", "token_hash",
      "new_service_api_key", // synthetic new technical column
    ];
    for (const c of cols.slice(1)) {
      expect(classifyColumn("some_table", c)).toBe("technical_secret");
    }
    expect(visibleColumns("some_table", cols, true)).toEqual(["id"]);
    const row = stripRow("some_table", Object.fromEntries(cols.map((c) => [c, "x"])), true);
    expect(Object.keys(row)).toEqual(["id"]);
  });

  it("18. business-sensitive data is available only in privileged mode", () => {
    const cols = ["id", "hotel_id", "guest_name", "amount", "bank_account", "cpf"];
    expect(visibleColumns("ar_open_folio_entries", cols, false))
      .toEqual(["id", "hotel_id", "amount"]);
    expect(visibleColumns("ar_open_folio_entries", cols, true)).toEqual(cols);
    expect(blockedColumns("ar_open_folio_entries", cols, false))
      .toEqual(["guest_name", "bank_account", "cpf"]);
    expect(blockedColumns("ar_open_folio_entries", cols, true)).toEqual([]);
  });

  it("19/20. new synthetic business fields/tables are exportable by default", () => {
    expect(classifyColumn("brand_new_business_table", "revenue_forecast")).toBe("exportable");
    expect(classifyColumn("brand_new_business_table", "created_at")).toBe("exportable");
    expect(TABLE_DENYLIST.has("brand_new_business_table")).toBe(false);
    expect(visibleColumns("brand_new_business_table", ["id", "revenue_forecast"], false))
      .toEqual(["id", "revenue_forecast"]);
  });

  it("a table with one blocked column still exports its other columns", () => {
    const cols = ["id", "hotel_id", "password_hash", "amount"];
    expect(visibleColumns("mixed_table", cols, false)).toEqual(["id", "hotel_id", "amount"]);
  });
});
