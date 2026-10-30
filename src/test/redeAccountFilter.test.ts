import { describe, it, expect } from "vitest";
import { filterRedeByAccount, type RedeRecebimentosParsed } from "@/lib/redeRecebimentos";

const pag = (conta: string, v: number, nsu: string) => ({ entry_key: nsu, hotel_id: "h", data_recebimento: "2026-10-29", data_original_venda: null, data_original_vencimento: null, valor_bruto_parcela_original: v, valor_bruto_parcela_atualizada: v, taxa_mdr: null, valor_mdr: null, valor_liquido_parcela: v, nsu_cv: nsu, modalidade: "Débito", bandeira: "Visa", banco: null, agencia: null, conta_corrente: conta, status: null });
const rec = (v: number) => ({ entry_key: String(v), hotel_id: "h", data: "2026-10-29", bandeira: "Visa", modalidade: "Débito", valor_depositado: v, status: null });

describe("filtro da Rede pela conta do hotel", () => {
  const parsed: RedeRecebimentosParsed = {
    pagamentos: [pag("98411-7", 2.97, "1"), pag("98411-7", 6.93, "2"), pag("982434", 527.39, "3"), pag("925188", 5, "4")],
    recebidos: [rec(9.9), rec(527.39), rec(5)], ajustes: [],
    chargebacks: [{ entry_key: "c", hotel_id: "h", data_debito: null, tipo: null, data_original_venda: null, valor_original_venda: null, valor_descontado: 1, motivo_cancelamento: null, nsu_cv: "3", bandeira: null, modalidade: null }],
  };
  const { parsed: out, skipped } = filterRedeByAccount(parsed, { own: ["98411-7"], foreign: ["98243-4"] });
  it("descarta parcelas, lote e cancelamento de outro hotel", () => {
    expect(out.pagamentos.map((p) => p.nsu_cv)).toEqual(["1", "2", "4"]);
    expect(out.recebidos.map((r) => r.valor_depositado)).toEqual([9.9, 5]);
    expect(out.chargebacks).toHaveLength(0);
    expect(skipped).toBe(3);
  });
});
