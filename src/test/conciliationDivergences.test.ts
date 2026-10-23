import { describe, it, expect } from "vitest";
import { canSendDivergences, divergenceCount, divergenceLink } from "@/lib/conciliationDivergences";

describe("divergências do hotel", () => {
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