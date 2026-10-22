import * as XLSX from "xlsx";
import { fixSheetRef, hashKey, makeOccCounter, normText, parseMoney, toIso } from "./conciliacaoParsers";

export type FrancesinhaAcao = "liquidacao" | "baixa" | "entrada" | "ajuste" | "outro";

/**
 * Mapeamento "Descrição de Operações" → ação do sistema.
 * A CONFIRMAR COM BÁRBARA: se ela validar diferente, mude só este switch.
 */
export function classifyFrancesinha(descricao: unknown): FrancesinhaAcao {
  const d = normText(descricao);
  if (d.startsWith("LIQUIDACAO")) return "liquidacao";
  if (d === "BAIXA" || d.startsWith("BAIXA ")) return "baixa";
  if (d.startsWith("ENTRADA")) return "entrada";
  if (d.includes("TARIFA") || d.includes("JUROS")) return "ajuste";
  return "outro";
}

export interface FrancesinhaRow {
  entry_key: string; hotel_id: string;
  data_movimento: string | null; carteira: string | null; pagador: string | null; tipo: string | null;
  nosso_numero: string | null; seu_numero: string | null; vencimento: string | null; agencia_receb: string | null;
  valor_inicial: number | null; descricao_operacao: string | null; operacoes_valor: string | null;
  valor_final: number | null; acao: FrancesinhaAcao;
}

const empty = (v: unknown) => v == null || ["", "-", "null"].includes(String(v).trim().toLowerCase());
const txt = (v: unknown) => (empty(v) ? null : String(v).trim());
const num = (v: unknown) => (empty(v) ? null : parseMoney(v));

/** Uma aba por data de movimento; pula o resumo e lê a partir do cabeçalho "Carteira". */
export function parseFrancesinhaSheets(sheets: Record<string, unknown[][]>, hotelId: string): FrancesinhaRow[] {
  const occ = makeOccCounter();
  const out: FrancesinhaRow[] = [];
  let found = false;
  for (const [name, grid] of Object.entries(sheets)) {
    const hi = grid.findIndex((r) => normText((r ?? [])[0]) === "CARTEIRA");
    if (hi === -1) continue;
    found = true;
    const header = (grid[hi] ?? []).map((c) => normText(c));
    const col = (n: string) => header.findIndex((h) => h.startsWith(normText(n)));
    const ix = {
      carteira: col("Carteira"), pagador: col("Pagador"), tipo: col("Tipo"), nosso: col("Nosso Número"),
      seu: col("Seu Número"), venc: col("Vencimento"), ag: col("Agência Receb"), vi: col("Valor Inicial"),
      desc: col("Descrição de Operações"), ov: col("Operações Valor"), vf: col("Valor Final"),
    };
    const movRow = grid.slice(0, hi).find((r) => normText((r ?? [])[0]) === "DATA MOVIMENTACAO");
    const dataMov = toIso(movRow?.[1]) || toIso(name) || null;
    const parents = new Map<string, FrancesinhaRow>();
    for (const r of grid.slice(hi + 1)) {
      const g = (i: number) => (i === -1 ? null : r[i]);
      const desc = txt(g(ix.desc));
      if (!desc) continue;
      const nosso = txt(g(ix.nosso));
      const parent = nosso ? parents.get(nosso) : undefined;
      const row: Omit<FrancesinhaRow, "entry_key"> = {
        hotel_id: hotelId, data_movimento: dataMov,
        carteira: txt(g(ix.carteira)), pagador: txt(g(ix.pagador)) ?? parent?.pagador ?? null,
        tipo: txt(g(ix.tipo)) ?? parent?.tipo ?? null, nosso_numero: nosso,
        seu_numero: txt(g(ix.seu)) ?? parent?.seu_numero ?? null,
        vencimento: (empty(g(ix.venc)) ? null : toIso(g(ix.venc)) || null) ?? parent?.vencimento ?? null,
        agencia_receb: txt(g(ix.ag)), valor_inicial: num(g(ix.vi)) ?? parent?.valor_inicial ?? null,
        descricao_operacao: desc, operacoes_valor: txt(g(ix.ov)), valor_final: num(g(ix.vf)),
        acao: classifyFrancesinha(desc),
      };
      const base = [hotelId, "franc", dataMov, nosso, desc, row.operacoes_valor, row.valor_final].join("|");
      const full = { ...row, entry_key: hashKey([base, occ(base)]) };
      if (nosso && !parent && txt(g(ix.pagador))) parents.set(nosso, full);
      out.push(full);
    }
  }
  if (!found) throw new Error("Francesinha não reconhecida: nenhuma aba com o cabeçalho 'Carteira'.");
  return out;
}

export async function parseFrancesinhaExcel(file: File, hotelId: string) {
  const wb = XLSX.read(await file.arrayBuffer(), { type: "array", cellDates: true });
  const sheets: Record<string, unknown[][]> = {};
  for (const n of wb.SheetNames) sheets[n] = XLSX.utils.sheet_to_json(fixSheetRef(wb.Sheets[n]), { header: 1, blankrows: false, defval: null, raw: true });
  return parseFrancesinhaSheets(sheets, hotelId);
}
