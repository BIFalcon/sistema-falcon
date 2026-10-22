import * as XLSX from "xlsx";
import { fixSheetRef, hashKey, makeOccCounter, normText, parseMoney, toIso } from "./conciliacaoParsers";

/**
 * Filtro do extrato na Baixa Rede. Formato visto no extrato real:
 * "RECEBIMENTO REDE MAST DB0086870238" (bandeira + CD/DB/AT + nº do estabelecimento).
 * Para ajustar, mude apenas estas constantes.
 */
export const REDE_BANK_PREFIX = "RECEBIMENTO REDE";
export const REDE_BRAND_CODES: Record<string, string> = {
  MASTERCARD: "MAST", VISA: "VISA", ELO: "ELO", AMEX: "AMEX", "AMERICAN EXPRESS": "AMEX",
  HIPERCARD: "HIPER", HIPER: "HIPER", DINERS: "DINERS", CABAL: "CABAL",
};
export const REDE_MOD_CODES: Record<string, string> = { CREDITO: "CD", DEBITO: "DB", ANTECIPADO: "AT" };

export const ANTECIPACAO_MOTIVO = "TAXA DE ANTECIPACAO";
export const isAntecipacao = (motivo: string | null | undefined) => normText(motivo) === ANTECIPACAO_MOTIVO;

export interface RedePagamento {
  entry_key: string; hotel_id: string;
  data_recebimento: string | null; data_original_venda: string | null; data_original_vencimento: string | null;
  valor_bruto_parcela_original: number | null; valor_bruto_parcela_atualizada: number | null;
  taxa_mdr: number | null; valor_mdr: number | null; valor_liquido_parcela: number | null;
  nsu_cv: string | null; modalidade: string | null; bandeira: string | null;
  banco: string | null; agencia: string | null; conta_corrente: string | null; status: string | null;
}
export interface RedeRecebido {
  entry_key: string; hotel_id: string; data: string | null; bandeira: string | null;
  modalidade: string | null; valor_depositado: number | null; status: string | null;
}
export interface RedeAjuste {
  entry_key: string; hotel_id: string; data_ajuste: string | null; motivo: string | null;
  valor_cobrado: number | null; bandeira: string | null;
}
export interface RedeChargeback {
  entry_key: string; hotel_id: string; data_debito: string | null; tipo: string | null;
  data_original_venda: string | null; valor_original_venda: number | null; valor_descontado: number | null;
  motivo_cancelamento: string | null; nsu_cv: string | null; bandeira: string | null; modalidade: string | null;
}
export interface RedeRecebimentosParsed {
  pagamentos: RedePagamento[]; recebidos: RedeRecebido[]; ajustes: RedeAjuste[]; chargebacks: RedeChargeback[];
}

const empty = (v: unknown) => v == null || String(v).trim() === "" || String(v).trim() === "-";
const txt = (v: unknown) => (empty(v) ? null : String(v).trim());
const num = (v: unknown) => (empty(v) ? null : parseMoney(v));
const date = (v: unknown) => (empty(v) ? null : toIso(v) || null);

/** Lê uma aba: acha a linha de cabeçalho pela coluna-chave e devolve um getter por nome de coluna. */
function sheetRows(grid: unknown[][] | undefined, keyCol: string) {
  if (!grid) return [];
  const hi = grid.findIndex((r) => (r ?? []).some((c) => normText(c) === normText(keyCol)));
  if (hi === -1) return [];
  const header = (grid[hi] ?? []).map((c) => normText(c));
  return grid.slice(hi + 1)
    .filter((r) => (r ?? []).some((c) => !empty(c)))
    .map((r) => (name: string) => {
      const i = header.indexOf(normText(name));
      return i === -1 ? null : r[i];
    });
}

const key = (hotelId: string, tab: string, parts: unknown[], occ: (b: string) => number) => {
  const base = [hotelId, tab, ...parts.map((p) => String(p ?? ""))].join("|");
  return hashKey([base, occ(base)]);
};

