import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import * as XLSX from "xlsx";
import { buildTarifas, isAntecipacao, parseRedeRecebimentosSheets } from "@/lib/redeRecebimentos";
import { parseB2BReceivablesGrid } from "@/lib/conciliacaoParsers";

const grids = (p: string) => {
  const wb = XLSX.read(readFileSync(p), { type: "buffer", cellDates: true });
  return Object.fromEntries(wb.SheetNames.map((n) => [n, XLSX.utils.sheet_to_json(wb.Sheets[n], { header: 1, blankrows: false, defval: null, raw: true }) as unknown[][]]));
};

describe("relatório de recebimentos Rede (arquivo real, set/2026)", () => {
  const p = parseRedeRecebimentosSheets(grids("src/test/fixtures/rede_recebimentos_sample.xlsx"), "h1");
  it("lê as quatro abas prioritárias", () => {
    expect(p.pagamentos).toHaveLength(886);
    expect(p.recebidos).toHaveLength(70);
    expect(p.ajustes).toHaveLength(26);
    expect(p.chargebacks).toHaveLength(1);
  });
  it("chargeback vem da aba de cancelamentos, com NSU para achar a venda", () => {
    expect(p.chargebacks[0]).toMatchObject({ data_debito: "2026-09-30", nsu_cv: "45046002", valor_descontado: 27.34, bandeira: "Mastercard" });
  });
  it("antecipação = motivo 'taxa de antecipação'; demais ajustes vão para Tarifas", () => {
    expect(p.ajustes.filter((a) => isAntecipacao(a.motivo))).toHaveLength(25);
    const t = buildTarifas([], [], p.ajustes);
    expect(t.reduce((s, d) => s + d.ajustes, 0)).toBeCloseTo(27.34, 2);
  });
  it("recebidos já vêm somados por dia+bandeira+modalidade", () => {
    expect(p.recebidos.find((r) => r.data === "2026-09-01" && r.bandeira === "Elo" && r.modalidade === "Débito")?.valor_depositado).toBe(423.5);
  });
  it("chaves únicas: reimportar o mesmo arquivo não duplica", () => {
    const keys = [...p.pagamentos, ...p.recebidos, ...p.ajustes, ...p.chargebacks].map((r) => r.entry_key);
    expect(new Set(keys).size).toBe(keys.length);
    const again = parseRedeRecebimentosSheets(grids("src/test/fixtures/rede_recebimentos_sample.xlsx"), "h1");
    expect(again.recebidos.map((r) => r.entry_key)).toEqual(p.recebidos.map((r) => r.entry_key));
  });
});

describe("transferência B2B (arquivo real)", () => {
  it("lê o depósito e as vendas", () => {
    const g = grids("src/test/fixtures/b2b_transfer_sample.xlsx");
    const { rows } = parseB2BReceivablesGrid(g[Object.keys(g)[0]], "h1");
    expect(rows.filter((r) => r.tipo_lancamento === "deposit")[0].valor_recebivel_liquido).toBe(-797.19);
    expect(rows.find((r) => r.localizador_reserva === "24535191")?.valor_taxa_adquirencia).toBe(6.53);
  });
});
