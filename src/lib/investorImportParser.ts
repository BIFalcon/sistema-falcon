import * as XLSX from "xlsx";

export type PixType = "cpf" | "cnpj" | "email" | "telefone" | "aleatoria";
export type DataStatus = "completo" | "parcial" | "pendente";

export interface ParsedInvestorRow {
  linha: number;
  codigo_uh: string;
  investor: { codigo_externo: string | null; nome: string; documento: string | null; email: string | null; telefone: string | null };
  payee: {
    nome_favorecido: string;
    documento_favorecido: string | null;
    banco_codigo: string | null;
    banco_nome: string | null;
    agencia: string | null;
    conta: string | null;
    tipo_chave_pix: PixType | null;
    chave_pix: string | null;
    observacao?: string | null;
  } | null;
  status: DataStatus;
}

export interface ImportWarning { linha?: number; uh?: string; tipo: "banco" | "documento" | "pix" | "uh" | "info"; mensagem: string }

export interface ParsedInvestorFile {
  hotelTitle: string;
  rows: ParsedInvestorRow[];
  warnings: ImportWarning[];
}

const strip = (s: string) => s.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().trim();

/** Valores placeholder ("x", "-", vazio) contam como ausentes. */
export function clean(v: unknown): string | null {
  if (v === null || v === undefined) return null;
  const s = String(v).replace(/\s+/g, " ").trim();
  if (!s || /^(x+|-+|\.+|n\/?a|nao possui|não possui)$/i.test(s)) return null;
  return s;
}

const onlyDigits = (s: string | null) => (s ? s.replace(/\D/g, "") : "");

const BANKS: { codigo: string; nome: string; test: RegExp }[] = [
  { codigo: "341", nome: "Itaú", test: /\bitau\b|\b341\b/ },
  { codigo: "104", nome: "Caixa", test: /\bcaixa\b|\bcef\b|\b104\b/ },
  { codigo: "001", nome: "Banco do Brasil", test: /banco do brasil|^bb$|\b001\b/ },
  { codigo: "237", nome: "Bradesco", test: /bradesco|\b237\b/ },
  { codigo: "033", nome: "Santander", test: /santander|\b033\b/ },
  { codigo: "260", nome: "Nubank", test: /nubank|nu pagamentos|\b260\b/ },
  { codigo: "077", nome: "Inter", test: /\binter\b|\b077\b/ },
  { codigo: "756", nome: "Sicoob", test: /sicoob|\b756\b/ },
  { codigo: "748", nome: "Sicredi", test: /sicredi|\b748\b/ },
  { codigo: "336", nome: "C6 Bank", test: /\bc6\b|\b336\b/ },
  { codigo: "208", nome: "BTG Pactual", test: /\bbtg\b|\b208\b/ },
  { codigo: "422", nome: "Safra", test: /safra|\b422\b/ },
  { codigo: "041", nome: "Banrisul", test: /banrisul|\b041\b/ },
  { codigo: "212", nome: "Banco Original", test: /original|\b212\b/ },
];

export function normalizeBank(raw: string | null): { codigo: string | null; nome: string | null; reconhecido: boolean } {
  if (!raw) return { codigo: null, nome: null, reconhecido: true };
  const s = strip(raw);
  const hit = BANKS.find((b) => b.test.test(s));
  if (hit) return { codigo: hit.codigo, nome: hit.nome, reconhecido: true };
  return { codigo: null, nome: raw.trim(), reconhecido: false };
}

export function detectPixType(key: string): PixType {
  const k = key.trim();
  if (k.includes("@")) return "email";
  if (/^[0-9a-f]{8}-?[0-9a-f]{4}-?[0-9a-f]{4}-?[0-9a-f]{4}-?[0-9a-f]{12}$/i.test(k)) return "aleatoria";
  const d = onlyDigits(k);
  if (k.startsWith("+") || /\(\d{2}\)/.test(k)) return "telefone";
  if (d.length === 14) return "cnpj";
  if (d.length === 11) return /^\d{3}\.\d{3}\.\d{3}-\d{2}$/.test(k) || !/^\d{2}9/.test(d) ? "cpf" : "cpf";
  if (d.length >= 10 && d.length <= 13) return "telefone";
  return "aleatoria";
}

