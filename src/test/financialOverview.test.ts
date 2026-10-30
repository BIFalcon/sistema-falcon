import { describe, expect, it } from "vitest";
import { agingBand, AUTOMATIC_CARD_HOTELS, cardTermDays, effectiveFinancialHotels, expectedCardDate, financialOverviewReadonly, FINANCIAL_OVERVIEW_ROLES, inFinancialPeriod, totalFinancialReceivable, financialNetBalance, financialDetailPath } from "@/lib/financialOverview";

describe("financial overview blocks 1–3", () => {
  it("allows GOP and ADM overview roles", () => {
    expect(FINANCIAL_OVERVIEW_ROLES).toContain("gop");
    expect(FINANCIAL_OVERVIEW_ROLES).toContain("adm");
  });
  it("GOP cannot edit even when combined with a managing role", () => {
    expect(financialOverviewReadonly(["gop", "controladoria"])).toBe(true);
  });
  it("ADM cannot edit", () => expect(financialOverviewReadonly(["adm"])).toBe(true));
  it("intersects multi selection with authorization and GOP portfolio", () => {
    expect(effectiveFinancialHotels(["a", "b"], ["a", "b", "secret"], null, ["b"])).toEqual(["b"]);
  });
  it("keeps ADM single selection despite persisted multi values", () => {
    expect(effectiveFinancialHotels(["a", "b"], ["a", "b"], "b", null, true)).toEqual(["b"]);
  });
  it("exact days override range and exclude intervening days", () => {
    const p = { dateFrom: "2026-10-01", dateTo: "2026-10-31", specificDates: ["2026-10-04", "2026-10-09"] };
    expect(inFinancialPeriod("2026-10-05", p)).toBe(false);
    expect(inFinancialPeriod("2026-10-09", p)).toBe(true);
  });
  it("automatic coverage contains the ten agreed hotels", () => {
    expect(AUTOMATIC_CARD_HOTELS).toHaveLength(10);
    expect(AUTOMATIC_CARD_HOTELS).toContain("ibis-budget-patos");
    expect(AUTOMATIC_CARD_HOTELS).toContain("ibis-styles-tres-rios");
  });
  it("Rede uses report numeric term text", () => {
    expect(expectedCardDate("2026-10-29", "rede", "2  dias")).toBe("2026-10-31");
    expect(cardTermDays("31  dias cada parcela")).toBe(31);
    expect(cardTermDays("disponível em D+1")).toBe(1);
  });
  it("missing and nonnumeric Rede terms are excluded", () => {
    expect(expectedCardDate("2026-10-29", "rede", null)).toBeNull();
    expect(expectedCardDate("2026-10-29", "rede", "Cancelado")).toBeNull();
    expect(cardTermDays("no mesmo dia")).toBeNull();
  });
  it("B2B always uses 31 calendar days", () => expect(expectedCardDate("2026-10-29", "b2b", null)).toBe("2026-11-29"));
  it("aging less than seven days excludes seven", () => {
    expect(agingBand(6)).toBe("lt7"); expect(agingBand(7)).not.toBe("lt7");
  });
  it("aging seven through thirty includes both boundaries", () => {
    expect(agingBand(7)).toBe("d7_30"); expect(agingBand(30)).toBe("d7_30");
  });
  it("aging over thirty starts on day thirty one", () => expect(agingBand(31)).toBe("gt30"));
});

describe("financial overview blocks 4–6", () => {
  it("total a receber soma exatamente faturamento, PIX, cartão e dinheiro", () => {
    expect(totalFinancialReceivable({ invoice: 100, pix: 20, card: 30, cash: 4 })).toBe(154);
  });
  it("saldo líquido adiciona total a receber sem duplicar Open Folio", () => {
    expect(financialNetBalance(1000, 200, 50, 154)).toBe(1004);
  });
  it("inadimplência abre faturamento com hotel e filtro corretos", () => {
    expect(financialDetailPath("defaulting", "ibis-serra-talhada")).toBe("/financeiro/contas-receber?hotel=ibis-serra-talhada&status=inadimplente");
  });
  it("pagamentos em atraso abre filtro de atrasados", () => {
    expect(financialDetailPath("overdue", "ibis-serra-talhada")).toBe("/financeiro/contas-pagar?hotel=ibis-serra-talhada&status=atrasados");
  });
  it("Open Folio não abre faturamento", () => expect(financialDetailPath("folio")).toBe("/financeiro/contas-receber?aba=open_folio"));
  it("origens distintas abrem conciliação sem perder o hotel", () => {
    expect(financialDetailPath("opera", "hotel")).toBe("/financeiro/contas-receber?hotel=hotel&aba=conciliacao&origem=opera");
    expect(financialDetailPath("acquirer", "hotel")).toBe("/financeiro/contas-receber?hotel=hotel&aba=conciliacao&origem=acquirer");
  });
});