export function parseRedeRecebimentosSheets(sheets: Record<string, unknown[][]>, hotelId: string): RedeRecebimentosParsed {
  const byName = (n: string) => {
    const k = Object.keys(sheets).find((s) => normText(s) === normText(n));
    return k ? sheets[k] : undefined;
  };
  if (!byName("pagamentos") && !byName("recebidos")) {
    throw new Error("Arquivo não parece o relatório de recebimentos da Rede (abas 'pagamentos'/'recebidos' não encontradas).");
  }
  const occ = makeOccCounter();

  const pagamentos = sheetRows(byName("pagamentos"), "data do recebimento").map<RedePagamento>((g) => {
    const row = {
      hotel_id: hotelId,
      data_recebimento: date(g("data do recebimento")), data_original_venda: date(g("data original da venda")),
      data_original_vencimento: date(g("data original de vencimento")),
      valor_bruto_parcela_original: num(g("valor bruto da parcela original")),
      valor_bruto_parcela_atualizada: num(g("valor bruto da parcela atualizada")),
      taxa_mdr: num(g("taxa MDR")), valor_mdr: num(g("valor MDR descontado")),
      valor_liquido_parcela: num(g("valor líquido da parcela")),
      nsu_cv: txt(g("NSU/CV")), modalidade: txt(g("modalidade")), bandeira: txt(g("bandeira")),
      banco: txt(g("banco")), agencia: txt(g("agência")), conta_corrente: txt(g("conta-corrente")), status: txt(g("status")),
    };
    return { ...row, entry_key: key(hotelId, "pag", [row.data_recebimento, row.nsu_cv, row.bandeira, g("parcela"), row.valor_liquido_parcela, row.status], occ) };
  });

  const recebidos = sheetRows(byName("recebidos"), "valor depositado").map<RedeRecebido>((g) => {
    const row = {
      hotel_id: hotelId, data: date(g("data")), bandeira: txt(g("bandeira")), modalidade: txt(g("modalidade")),
      valor_depositado: num(g("valor depositado")), status: txt(g("status")),
    };
    return { ...row, entry_key: key(hotelId, "rec", [row.data, row.bandeira, row.modalidade, g("negociadas"), row.valor_depositado, row.status], occ) };
  });

  const ajustes = sheetRows(byName("ajustes"), "data do ajuste").map<RedeAjuste>((g) => {
    const row = {
      hotel_id: hotelId, data_ajuste: date(g("data do ajuste")), motivo: txt(g("motivo")),
      valor_cobrado: num(g("valor cobrado nesta data")), bandeira: txt(g("bandeira ajustada")),
    };
    return { ...row, entry_key: key(hotelId, "aj", [row.data_ajuste, g("ID ajuste"), row.motivo, row.bandeira, row.valor_cobrado], occ) };
  });

  const chargebacks = sheetRows(byName("cancelamentos e contestações"), "data do débito").map<RedeChargeback>((g) => {
    const row = {
      hotel_id: hotelId, data_debito: date(g("data do débito")), tipo: txt(g("cancelamento/chargeback")),
      data_original_venda: date(g("data original da venda")), valor_original_venda: num(g("valor original da venda")),
      valor_descontado: num(g("valor descontado")), motivo_cancelamento: txt(g("motivo do cancelamento")),
      nsu_cv: txt(g("NSU/CV")), bandeira: txt(g("bandeira da venda")), modalidade: txt(g("modalidade da venda")),
    };
    return { ...row, entry_key: key(hotelId, "cb", [row.data_debito, row.nsu_cv, row.tipo, row.valor_descontado], occ) };
  });

  return { pagamentos, recebidos, ajustes, chargebacks };
}

export async function parseRedeRecebimentosExcel(file: File, hotelId: string) {
  const wb = XLSX.read(await file.arrayBuffer(), { type: "array", cellDates: true });
  const sheets: Record<string, unknown[][]> = {};
  for (const n of wb.SheetNames) {
    sheets[n] = XLSX.utils.sheet_to_json(fixSheetRef(wb.Sheets[n]), { header: 1, blankrows: false, defval: null, raw: true });
  }
  return parseRedeRecebimentosSheets(sheets, hotelId);
}

/** Linha de tarifa diária: MDR da Rede + taxa de adquirência B2B + demais ajustes da Rede. */
export interface TarifaDia { date: string; rede_mdr: number; b2b: number; ajustes: number; total: number }

export function buildTarifas(
  pagamentos: { data_recebimento: string | null; valor_mdr: number | null }[],
  b2b: { data_operacao: string | null; valor_taxa_adquirencia: number | null }[],
  ajustes: { data_ajuste: string | null; motivo: string | null; valor_cobrado: number | null }[],
): TarifaDia[] {
  const m = new Map<string, TarifaDia>();
  const add = (d: string | null, f: "rede_mdr" | "b2b" | "ajustes", v: number | null) => {
    if (!d || v == null) return;
    const r = m.get(d) ?? { date: d, rede_mdr: 0, b2b: 0, ajustes: 0, total: 0 };
    r[f] += Math.abs(Number(v)); r.total += Math.abs(Number(v));
    m.set(d, r);
  };
  pagamentos.forEach((p) => add(p.data_recebimento, "rede_mdr", p.valor_mdr));
  b2b.forEach((b) => add(b.data_operacao, "b2b", b.valor_taxa_adquirencia));
  ajustes.filter((a) => !isAntecipacao(a.motivo)).forEach((a) => add(a.data_ajuste, "ajustes", a.valor_cobrado));
  return [...m.values()].sort((a, b) => a.date.localeCompare(b.date));
}
