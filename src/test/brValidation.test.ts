import { describe, it, expect } from "vitest";
import { validateDocumento, validateConta, validateAgencia, validatePix, validateTelefone, sharesSumOk, equalShares, payeeIssues } from "@/lib/brValidation";

describe("padrões de cadastro", () => {
  it("valida dígitos de CPF e CNPJ", () => {
    expect(validateDocumento("529.982.247-25")).toBeNull();
    expect(validateDocumento("529.982.247-24")).toBe("CPF inválido");
    expect(validateDocumento("24.674.583/0001-02")).toBeNull();
    expect(validateDocumento("24.674.583/0001-03")).toBe("CNPJ inválido");
    expect(validateDocumento("1234")).not.toBeNull();
  });
  it("conta exige dígito, agência aceita com ou sem dígito", () => {
    expect(validateConta("12345-6")).toBeNull();
    expect(validateConta("123456")).not.toBeNull();
    expect(validateAgencia("1234")).toBeNull();
    expect(validateAgencia("1234-5")).toBeNull();
    expect(validateAgencia("12a4")).not.toBeNull();
  });
  it("telefone com DDD e PIX por tipo", () => {
    expect(validateTelefone("(81) 99999-1234")).toBeNull();
    expect(validateTelefone("99999-1234")).not.toBeNull();
    expect(validatePix("email", "a@b.com")).toBeNull();
    expect(validatePix("cpf", "11111111111")).not.toBeNull();
  });
  it("frações somam 100%", () => {
    expect(sharesSumOk([50, 50])).toBe(true);
    expect(sharesSumOk([33.34, 33.33, 33.33])).toBe(true);
    expect(sharesSumOk([50, 40])).toBe(false);
    expect(equalShares(3)).toEqual([33.34, 33.33, 33.33]);
  });
  it("remessa exige documento e conta (com tipo) ou PIX", () => {
    expect(payeeIssues({ documento_favorecido: "52998224725", banco_codigo: "341", agencia: "1234", conta: "12345-6" }).remessa).toEqual(["tipo de conta"]);
    expect(payeeIssues({ documento_favorecido: "52998224725", tipo_chave_pix: "email", chave_pix: "a@b.com" }).remessa).toEqual([]);
  });
});