function normalizePixKey(key: string, type: PixType): string {
  if (type === "cpf" || type === "cnpj") return onlyDigits(key);
  if (type === "telefone") return onlyDigits(key);
  return key.trim();
}

/** "4021 - NOME (24.674.583/0001-02)" → partes. */
export function parseInvestorName(raw: string): { codigo_externo: string | null; nome: string; documento: string | null } {
  const s = raw.replace(/\s+/g, " ").trim();
  const m = s.match(/^(?:(\d+)\s*-\s*)?(.+?)\s*(?:\(([^)]*)\))?\s*$/);
  if (!m) return { codigo_externo: null, nome: s, documento: null };
  const doc = m[3] ? onlyDigits(m[3]) : "";
  return { codigo_externo: m[1] ?? null, nome: m[2].trim(), documento: doc.length >= 11 ? doc : null };
}

export function computeStatus(p: { banco_codigo: string | null; banco_nome: string | null; agencia: string | null; conta: string | null; chave_pix: string | null } | null): DataStatus {
  if (!p) return "pendente";
  const banco = p.banco_codigo || p.banco_nome;
  if (banco && p.agencia && p.conta) return "completo";
  if (banco || p.agencia || p.conta || p.chave_pix) return "parcial";
  return "pendente";
}

type ColMap = { nome: number; uh: number; email: number; tel: number; docInv: number; fav: number; docFav: number; banco: number; agencia: number; conta: number };

function mapColumns(header: unknown[]): ColMap {
  const h = header.map((c) => strip(String(c ?? "")));
  const find = (re: RegExp, from = 0) => h.findIndex((c, i) => i >= from && re.test(c));
  const fav = find(/^favorecido/);
  const docs = h.map((c, i) => (/cpf|cnpj/.test(c) ? i : -1)).filter((i) => i >= 0);
  const docInv = docs.find((i) => fav < 0 || i < fav) ?? -1;
  const docFav = fav >= 0 ? docs.find((i) => i > fav) ?? -1 : -1;
  return {
    nome: find(/^nome/),
    uh: find(/^unidade/),
    email: find(/e-?mail/),
    tel: find(/telefone/),
    docInv,
    fav,
    docFav,
    banco: find(/^banco/),
    agencia: find(/^agencia/),
    conta: find(/^conta/),
  };
}

