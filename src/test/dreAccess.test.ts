import { describe, expect, it } from "vitest";
import { DRE_INDICATOR_ROLES, isDreSummaryOnly, resolveDreTab, scopeDreHotelIds, canAccessNovosNegociosPath, isNovosNegociosOnly } from "@/lib/dreAccess";

describe("ADM Indicadores DRE", () => {
  it("permits ADM access to the indicators module", () => {
    expect(DRE_INDICATOR_ROLES).toContain("adm");
  });
  it("restricts ADM to Resumo even with direct tab URLs", () => {
    expect(isDreSummaryOnly(["adm"], false)).toBe(true);
    expect(resolveDreTab("comparativo", true)).toBe("resumo");
    expect(resolveDreTab("historico", true)).toBe("resumo");
  });
  it("only selects a linked hotel, discarding stale or tampered filters", () => {
    expect(scopeDreHotelIds(["other", "linked"], "other", ["linked"], true)).toEqual(["linked"]);
    expect(scopeDreHotelIds(["other"], "other", ["linked"], true)).toEqual(["linked"]);
    expect(scopeDreHotelIds(["other"], null, [], true)).toEqual([]);
  });
  it("allows ADMs with multiple links to choose one of their hotels", () => {
    expect(scopeDreHotelIds([], "second", ["first", "second"], true)).toEqual(["second"]);
    expect(scopeDreHotelIds(["first", "second"], null, ["first", "second"], true)).toEqual(["first"]);
  });
  it("preserves existing access granted by other authorized roles", () => {
    expect(isDreSummaryOnly(["adm", "gg"], false)).toBe(false);
    expect(isDreSummaryOnly(["adm"], true)).toBe(false);
    expect(resolveDreTab("historico", false)).toBe("historico");
    expect(scopeDreHotelIds(["first", "second"], null, ["first", "second"], false)).toEqual(["first", "second"]);
  });
});

describe("Novos Negócios", () => {
  it("allows all three indicators tabs", () => {
    expect(DRE_INDICATOR_ROLES).toContain("novos_negocios");
    expect(isDreSummaryOnly(["novos_negocios"], false)).toBe(false);
    for (const tab of ["resumo", "comparativo", "historico"]) expect(resolveDreTab(tab, false)).toBe(tab);
  });
  it("allows DRE and blocks all other business modules including direct URLs", () => {
    expect(isNovosNegociosOnly(["novos_negocios"])).toBe(true);
    expect(canAccessNovosNegociosPath("/fechamento/dre")).toBe(true);
    expect(canAccessNovosNegociosPath("/indicadores")).toBe(true);
    for (const path of ["/fechamento", "/fechamento/carta", "/fechamento/financeiro", "/fechamento/envio", "/financeiro", "/rh/custo-folha", "/investidores", "/configuracoes/usuarios", "/metas", "/controladoria"]) expect(canAccessNovosNegociosPath(path)).toBe(false);
  });
  it("permits selection across all accessible hotels", () => {
    expect(scopeDreHotelIds(["a", "b"], null, ["a", "b"], false)).toEqual(["a", "b"]);
  });
});