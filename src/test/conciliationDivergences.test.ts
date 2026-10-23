import { describe, it, expect } from "vitest";
import { canSendDivergences, divergenceCount, divergenceLink, selectedDivergenceTotals } from "@/lib/conciliationDivergences";

describe("divergências do hotel", () => {
  const items = [
    { id: "same", side: "opera", kind: "cartao", date: null, amount: 200, title: "Venda", subtitle: null, tag: null },
    { id: "same", side: "acquirer", kind: "cartao", date: null, amount: -50, title: "Estorno", subtitle: null, tag: null },
    { id: "invoice", side: "invoice", kind: "inadimplente", date: null, amount: 300, title: "Faturamento", subtitle: null, tag: null },
  ];
  it("soma somente as pendências selecionadas, com identidade por origem", () => {
    expect(selectedDivergenceTotals(items, new Set(["opera:same", "invoice:invoice"]))).toEqual({ count: 2, amount: 500 });
  });
  it("selecionar todas mantém estornos negativos no total", () => {
    expect(selectedDivergenceTotals(items, new Set(["opera:same", "acquirer:same", "invoice:invoice"]))).toEqual({ count: 3, amount: 450 });
  });
  it("inclui cartão, PIX, dinheiro e inadimplência no total", () => {
    expect(divergenceCount({ hotel_id: "hotel", hotel_name: "Hotel", cartao: 2, pix: 3, dinheiro: 4, inadimplente: 5 })).toBe(14);
  });
  it("leva diretamente à justificativa do hotel", () => {
    const url = new URL(divergenceLink("hotel & filial"), "https://example.test");
    expect(url.searchParams.get("hotel")).toBe("hotel & filial");
    expect(url.searchParams.get("aba")).toBe("conciliacao");
    expect(url.searchParams.get("divergencias")).toBe("1");
  });
  it("GG e ADM justificam, sem receber permissão de envio", () => {
    expect(canSendDivergences(false, ["gg", "adm"])).toBe(false);
  });
  it("equipe de conciliação pode enviar", () => {
    for (const role of ["controladoria", "patronos", "fernando", "financeiro"]) expect(canSendDivergences(false, [role])).toBe(true);
    expect(canSendDivergences(true, [])).toBe(true);
  });
});