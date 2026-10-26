import { describe, expect, it, vi } from "vitest";
import { reconcileUntilStable } from "@/lib/autoReconcile";

describe("conciliação completa pós-importação", () => {
  it("executa outra passagem N:1 depois da primeira e para somente sem novos matches", async () => {
    const pass = vi.fn().mockResolvedValueOnce(2).mockResolvedValueOnce(1).mockResolvedValueOnce(0);
    expect(await reconcileUntilStable(pass)).toBe(3);
    expect(pass).toHaveBeenCalledTimes(3);
  });
  it("não apresenta falha como zero conciliações", async () => {
    const pass = vi.fn().mockRejectedValue(new Error("timeout"));
    await expect(reconcileUntilStable(pass)).rejects.toThrow("timeout");
  });
});