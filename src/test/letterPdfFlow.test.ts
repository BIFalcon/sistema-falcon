import { describe, expect, it } from "vitest";
import { requireLetterPdfBlob } from "@/lib/letterPdfFlow";

describe("geração obrigatória da carta", () => {
  it("entrega somente o PDF recém-gerado", async () => {
    const blob = new Blob(["%PDF-1.4"], { type: "application/pdf" });
    expect(await requireLetterPdfBlob(async () => blob)).toBe(blob);
  });

  it("interrompe o fluxo quando a geração retorna null", async () => {
    await expect(requireLetterPdfBlob(async () => null)).rejects.toThrow();
  });

  it("interrompe o fluxo quando o PDF está vazio", async () => {
    await expect(requireLetterPdfBlob(async () => new Blob())).rejects.toThrow();
  });

  it("preserva a falha de geração para o aviso ao usuário", async () => {
    const error = new Error("Falha ao gerar os gráficos");
    await expect(requireLetterPdfBlob(async () => { throw error; })).rejects.toBe(error);
  });
});