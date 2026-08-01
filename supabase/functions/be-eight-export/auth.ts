// Machine-to-machine authentication for the Be Eight export integration.
//
// Two modes are supported during the migration window:
//   1. `jwt`    — asymmetric ES256 JWT signed by Be Eight. Falcon only ever
//                 stores PUBLIC keys (JWKS). The private key never exists here.
//   2. `legacy` — the pre-existing static bearer tokens, kept temporarily and
//                 gated by BE_EIGHT_EXPORT_ALLOW_LEGACY_TOKEN so the current
//                 production cron is not interrupted.
//
// Nothing in this module ever logs, returns or echoes a token, a JWT, a
// signature or any secret value.

export type AuthMode = "jwt" | "legacy";
export type ExportScope = "standard" | "privileged";

export const EXPECTED_ISS = "be-eight-connectors";
export const EXPECTED_AUD = "falcon-be-eight-export";
export const DEFAULT_SUB = "connectors-service-prd";
export const SCOPE_READ = "export:read";
export const SCOPE_SENSITIVE = "export:sensitive";
/** Maximum accepted token lifetime (exp - iat), in seconds. */
export const MAX_TOKEN_TTL_SECONDS = 300;
/** Clock skew tolerance, in seconds. */
export const CLOCK_SKEW_SECONDS = 30;

export interface AuthSuccess {
  ok: true;
  mode: AuthMode;
  sub: string;
  kid: string | null;
  jti: string | null;
  /** Absolute expiry (epoch seconds) — used for replay-record TTL. */
  exp: number | null;
  scopes: string[];
  scope: ExportScope;
}

export interface AuthFailure {
  ok: false;
  status: 401 | 403 | 500;
  errorCode: string;
  /** Sanitized, caller-safe message. Never contains token/JWT internals. */
  message: string;
  /** Internal-only reason for audit logs. Never returned to the caller. */
  reason: string;
}

export type AuthResult = AuthSuccess | AuthFailure;

function fail(
  status: 401 | 403 | 500,
  errorCode: string,
  message: string,
  reason: string,
): AuthFailure {
  return { ok: false, status, errorCode, message, reason };
}

const UNAUTHORIZED = (reason: string) =>
  fail(401, "unauthorized", "Invalid or missing credentials", reason);

/** Constant-time string comparison (length-safe). */
export function timingSafeEqual(a: string, b: string): boolean {
  const enc = new TextEncoder();
  const ab = enc.encode(a);
  const bb = enc.encode(b);
  // Compare a fixed-size digest so length differences don't leak via timing.
  const len = Math.max(ab.length, bb.length, 1);
  let diff = ab.length ^ bb.length;
  for (let i = 0; i < len; i++) {
    diff |= (ab[i] ?? 0) ^ (bb[i] ?? 0);
  }
  return diff === 0;
}

