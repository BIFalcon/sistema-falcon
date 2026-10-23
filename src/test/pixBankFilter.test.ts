import { describe, it, expect } from "vitest";
import { isPixBankLine } from "@/lib/pixBankFilter";
describe("extrato PIX", () => {
  it("aceita PIX", () => expect(isPixBankLine("PIX QR CODE RECEBIDO")).toBe(true));
  it("inclui recebidos", () => expect(isPixBankLine("recebidos CLIENTE")).toBe(true));
  it("inclui recebimentos", () => expect(isPixBankLine("RECEBIMENTOS")).toBe(true));
  it("exclui boletos recebidos", () => expect(isPixBankLine("BOLETOS RECEBIDOS 03/09S")).toBe(false));
  it("exclui boleto mesmo com PIX na descrição", () => expect(isPixBankLine("BOLETO PIX RECEBIDO")).toBe(false));
  it("não considera créditos de ZOOP como PIX", () => expect(isPixBankLine("ZOOP MAST CD1359230024")).toBe(false));
});