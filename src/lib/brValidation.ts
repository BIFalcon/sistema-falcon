// Padrões brasileiros de cadastro (CPF/CNPJ, telefone, agência, conta, PIX).
// Retornam null quando válido (ou vazio) e uma mensagem curta quando há problema.

export const onlyDigits = (s: string | null | undefined) => (s ?? "").replace(/\D/g, "");

export function isValidCpf(v: string): boolean {
  const d = onlyDigits(v);
  if (d.length !== 11 || /^(\d)\1{10}$/.test(d)) return false;
  const calc = (len: number) => {
    let s = 0;
    for (let i = 0; i < len; i++) s += Number(d[i]) * (len + 1 - i);
    const r = (s * 10) % 11;
    return r === 10 ? 0 : r;
  };
  return calc(9) === Number(d[9]) && calc(10) === Number(d[10]);
}

export function isValidCnpj(v: string): boolean {
  const d = onlyDigits(v);
  if (d.length !== 14 || /^(\d)\1{13}$/.test(d)) return false;
  const calc = (len: number) => {
    const w = len === 12 ? [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2] : [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2];
    const s = w.reduce((a, x, i) => a + x * Number(d[i]), 0);
    const r = s % 11;
    return r < 2 ? 0 : 11 - r;
  };
  return calc(12) === Number(d[12]) && calc(13) === Number(d[13]);
}

export function validateDocumento(v: string | null | undefined): string | null {
  const d = onlyDigits(v);
  if (!d) return null;
  if (d.length === 11) return isValidCpf(d) ? null : "CPF inválido";
  if (d.length === 14) return isValidCnpj(d) ? null : "CNPJ inválido";
  return "CPF deve ter 11 dígitos e CNPJ 14";
}

export function formatDocumento(v: string | null | undefined): string {
  const d = onlyDigits(v);
  if (d.length === 11) return d.replace(/(\d{3})(\d{3})(\d{3})(\d{2})/, "$1.$2.$3-$4");
  if (d.length === 14) return d.replace(/(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})/, "$1.$2.$3/$4-$5");
  return v ?? "";
}

export function validateTelefone(v: string | null | undefined): string | null {
  const d = onlyDigits(v);
  if (!d) return null;
  if (d.length !== 10 && d.length !== 11) return "Telefone deve ter DDD + número (10 ou 11 dígitos)";
  if (d.length === 11 && d[2] !== "9") return "Celular deve começar com 9 após o DDD";
  return null;
}

export function formatTelefone(v: string | null | undefined): string {
  const d = onlyDigits(v);
  if (d.length === 11) return d.replace(/(\d{2})(\d{5})(\d{4})/, "($1) $2-$3");
  if (d.length === 10) return d.replace(/(\d{2})(\d{4})(\d{4})/, "($1) $2-$3");
  return v ?? "";
}

export function validateEmail(v: string | null | undefined): string | null {
  const s = (v ?? "").trim();
  if (!s) return null;
  return /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(s) ? null : "E-mail inválido";
}

/** Agência: 4 dígitos, com dígito verificador opcional (ex.: 1234 ou 1234-5). */
export function validateAgencia(v: string | null | undefined): string | null {
  const s = (v ?? "").trim();
  if (!s) return null;
  return /^\d{1,5}(-[\dXx])?$/.test(s) && onlyDigits(s.split("-")[0]).length >= 3 ? null : "Agência no formato 1234 ou 1234-5";
}

/** Conta corrente ou poupança: número + dígito verificador (ex.: 12345-6). */
export function validateConta(v: string | null | undefined): string | null {
  const s = (v ?? "").trim();
  if (!s) return null;
  return /^\d{1,13}-[\dXx]$/.test(s) ? null : "Conta no formato 12345-6 (número e dígito)";
}

export type PixTipo = "cpf" | "cnpj" | "email" | "telefone" | "aleatoria";

export function validatePix(tipo: string | null | undefined, chave: string | null | undefined): string | null {
  const k = (chave ?? "").trim();
  if (!k) return null;
  switch (tipo) {
    case "cpf": return isValidCpf(k) ? null : "Chave PIX: CPF inválido";
    case "cnpj": return isValidCnpj(k) ? null : "Chave PIX: CNPJ inválido";
    case "email": return validateEmail(k) ? "Chave PIX: e-mail inválido" : null;
    case "telefone": {
      const d = onlyDigits(k).replace(/^55(?=\d{10,11}$)/, "");
      return validateTelefone(d) ? "Chave PIX: telefone inválido" : null;
    }
    case "aleatoria":
      return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(k) ? null : "Chave PIX aleatória deve ter 32 caracteres no formato UUID";
    default: return "Informe o tipo da chave PIX";
  }
}

export interface PayeeLike {
  documento_favorecido?: string | null; email?: string | null; telefone?: string | null; agencia?: string | null; conta?: string | null;
  tipo_conta?: string | null; tipo_chave_pix?: string | null; chave_pix?: string | null; banco_codigo?: string | null; banco_nome?: string | null;
}

/** Problemas de formato e o que falta para entrar numa remessa bancária. */
export function payeeIssues(p: PayeeLike): { formato: string[]; remessa: string[] } {
  const formato = [validateDocumento(p.documento_favorecido), validateEmail(p.email), validateTelefone(p.telefone),
    validateAgencia(p.agencia), validateConta(p.conta), p.chave_pix ? validatePix(p.tipo_chave_pix, p.chave_pix) : null].filter(Boolean) as string[];
  const remessa: string[] = [];
  if (!onlyDigits(p.documento_favorecido)) remessa.push("CPF/CNPJ");
  const temPix = !!(p.chave_pix ?? "").trim();
  const temConta = !!(p.banco_codigo || p.banco_nome) && !!(p.agencia ?? "").trim() && !!(p.conta ?? "").trim();
  if (!temPix && !temConta) remessa.push("conta bancária ou chave PIX");
  if (temConta && !p.tipo_conta) remessa.push("tipo de conta");
  return { formato, remessa };
}

/** Soma das frações com tolerância de 0,01 p.p. */
export function sharesSumOk(pcts: number[]): boolean {
  return pcts.length > 0 && pcts.every((x) => x > 0 && x <= 100) && Math.abs(pcts.reduce((a, b) => a + b, 0) - 100) <= 0.01;
}

/** Divide 100% em n partes de 2 casas, ajustando o resto na primeira (ex.: 3 → 33,34/33,33/33,33). */
export function equalShares(n: number): number[] {
  if (n <= 0) return [];
  const base = Math.floor((100 / n) * 100) / 100;
  const out = Array(n).fill(base);
  out[0] = Math.round((100 - base * (n - 1)) * 100) / 100;
  return out;
}
