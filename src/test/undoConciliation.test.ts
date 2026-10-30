import { describe, expect, it, vi } from "vitest";
import { undoConciliation } from "@/lib/undoConciliation";

describe("desfazer atômico", () => {
  it("libera todos os lados por um único comando com o identificador do vínculo", async () => {
    const execute = vi.fn().mockResolvedValue({ data: true, error: null });
    await undoConciliation("pix-match", execute);
    expect(execute.mock.calls).toEqual([["pix-match"]]);
  });
  it("não confirma sucesso quando a liberação falha", async () => {
    await expect(undoConciliation("card-match", async () => ({ data: null, error: new Error("timeout") }))).rejects.toThrow("timeout");
  });
  it("não confirma sucesso sem confirmação do banco", async () => {
    await expect(undoConciliation("cash-match", async () => ({ data: false, error: null }))).rejects.toThrow("confirmar");
  });
});