import { describe, it, expect } from "vitest";
import { canConfirmTransit } from "@/lib/transitConfirmation";
describe("Confirmação explícita do crédito", () => {
  it("exige a soma completa até o centavo", () => {
    expect(canConfirmTransit(2, 712.41, 712.42, "Comprovante conferido")).toBe(false);
    expect(canConfirmTransit(2, 712.42, 712.42, "Comprovante conferido")).toBe(true);
  });
  it("não libera sem recebimentos selecionados", () => expect(canConfirmTransit(0, 712.42, 712.42, "Comprovante conferido")).toBe(false));
  it("exige justificativa explícita", () => expect(canConfirmTransit(2, 712.42, 712.42, " ")).toBe(false));
});