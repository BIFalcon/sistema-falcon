import { describe, it, expect } from "vitest";
import { validateDreFileName } from "@/lib/dreFileName";

describe("validateDreFileName", () => {
  it("aceita o padrão correto", () => {
    expect(validateDreFileName("Ibis Serra Talhada 10.2026.xlsx", "Ibis Serra Talhada", 10, 2026)).toBeNull();
  });
  it("bloqueia outro hotel", () => {
    expect(validateDreFileName("Ibis Confins 10.2026.xlsx", "Ibis Serra Talhada", 10, 2026)).toMatch(/outro hotel/);
  });
  it("bloqueia outro mês", () => {
    expect(validateDreFileName("Ibis Serra Talhada 09.2026.xlsx", "Ibis Serra Talhada", 10, 2026)).toMatch(/outro mês/);
  });
  it("bloqueia fora do padrão", () => {
    expect(validateDreFileName("DRE outubro.xlsx", "Ibis Serra Talhada", 10, 2026)).toMatch(/fora do padrão/);
  });
});
