import { describe, expect, it } from "vitest";
import { missingBankPayments } from "@/lib/paidBankVerification";

const invoice = { id: "invoice", hotel_id: "hotel", paid_date: "2026-09-21", amount: 253.26 };
const bank = [{ hotel_id: "hotel", line_date: "2026-09-21", amount: 1919.4 }];
describe("boleto confirmado no crédito agregado", () => {
  it("aceita R$253,26 dentro do lote bancário validado de R$1.919,40", () => {
    expect(missingBankPayments([invoice], bank, [{ ar_id: "invoice", hotel_id: "hotel", credit_date: "2026-09-21" }]).size).toBe(0);
  });
  it("mantém a divergência sem vínculo validado", () => {
    expect(missingBankPayments([invoice], bank, []).has("invoice")).toBe(true);
  });
  it("exige a data em que caiu no banco", () => {
    expect(missingBankPayments([invoice], bank, [{ ar_id: "invoice", hotel_id: "hotel", credit_date: "2026-09-20" }]).has("invoice")).toBe(true);
  });
  it("não aceita o vínculo de outro hotel", () => {
    expect(missingBankPayments([invoice], bank, [{ ar_id: "invoice", hotel_id: "outro", credit_date: "2026-09-21" }]).has("invoice")).toBe(true);
  });
  it("não aceita débito como recebimento", () => {
    expect(missingBankPayments([invoice], [{ ...bank[0], amount: -253.26 }], []).has("invoice")).toBe(true);
  });
});