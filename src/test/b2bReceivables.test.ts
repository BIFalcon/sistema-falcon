import { describe, it, expect } from "vitest";
import { parseB2BReceivablesGrid } from "@/lib/conciliacaoParsers";
import { isB2BBankLine } from "@/lib/b2bBaixa";

const header = ["Data da operação","Tipo do lançamento","Descrição","Valor total da transação","Valor pago em comissão","Valor pago em incentivo","Valor taxa de serviço B2B","Valor do recebível bruto","Valor taxa de adquirência","Valor do recebível líquido","Chave da transação","NSU Autorização","Data da transação","Identificador do pedido","Forma de pagamento","Bandeira do cartão","Número do cartão","Localizador da reserva"];

describe("recebimentos B2B", () => {
  it("lê charge e deposit com localizador e valor líquido", () => {
    const grid = [header,
      ["10/10/2026","charge","Venda","500,00","10","0","5","485","15","470,00","K1","123","09/09/2026","P1","Crédito","Visa","****1234","RES-9"],
      ["10/10/2026","deposit","Lote","","","","","","","470,00","","","","","","","",""],
      ["10/10/2026","refund","x","","","","","","","1","","","","","","","",""]];
    const { rows, skipped } = parseB2BReceivablesGrid(grid, "h1");
    expect(rows).toHaveLength(2);
    expect(skipped).toBe(1);
    expect(rows[0]).toMatchObject({ tipo_lancamento: "charge", localizador_reserva: "RES-9", valor_recebivel_liquido: 470, data_operacao: "2026-10-10" });
    expect(rows[1].tipo_lancamento).toBe("deposit");
  });
  it("filtro do banco aceita só descrições ZOP", () => {
    expect(isB2BBankLine("ZOP VISA 123")).toBe(true);
    expect(isB2BBankLine("PIX RECEBIDO")).toBe(false);
  });
});
