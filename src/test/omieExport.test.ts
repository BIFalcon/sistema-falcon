import { describe, it, expect } from "vitest";
import { vencimentoPorPrazo, vencimentoB2B } from "@/lib/omieExport";

describe("vencimento OMIE", () => {
  it("no mesmo dia = mesma data", () => expect(vencimentoPorPrazo("2026-10-05", "no mesmo dia")).toBe("2026-10-05"));
  it("disponível em D+1 = +1 dia", () => expect(vencimentoPorPrazo("2026-10-05", "disponível em D+1")).toBe("2026-10-06"));
  it("1 dia útil pula o fim de semana", () => expect(vencimentoPorPrazo("2026-10-09", "1 dia útil")).toBe("2026-10-12"));
  it("31 dias = +31 dias corridos", () => expect(vencimentoPorPrazo("2026-10-05", "31 dias")).toBe("2026-11-05"));
  it("B2B = 31 dias da venda", () => expect(vencimentoB2B("2026-09-30")).toBe("2026-10-31"));
});
