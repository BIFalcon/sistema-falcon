import { describe, it, expect } from "vitest";
import { parseInvestorRows, normalizeBank, parseInvestorName, clean } from "@/lib/investorImportParser";

const header = ["Nome", "Unidades", "Endereço Residencial", "E-mail", "Telefones", "CPF/CNPJ", "Favorecido", "CPF/CNPJ", "Banco", "Agência", "Conta Corrente", ""];
const m = (rows: unknown[][]) => [["Ibis Caruaru"], header, ...rows];

describe("investorImportParser", () => {
  it("separa código, nome e documento do investidor", () => {
    expect(parseInvestorName("4021 - NOME DO INVESTIDOR (24.674.583/0001-02)")).toEqual({ codigo_externo: "4021", nome: "NOME DO INVESTIDOR", documento: "24674583000102" });
  });
  it("normaliza grafias de banco", () => {
    expect(normalizeBank("Banco Itaú (341)").codigo).toBe("341");
    expect(normalizeBank("Caixa Economica Federal").codigo).toBe("104");
    expect(normalizeBank("Banco do brasil").codigo).toBe("001");
    expect(normalizeBank("Banco Xyz").reconhecido).toBe(false);
  });
  it("placeholder x conta como ausente", () => {
    expect(clean("x")).toBeNull();
    expect(clean("-")).toBeNull();
  });
  it("status completo/parcial/pendente e PIX no documento do favorecido", () => {
    const res = parseInvestorRows(m([
      ["1 - A (111.444.777-35)", "NHC-101", "rua", "a@x.com", "", "", "A", "111.444.777-35", "Itau", "1234", "5678-9"],
      ["2 - B (222.333.444-05)", "NHC-317", "", "", "", "", "Empresa B", "07.360.678/0001-24 (pix)", "", "", ""],
      ["3 - C (333.444.555-66)", "NHC-413", "", "", "", "", "C", "x", "x", "x", "x"],
    ]));
    const by = Object.fromEntries(res.rows.map((r) => [r.codigo_uh, r]));
    expect(by["NHC-101"].status).toBe("completo");
    expect(by["NHC-317"].status).toBe("parcial");
    expect(by["NHC-317"].payee?.chave_pix).toBe("07360678000124");
    expect(by["NHC-317"].payee?.tipo_chave_pix).toBe("cnpj");
    expect(by["NHC-413"].status).toBe("pendente");
  });
  it("extrai chave PIX do campo Banco", () => {
    const res = parseInvestorRows(m([["1 - A (111.444.777-35)", "NHC-1", "", "", "", "", "A", "", "chave pix: 10.680.683/0001-29", "", ""]]));
    expect(res.rows[0].payee?.chave_pix).toBe("10680683000129");
    expect(res.rows[0].payee?.banco_nome).toBeNull();
  });
});
