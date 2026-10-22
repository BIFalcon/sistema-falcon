import { describe, it, expect } from "vitest";
import { isCashBankLine } from "@/lib/conciliacaoParsers";

const HOTEL = "60.498.259/0001-36";
describe("extrato na aba Dinheiro", () => {
  it("aceita depósitos em dinheiro", () => {
    for (const d of ["DEP DIN CX AG 1234", "DEP DIN ATM N. 123456789", "DN 0001", "Depósito em dinheiro", "DINHEIRO"])
      expect(isCashBankLine(d, null, HOTEL)).toBe(true);
  });
  it("aceita boleto só com o CNPJ do próprio hotel", () => {
    expect(isCashBankLine("BOLETOS RECEBIDOS 12/10S", "60498259000136", HOTEL)).toBe(true);
    expect(isCashBankLine("BOLETOS RECEBIDOS 12/10S", "07.138.437/0001-35", HOTEL)).toBe(false);
    expect(isCashBankLine("BOLETOS RECEBIDOS 12/10S", null, HOTEL)).toBe(false);
  });
  it("descarta o resto do extrato", () => {
    for (const d of ["PIX RECEBIDO FULANO", "RECEBIMENTO REDE MAST DB0086870238", "ZOOP MAST CD123", "TED RECEBIDA 341.1234", "RENDIMENTOS REND PAGO APLIC AUT", "DEPRECIACAO"])
      expect(isCashBankLine(d, null, HOTEL)).toBe(false);
  });
});