export function base64UrlToBytes(input: string): Uint8Array {
  const norm = input.replace(/-/g, "+").replace(/_/g, "/");
  const padded = norm + "=".repeat((4 - (norm.length % 4)) % 4);
  const bin = atob(padded);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

function decodeJsonSegment(seg: string): Record<string, unknown> | null {
  try {
    const text = new TextDecoder().decode(base64UrlToBytes(seg));
    const obj = JSON.parse(text);
    return obj && typeof obj === "object" ? obj as Record<string, unknown> : null;
  } catch {
    return null;
  }
}

export async function sha256Hex(input: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(input));
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

export interface Jwk {
  kty?: string;
  crv?: string;
  kid?: string;
  alg?: string;
  x?: string;
  y?: string;
  use?: string;
  [k: string]: unknown;
}

export function parseJwks(raw: string | undefined | null): Jwk[] | null {
  if (!raw || !raw.trim()) return null;
  try {
    const parsed = JSON.parse(raw);
    const keys = Array.isArray(parsed) ? parsed : parsed?.keys;
    if (!Array.isArray(keys)) return null;
    return keys as Jwk[];
  } catch {
    return null;
  }
}

function normalizeScopes(claims: Record<string, unknown>): string[] {
  const raw = claims.scope ?? claims.scopes ?? claims.scp;
  if (typeof raw === "string") return raw.split(/[\s,]+/).filter(Boolean);
  if (Array.isArray(raw)) return raw.filter((s): s is string => typeof s === "string");
  return [];
}

export function allowedSubjects(env: (k: string) => string | undefined): string[] {
  const configured = env("BE_EIGHT_EXPORT_ALLOWED_SUBJECTS");
  if (configured && configured.trim()) {
    return configured.split(/[\s,]+/).filter(Boolean);
  }
  return [DEFAULT_SUB];
}

/**
 * Verify an ES256 JWT against the configured JWKS and the Be Eight contract.
 * Signature, kid, alg, iss, aud, sub, timestamps and scopes are all checked
 * BEFORE any service_role client is created by the caller.
 */
export async function verifyJwt(
  token: string,
  jwks: Jwk[],
  opts: {
    allowedSubjects: string[];
    nowSeconds?: number;
    /** Test seam: replaces Web Crypto verification. */
    verifySignature?: (jwk: Jwk, data: string, sig: Uint8Array) => Promise<boolean>;
  },
): Promise<AuthResult> {
  const now = opts.nowSeconds ?? Math.floor(Date.now() / 1000);
  const parts = token.split(".");
  if (parts.length !== 3) return UNAUTHORIZED("malformed_jwt");
  const [h, p, s] = parts;

  const header = decodeJsonSegment(h);
  if (!header) return UNAUTHORIZED("bad_header");
  if (header.alg !== "ES256") return UNAUTHORIZED("bad_alg");
  if (header.typ !== undefined && header.typ !== "JWT") return UNAUTHORIZED("bad_typ");
  const kid = typeof header.kid === "string" ? header.kid : null;
  if (!kid) return UNAUTHORIZED("missing_kid");

  const jwk = jwks.find((k) => k.kid === kid);
  if (!jwk) return UNAUTHORIZED("unknown_kid");
  if (jwk.kty !== "EC" || jwk.crv !== "P-256") return UNAUTHORIZED("bad_key_type");
  if (jwk.alg !== undefined && jwk.alg !== "ES256") return UNAUTHORIZED("bad_key_alg");

  let sig: Uint8Array;
  try {
    sig = base64UrlToBytes(s);
  } catch {
    return UNAUTHORIZED("bad_signature_encoding");
  }
  if (sig.length !== 64) return UNAUTHORIZED("bad_signature_length");

  const signingInput = `${h}.${p}`;
  let valid: boolean;
  try {
    valid = opts.verifySignature
      ? await opts.verifySignature(jwk, signingInput, sig)
      : await webCryptoVerify(jwk, signingInput, sig);
  } catch {
    return UNAUTHORIZED("signature_verify_error");
  }
  if (!valid) return UNAUTHORIZED("bad_signature");

  const claims = decodeJsonSegment(p);
  if (!claims) return UNAUTHORIZED("bad_claims");

  if (claims.iss !== EXPECTED_ISS) return UNAUTHORIZED("bad_iss");
  const aud = claims.aud;
  const audOk = Array.isArray(aud) ? aud.includes(EXPECTED_AUD) : aud === EXPECTED_AUD;
  if (!audOk) return UNAUTHORIZED("bad_aud");

  const iat = typeof claims.iat === "number" ? claims.iat : null;
  const exp = typeof claims.exp === "number" ? claims.exp : null;
  if (iat === null) return UNAUTHORIZED("missing_iat");
  if (exp === null) return UNAUTHORIZED("missing_exp");
  if (iat > now + CLOCK_SKEW_SECONDS) return UNAUTHORIZED("iat_in_future");
  if (exp <= now - CLOCK_SKEW_SECONDS) return UNAUTHORIZED("expired");
  if (exp - iat > MAX_TOKEN_TTL_SECONDS) return UNAUTHORIZED("ttl_too_long");
  if (typeof claims.nbf === "number" && claims.nbf > now + CLOCK_SKEW_SECONDS) {
    return UNAUTHORIZED("not_yet_valid");
  }

  const jti = typeof claims.jti === "string" && claims.jti.trim() ? claims.jti : null;
  if (!jti) return UNAUTHORIZED("missing_jti");

  const sub = typeof claims.sub === "string" ? claims.sub : "";
  if (!sub) return UNAUTHORIZED("missing_sub");
  if (!opts.allowedSubjects.includes(sub)) {
    return fail(403, "forbidden_subject", "Subject is not authorized", "sub_not_allowed");
  }

  const scopes = normalizeScopes(claims);
  if (!scopes.includes(SCOPE_READ)) {
    return fail(403, "forbidden_scope", "Missing required scope", "missing_export_read");
  }

  return {
    ok: true,
    mode: "jwt",
    sub,
    kid,
    jti,
    exp,
    scopes,
    scope: scopes.includes(SCOPE_SENSITIVE) ? "privileged" : "standard",
  };
}

async function webCryptoVerify(jwk: Jwk, data: string, sig: Uint8Array): Promise<boolean> {
  const key = await crypto.subtle.importKey(
    "jwk",
    { kty: "EC", crv: "P-256", x: jwk.x, y: jwk.y, ext: true },
    { name: "ECDSA", namedCurve: "P-256" },
    false,
    ["verify"],
  );
  return await crypto.subtle.verify(
    { name: "ECDSA", hash: { name: "SHA-256" } },
    key,
    sig.slice().buffer as ArrayBuffer,
    new TextEncoder().encode(data).slice().buffer as ArrayBuffer,
  );
}

/** Legacy static bearer tokens — timing-safe, flag-gated. */
export function verifyLegacyToken(
  presented: string,
  env: (k: string) => string | undefined,
): AuthResult {
  const allowLegacy = (env("BE_EIGHT_EXPORT_ALLOW_LEGACY_TOKEN") ?? "true").toLowerCase();
  const legacyEnabled = allowLegacy === "true" || allowLegacy === "1";
  if (!legacyEnabled) return UNAUTHORIZED("legacy_disabled");

  const standard = env("BE_EIGHT_EXPORT_TOKEN");
  const privileged = env("BE_EIGHT_EXPORT_PRIVILEGED_TOKEN");
  if (privileged && timingSafeEqual(presented, privileged)) {
    return {
      ok: true,
      mode: "legacy",
      sub: "legacy-privileged",
      kid: null,
      jti: null,
      exp: null,
      scopes: [SCOPE_READ, SCOPE_SENSITIVE],
      scope: "privileged",
    };
  }
  if (standard && timingSafeEqual(presented, standard)) {
    return {
      ok: true,
      mode: "legacy",
      sub: "legacy-standard",
      kid: null,
      jti: null,
      exp: null,
      scopes: [SCOPE_READ],
      scope: "standard",
    };
  }
  return UNAUTHORIZED("legacy_token_mismatch");
}

function looksLikeJwt(token: string): boolean {
  return /^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(token);
}

/**
 * Authenticate a request. JWT is attempted first; the legacy path is used only
 * for non-JWT-shaped credentials (or when no JWKS is configured yet).
 */
export async function authenticate(
  authorizationHeader: string | null,
  env: (k: string) => string | undefined,
  opts: { nowSeconds?: number } = {},
): Promise<AuthResult> {
  const m = /^Bearer\s+(.+)$/i.exec(authorizationHeader ?? "");
  if (!m) return UNAUTHORIZED("missing_bearer");
  const presented = m[1].trim();
  if (!presented) return UNAUTHORIZED("empty_bearer");

  const jwks = parseJwks(env("BE_EIGHT_EXPORT_JWKS_JSON"));
  if (jwks && jwks.length > 0 && looksLikeJwt(presented)) {
    return await verifyJwt(presented, jwks, {
      allowedSubjects: allowedSubjects(env),
      nowSeconds: opts.nowSeconds,
    });
  }
  return verifyLegacyToken(presented, env);
}

// ---------------------------------------------------------------------------
// Rate limiting (per credential subject). Fail-closed: any internal error in
// the limiter results in the request being rejected, never allowed through.
// ---------------------------------------------------------------------------

const WINDOW_MS = 60_000;
const buckets = new Map<string, number[]>();

export function rateLimitMax(env: (k: string) => string | undefined): number {
  const raw = env("BE_EIGHT_EXPORT_RATE_LIMIT_PER_MIN");
  const parsed = raw ? parseInt(raw, 10) : NaN;
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 1200;
}

export function checkRateLimit(
  key: string,
  max: number,
  nowMs = Date.now(),
): { allowed: boolean; remaining: number } {
  try {
    const cutoff = nowMs - WINDOW_MS;
    const hits = (buckets.get(key) ?? []).filter((t) => t > cutoff);
    if (hits.length >= max) {
      buckets.set(key, hits);
      return { allowed: false, remaining: 0 };
    }
    hits.push(nowMs);
    buckets.set(key, hits);
    if (buckets.size > 5000) buckets.clear();
    return { allowed: true, remaining: Math.max(0, max - hits.length) };
  } catch {
    // Fail closed.
    return { allowed: false, remaining: 0 };
  }
}

export function __resetRateLimitForTests() {
  buckets.clear();
}
