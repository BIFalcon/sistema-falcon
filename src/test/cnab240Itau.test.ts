import { describe, it, expect } from "vitest";
import { buildRemessa, parseRetorno } from "@/lib/cnab240Itau";

// Remessa PIX real do Itaú (pix91872.txt), usada como referência byte a byte.
const SAMPLE = [
  "34100000      080215225143000330                    03165 000000098348 1OPERAR HOTEIS LTDA            BANCO ITAU SA                           12310202614161800000000000000                                                                     ",
  "34100031C2045040 215225143000330                    03165 000000098348 1OPERAR HOTEIS LTDA                                                    RUA JOSE MAXIMO RIBEIRO       01555               MURIAE              36883175MG                  ",
  "3410003300001A000009000                    JESSICA GARCIA DA ROSA PAIVA  12346439033         23102026REA000000000400000000000000013009                    00000000000000000000000                    00000000011783331755  01.3      5          ",
  "3410003300001B03 100011783331755                                                                                               11783331755                                                                                                      ",
  "3410003300002A000009000                    JESSICA GARCIA DA ROSA PAIVA  12346439058         23102026REA000000000400000000000000010524                    00000000000000000000000                    00000000011783331755  01.3      5          ",
  "3410003300002B03 100011783331755                                                                                               11783331755                                                                                                      ",
  "3410003300003A000009000                    TATIANE GOMES DIAS            12346438969         23102026REA000000000400000000000000060000                    00000000000000000000000                    00000000006569003690  01.3      5          ",
  "3410003300003B03 100006569003690                                                                                               06569003690                                                                                                      ",
  "3410003300004A000009000                    TROPICAL DISTRIBUIDORA DE BEBI12346436450         23102026REA000000000400000000000000015299                    00000000000000000000000                    00000007520458000200  01.3      5          ",
  "3410003300004B01 207520458000200                                                                                               +5531984728085                                                                                                   ",
  "34100035         000010000000000000098832000000000000000000                                                                                                                                                                                     ",
  "34199999         000003000012                                                                                                                                                                                                                   ",
];

describe("remessa SISPAG Itaú", () => {
  it("reproduz a remessa PIX modelo", () => {
    const out = buildRemessa({
      payer: { razao_social: "Operar Hotéis Ltda", cnpj: "15.225.143/0003-30", agencia: "3165", conta: "98348", dac: "1",
        endereco: "Rua José Maximo Ribeiro", numero: "1555", cidade: "Muriaé", cep: "36883-175", uf: "MG" },
      dataPagamento: "2026-10-23", geradoEm: new Date(2026, 9, 23, 14, 16, 18), loteInicial: 3,
      items: [
        { seu_numero: "12346439033", valor: 130.09, forma: "pix", nome: "Jessica Garcia da Rosa Paiva", documento: "117.833.317-55", tipo_chave_pix: "cpf", chave_pix: "11783331755" },
        { seu_numero: "12346439058", valor: 105.24, forma: "pix", nome: "Jessica Garcia da Rosa Paiva", documento: "11783331755", tipo_chave_pix: "cpf", chave_pix: "117.833.317-55" },
        { seu_numero: "12346438969", valor: 600, forma: "pix", nome: "Tatiane Gomes Dias", documento: "06569003690", tipo_chave_pix: "cpf", chave_pix: "06569003690" },
        { seu_numero: "12346436450", valor: 152.99, forma: "pix", nome: "Tropical Distribuidora de Bebidas", documento: "07520458000200", tipo_chave_pix: "telefone", chave_pix: "(31) 98472-8085" },
      ],
    });
    expect(out.split("\r\n").filter(Boolean)).toEqual(SAMPLE);
  });

  it("lê o retorno: pago, agendado e rejeitado", () => {
    const pago = SAMPLE[2].slice(0, 154) + "23102026" + "000000000013009" + SAMPLE[2].slice(177, 230) + "00        ";
    const rej = SAMPLE[4].slice(0, 230) + "PJ        ";
    const rows = parseRetorno([SAMPLE[0], pago, SAMPLE[3], rej].join("\r\n"));
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({ seu_numero: "12346439033", ocorrencias: "00", valor_pago: 130.09, data_pago: "2026-10-23" });
    expect(rows[1].ocorrencias).toBe("PJ");
    expect(rows[1].motivo).toContain("Chave PIX não cadastrada");
  });
});
