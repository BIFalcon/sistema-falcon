import { describe, expect, it } from "vitest";
import * as XLSX from "xlsx";
import { parseAcquirerExcel } from "@/lib/conciliacaoParsers";

function report(status: string, cancelled: string, bandeira = "-", modalidade = "pix") {
  const wb = XLSX.utils.book_new();
  const ws = XLSX.utils.aoa_to_sheet([
    ["Vendas Rede"],
    ["Status da venda", "Valor da venda atualizado", "Data da venda", "Bandeira", "Modalidade", "Nome do estabelecimento", "Cancelada pelo estabelecimento"],
    [status, 252, "01/09/2026", bandeira, modalidade, "IBIS SERRA TALHADA", cancelled],
  ]);
  XLSX.utils.book_append_sheet(wb, ws, "Vendas");
  const bytes = XLSX.write(wb, { type: "array", bookType: "xlsx" }) as ArrayBuffer;
  return { name: "vendas.xlsx", arrayBuffer: async () => bytes } as File;
}

describe("vendas PIX da Rede", () => {
  it("não importa PIX expirado mesmo marcado como cancelado pelo estabelecimento", async () => {
    const result = await parseAcquirerExcel(report("expirado", "Sim"), [], { id: "ibis-serra-talhada" });
    expect(result.rows).toHaveLength(0);
    expect(result.skipped).toBe(1);
  });
  it("preserva PIX pago, valor e categoria PIX", async () => {
    const result = await parseAcquirerExcel(report("pago", "Não"), [], { id: "ibis-serra-talhada" });
    expect(result.rows).toHaveLength(1);
    expect(result.rows[0].amount).toBe(252);
    expect(result.rows[0].categoria).toBe("PIX");
    expect(result.rows[0].status).toBe("pago");
  });
  it("mantém cancelamentos de cartão para ajustes de reimportação", async () => {
    const result = await parseAcquirerExcel(report("cancelada", "Sim", "Visa", "Crédito"), [], { id: "hotel" });
    expect(result.rows).toHaveLength(1);
    expect(result.rows[0].cancelada_pelo_estabelecimento).toBe(true);
  });
});