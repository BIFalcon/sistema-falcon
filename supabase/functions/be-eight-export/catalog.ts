// Dynamic exportable catalog + column classification rules for the Be Eight
// export. There is deliberately NO manual per-table allowlist: every base
// table and view of the `public` schema is exportable unless it is a technical
// security artifact. New business tables and new business columns therefore
// appear automatically in /manifest, /watermarks and the paginated export.

/**
 * Tables that must NEVER be exported, in any scope. Restricted to technical /
 * security artifacts (credential and authorization state). Business tables —
 * including logs, settings, HR, finance, guests and banking — are NOT denied
 * here; their sensitivity is handled per column.
 */
export const TABLE_DENYLIST = new Set<string>([
  "password_setup_tokens",
  "email_unsubscribe_tokens",
  "user_roles",
  "user_permissions",
  "user_hotels",
  // Internal replay-protection store for this very integration.
  "be_eight_jti_replay",
]);

/**
 * Technical secrets with no analytical value. Never exported, even with
 * `include_sensitive=true`. Conservative name-pattern rules so that NEW
 * secret-bearing columns are blocked automatically.
 */
export const TECH_SECRET_PATTERNS: RegExp[] = [
  /password/i,
  /passwd/i,
  /pwd/i,
  /secret/i,
  /service_role/i,
  /api[_-]?key/i,
  /private[_-]?key/i,
  /access[_-]?token/i,
  /refresh[_-]?token/i,
  /id[_-]?token/i,
  /session[_-]?token/i,
  /setup[_-]?token/i,
  /reset[_-]?token/i,
  /(^|_)token(_|$)/i,
  /token$/i,
  /^token/i,
  /(^|_)otp(_|$)/i,
  /one[_-]?time[_-]?code/i,
  /(^|_)nonce(_|$)/i,
  /credential/i,
  /client[_-]?secret/i,
  /authorization/i,
  /auth[_-]?header/i,
  /signature/i,
  /(^|_)salt(_|$)/i,
  /_hash$/i,
  /hashed_/i,
  /signed_url/i,
  /webhook[_-]?secret/i,
];

/**
 * Business-sensitive column name patterns: real analytical value, but only
 * released with `export:sensitive` + `include_sensitive=true`.
 */
export const BUSINESS_SENSITIVE_PATTERNS: RegExp[] = [
  /^cpf$/i,
  /(^|_)cnpj(_|$)/i,
  /salary/i,
  /birth_date/i,
  /bank_account/i,
  /(^|_)iban(_|$)/i,
  /guest_name/i,
  /(^|_)email(_|$)/i,
  /(^|_)phone(_|$)/i,
];

/**
 * Explicit per-table business-sensitive columns whose names don't match the
 * generic patterns (documents, contracts, contacts, free text with PII).
 */
export const BUSINESS_SENSITIVE_COLUMNS: Record<string, string[]> = {
  profiles: ["email", "display_name", "phone", "avatar_url"],
  system_settings: ["value"],
  rh_employees: ["cpf", "salary", "birth_date", "raw", "name", "full_name", "email", "phone"],
  rh_org_nodes: ["email", "phone", "person_name"],
  hotels: ["bank_accounts", "cnpj"],
  ar_client_contracts: ["account_number", "account_name", "notes"],
  ar_open_folio_entries: ["account_name", "account_number", "guest_name", "raw"],
  ar_to_invoice_entries: ["account_name", "account_number", "guest_name", "raw"],
  comments: ["body"],
  notification_queue: ["to_email", "payload", "body"],
  email_send_log: ["to_email", "payload", "body"],
  suppressed_emails: ["email"],
  notification_unsubscribes: ["email"],
};

/** True when the column is a technical secret (never exportable). */
export function isTechnicalSecretColumn(column: string): boolean {
  return TECH_SECRET_PATTERNS.some((re) => re.test(column));
}

/** True when the column is business-sensitive (privileged mode only). */
export function isBusinessSensitiveColumn(table: string, column: string): boolean {
  if (isTechnicalSecretColumn(column)) return false;
  if (BUSINESS_SENSITIVE_PATTERNS.some((re) => re.test(column))) return true;
  return (BUSINESS_SENSITIVE_COLUMNS[table] ?? []).includes(column);
}

export type ColumnClass = "exportable" | "business_sensitive" | "technical_secret";

export function classifyColumn(table: string, column: string): ColumnClass {
  if (isTechnicalSecretColumn(column)) return "technical_secret";
  if (isBusinessSensitiveColumn(table, column)) return "business_sensitive";
  return "exportable";
}

/** Columns visible for a given mode. */
export function visibleColumns(
  table: string,
  columns: string[],
  includeSensitive: boolean,
): string[] {
  return columns.filter((c) => {
    const cls = classifyColumn(table, c);
    if (cls === "technical_secret") return false;
    if (cls === "business_sensitive") return includeSensitive;
    return true;
  });
}

/** Columns withheld for a given mode (reported as metadata only). */
export function blockedColumns(
  table: string,
  columns: string[],
  includeSensitive: boolean,
): string[] {
  return columns.filter((c) => !visibleColumns(table, [c], includeSensitive).length);
}

/** Strip withheld values from a row. */
export function stripRow<T extends Record<string, unknown>>(
  table: string,
  row: T,
  includeSensitive: boolean,
): T {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(row)) {
    const cls = classifyColumn(table, k);
    if (cls === "technical_secret") continue;
    if (cls === "business_sensitive" && !includeSensitive) continue;
    out[k] = v;
  }
  return out as T;
}

export function isExportableObject(name: string): boolean {
  return !TABLE_DENYLIST.has(name);
}