export function parseInvestorRows(matrix: unknown[][]): ParsedInvestorFile {
  if (matrix.length < 2) throw new Error("Planilha vazia: esperado nome do hotel na linha 1 e cabeçalho na linha 2.");
  const hotelTitle = String((matrix[0] ?? []).find((c) => clean(c)) ?? "").trim();
  const cols = mapColumns(matrix[1] ?? []);
  if (cols.nome < 0 || cols.uh < 0) throw new Error("Cabeçalho inválido: colunas \"Nome\" e \"Unidades\" são obrigatórias na linha 2.");

  const get = (row: unknown[], i: number) => (i >= 0 ? clean(row[i]) : null);
  const rows: ParsedInvestorRow[] = [];
  const warnings: ImportWarning[] = [];
  const seenUh = new Set<string>();
  const docNames = new Map<string, string>();

  for (let r = 2; r < matrix.length; r++) {
    const row = matrix[r] ?? [];
    const nomeRaw = get(row, cols.nome);
    const uhRaw = get(row, cols.uh);
    if (!nomeRaw && !uhRaw) continue;
    const linha = r + 1;
    if (!uhRaw) { warnings.push({ linha, tipo: "uh", mensagem: `Linha ${linha} sem UH — ignorada.` }); continue; }
    if (!nomeRaw) { warnings.push({ linha, uh: uhRaw, tipo: "uh", mensagem: `UH ${uhRaw} sem investidor — ignorada.` }); continue; }
    const codigo_uh = uhRaw.toUpperCase().replace(/\s+/g, "");
    if (seenUh.has(codigo_uh)) { warnings.push({ linha, uh: codigo_uh, tipo: "uh", mensagem: `UH ${codigo_uh} repetida na planilha — mantida a última ocorrência.` }); }
    seenUh.add(codigo_uh);

    const parsed = parseInvestorName(nomeRaw);
    const docCol = onlyDigits(get(row, cols.docInv));
    const documento = parsed.documento ?? (docCol.length >= 11 ? docCol : null);
    if (!documento) warnings.push({ linha, uh: codigo_uh, tipo: "documento", mensagem: `UH ${codigo_uh}: investidor sem CPF/CNPJ.` });
    if (documento) {
      const prev = docNames.get(documento);
      if (prev && strip(prev) !== strip(parsed.nome)) {
        warnings.push({ linha, uh: codigo_uh, tipo: "documento", mensagem: `Documento repetido com nomes diferentes: "${prev}" e "${parsed.nome}".` });
      } else if (!prev) docNames.set(documento, parsed.nome);
    }

    // Favorecido / dados bancários
    let favDocRaw = get(row, cols.docFav);
    let bancoRaw = get(row, cols.banco);
    let chave: string | null = null;
    let tipo: PixType | null = null;
    if (favDocRaw && /pix/i.test(favDocRaw)) {
      const k = favDocRaw.replace(/\(?\s*(chave\s*)?pix\s*:?\s*\)?/gi, "").trim();
      if (k) { tipo = detectPixType(k); chave = normalizePixKey(k, tipo); }
      favDocRaw = k || null;
      warnings.push({ linha, uh: codigo_uh, tipo: "pix", mensagem: `UH ${codigo_uh}: chave PIX extraída do documento do favorecido.` });
    }
    if (bancoRaw && /pix/i.test(bancoRaw)) {
      const m = bancoRaw.match(/pix\s*:?\s*(.+)$/i);
      const k = m?.[1]?.trim() ?? "";
      if (k && !chave) { tipo = detectPixType(k); chave = normalizePixKey(k, tipo); }
      bancoRaw = clean(bancoRaw.replace(/(chave\s*)?pix\s*:?.*$/i, "")) ;
      warnings.push({ linha, uh: codigo_uh, tipo: "pix", mensagem: `UH ${codigo_uh}: chave PIX extraída do campo Banco.` });
    }
    const bank = normalizeBank(bancoRaw);
    if (!bank.reconhecido) warnings.push({ linha, uh: codigo_uh, tipo: "banco", mensagem: `UH ${codigo_uh}: banco não reconhecido "${bancoRaw}" — mantido o texto original.` });

    const favNome = get(row, cols.fav);
    const agencia = get(row, cols.agencia);
    const conta = get(row, cols.conta);
    const favDoc = onlyDigits(favDocRaw);
    const payee = favNome
      ? {
          nome_favorecido: favNome,
          documento_favorecido: favDoc.length >= 11 ? favDoc : null,
          banco_codigo: bank.codigo,
          banco_nome: bank.nome,
          agencia,
          conta,
          tipo_chave_pix: tipo,
          chave_pix: chave,
        }
      : null;
    if (!favNome && (bancoRaw || agencia || conta || chave)) {
      warnings.push({ linha, uh: codigo_uh, tipo: "info", mensagem: `UH ${codigo_uh}: dados bancários sem nome do favorecido — não gravados.` });
    }

    rows.push({
      linha,
      codigo_uh,
      investor: { ...parsed, documento, email: get(row, cols.email), telefone: get(row, cols.tel) },
      payee,
      status: computeStatus(payee),
    });
  }

  // Deduplica UHs (última ocorrência vence)
  const byUh = new Map<string, ParsedInvestorRow>();
  rows.forEach((r) => byUh.set(r.codigo_uh, r));
  return { hotelTitle, rows: Array.from(byUh.values()), warnings };
}

export async function parseInvestorFile(file: File): Promise<ParsedInvestorFile> {
  const buf = await file.arrayBuffer();
  const wb = XLSX.read(buf, { type: "array" });
  const ws = wb.Sheets[wb.SheetNames[0]];
  const matrix = XLSX.utils.sheet_to_json<unknown[]>(ws, { header: 1, raw: false, defval: "" });
  return parseInvestorRows(matrix);
}
