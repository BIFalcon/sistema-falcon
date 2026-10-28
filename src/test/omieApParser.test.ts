import { describe, expect, it } from "vitest";
import { parseOmieRows } from "../../supabase/functions/parse-ap-report/omieParser";

const header = ["Minha Empresa (CNPJ)", "Situação", "CNPJ/CPF", "Razão Social", "Data de Previsão (completa)", "Data de Vencimento (completa)", "Categoria", "Nota Fiscal", "A Pagar ou Receber", "Observação da Conta", "Código de Barras", "Forma de Pagamento", "Nome do Titular da Conta para Transferência", "Agência para Transferência", "Banco para Transferência", "Chave Pix para Transferência", "CNPJ ou CPF do Titular para Transferência", "Conta Corrente para Transferência", "Data de Registro (completa)", "Número do Documento", "Tipo do Documento"];
const row = ["32.288.742/0005-84", "Agendado", "04.737.552/0013-71", "Fornecedor teste", "28/10/2026", "27/10/2026", "Café da Manhã", "000153998", -701.16, "OUT/26", "00190000090133708600100825444177616120000116793", "Transferência Bancária", "Titular teste", "0012-3", "341 - Itaú", "+5534999550638", "075.021.086-96", "00012345-6", "13/10/2026", "000153998/1", "Nota Fiscal Eletrônica"];
const parse = (data = row, heads = header) => parseOmieRows([["Contas a Pagar"], heads, [], data]);

describe("Nova planilha OMIE AP", () => {
  it("prioriza Data de Previsão mesmo quando o vencimento é diferente", () => {
    const entry = parse().entries[0];
    expect(entry.due_date).toBe("2026-10-28");
    expect(entry.source_due_date).toBe("2026-10-27");
    expect(entry.source_forecast_date).toBe("2026-10-28");
  });
  it("usa vencimento somente quando a previsão estiver vazia", () => {
    const data = [...row]; data[4] = " ";
    expect(parse(data).entries[0].due_date).toBe("2026-10-27");
  });
  it("não substitui previsão preenchida inválida por vencimento", () => {
    const data = [...row]; data[4] = "inválida";
    expect(parse(data).entries[0].due_date).toBeNull();
  });
  it("preserva todos os dados de remessa e os zeros iniciais", () => {
    expect(parse().entries[0]).toMatchObject({
      barcode: "00190000090133708600100825444177616120000116793",
      payment_method: "Transferência Bancária", pix_key: "+5534999550638",
      beneficiary_bank: "341 - Itaú", beneficiary_agency: "0012-3", beneficiary_account: "00012345-6",
      beneficiary_name: "Titular teste", beneficiary_tax_id: "075.021.086-96",
      payment_document_number: "000153998/1", document_number: "000153998",
      source_registered_date: "2026-10-13", source_document_type: "Nota Fiscal Eletrônica",
      amount: 701.16, supplier: "Fornecedor teste", category: "Café da Manhã", omie_situation: "Agendado",
    });
  });
  it("não confunde conta para transferência com conta do hotel", () => {
    expect(parse().entries[0].raw.conta_corrente).toBe("");
    expect(parse([...row, "Itaú arrecadação"], [...header, "Conta Corrente"]).entries[0].raw.conta_corrente).toBe("Itaú arrecadação");
  });
  it("representa N/D como ausente, sem criar dados de pagamento fictícios", () => {
    const data = [...row]; for (let i = 12; i <= 17; i++) data[i] = "N/D";
    expect(parse(data).entries[0]).toMatchObject({ beneficiary_bank: null, beneficiary_agency: null, beneficiary_account: null, beneficiary_name: null, beneficiary_tax_id: null, pix_key: null });
  });
  it("mantém o layout OMIE antigo sem exigir os novos campos", () => {
    const result = parseOmieRows([["Contas a Pagar"], ["Situação", "CNPJ/CPF", "Razão Social", "Vencimento", "Categoria", "Nota Fiscal", "A Pagar ou Receber", "Observação da Conta", "Conta Corrente"], [], ["Em Aprovação", "123", "Fornecedor teste", "27/10/2026", "Serviços", "0001", -180, "teste", "Itaú"]]);
    expect(result.entries[0]).toMatchObject({ due_date: "2026-10-27", amount: 180, document_number: "0001", beneficiary_account: null });
  });
  it("detecta o cabeçalho completo fora da segunda linha e lê datas Excel", () => {
    const data = [...row]; data[4] = 46323;
    const result = parseOmieRows([["Título"], [], header, [], data]);
    expect(result.entries).toHaveLength(1);
    expect(result.entries[0].due_date).toBe("2026-10-28");
  });
  it("mantém identidade estável na reimportação e parcelas iguais separadas", () => {
    const result = parseOmieRows([["Título"], header, [], row, row]);
    expect(result.entries).toHaveLength(2);
    expect(result.entries[1].entry_key).toBe(`${result.entries[0].entry_key}|dup1`);
    expect(parse().entries[0].entry_key).toBe(result.entries[0].entry_key);
  });
});