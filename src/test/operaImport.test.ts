import { describe, expect, it } from "vitest";
import { parseOperaXml } from "@/lib/conciliacaoParsers";

const row = (name: string, trx = "426546073", code = "9142", amount = "645.66") => `<ROW><TRX_CODE>${code}</TRX_CODE><TRX_NO>${trx}</TRX_NO><CASHIER_CREDIT>${amount}</CASHIER_CREDIT><BUSINESS_FORMAT_DATE>03/09/2026</BUSINESS_FORMAT_DATE><ROOM>668</ROOM><RECEIPT_NO>#33704</RECEIPT_NO><GUEST_FULL_NAME>${name}</GUEST_FULL_NAME></ROW>`;
const parse = (xml: string, hotel = "ibis-budget-divinopolis") => parseOperaXml({ text: async () => `<REPORT>${xml}</REPORT>` } as File, hotel, new Set(["9142", "9152"]));

describe("Opera import identity", () => {
  it("identifies Divinópolis 03/09 code 9142 by TRX_NO despite a changed name", async () => {
    const old = await parse(row("Francia Maia Athadeu,Arthur,Mr."));
    const next = await parse(row("Athadeu,Arthur Francia Maia"));
    expect(next.rows[0].entry_key).toBe("ibis-budget-divinopolis|opera|trx|426546073");
    expect(next.rows[0].entry_key).toBe(old.rows[0].entry_key);
    expect(next.rows[0].amount).toBe(645.66);
    expect(next.rows[0].legacy_entry_key).not.toBe(old.rows[0].legacy_entry_key);
  });
  it("keeps the Divinópolis 04/09 code 9152 transaction number stable", async () => {
    const result = await parse(row("Soares,Henrique,Mr.", "426959110.0", "9152", "242.07").replace("03/09/2026", "04/09/2026"));
    expect(result.rows[0].entry_key).toBe("ibis-budget-divinopolis|opera|trx|426959110");
    expect(result.rows[0].business_date).toBe("2026-09-04");
    expect(result.rows[0].amount).toBe(242.07);
  });
  it("preserves distinct TRX_NO with the same date, code, amount and name", async () => {
    const result = await parse(row("Arthur", "426546073") + row("Arthur", "426546074"));
    expect(new Set(result.rows.map(r => r.entry_key)).size).toBe(2);
  });
  it("gives repeated TRX_NO the same identity even with asterisk or titles", async () => {
    const result = await parse(row("Arthur") + row("*Arthur,Mr."));
    expect(new Set(result.rows.map(r => r.entry_key)).size).toBe(1);
  });
  it("scopes the same TRX_NO to its hotel", async () => {
    const a = await parse(row("Arthur"));
    const b = await parse(row("Arthur"), "ibis-caruaru");
    expect(a.rows[0].entry_key).not.toBe(b.rows[0].entry_key);
  });
  it("retains occurrence identity for genuine repeated rows without TRX_NO", async () => {
    const result = await parse(row("Arthur", "") + row("Arthur", ""));
    expect(result.rows[0].entry_key).not.toBe(result.rows[1].entry_key);
    expect(result.rows[0].entry_key).toBe(result.rows[0].legacy_entry_key);
  });
  it("preserves negative reversal amounts", async () => {
    const result = await parse(row("Arthur", "426546075", "9142", "-645.66"));
    expect(result.rows[0].amount).toBe(-645.66);
  });
});