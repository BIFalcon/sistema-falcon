// Remessa e retorno SISPAG Itaú (CNAB 240, layout de arquivo 080 / lote 040).
// Modelo validado byte a byte contra a remessa PIX real enviada pelo Financeiro.

export type FormaPagamento = "pix" | "cc_itau" | "poupanca_itau" | "ted";

export interface Payer {
  razao_social: string; cnpj: string; agencia: string; conta: string; dac: string;
  endereco?: string | null; numero?: string | null; complemento?: string | null; cidade?: string | null; cep?: string | null; uf?: string | null;
}

export interface RemessaItem {
  seu_numero: string; valor: number; forma: FormaPagamento; nome: string; documento: string;
  banco_codigo?: string | null; agencia?: string | null; conta?: string | null; tipo_chave_pix?: string | null; chave_pix?: string | null;
}

const FORMA_CODE: Record<FormaPagamento, string> = { pix: "45", cc_itau: "01", poupanca_itau: "05", ted: "41" };
const FORMA_ORDER: FormaPagamento[] = ["pix", "cc_itau", "poupanca_itau", "ted"];

const digits = (s: string | null | undefined) => (s ?? "").replace(/\D/g, "");
const ascii = (s: string | null | undefined) => (s ?? "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^\x20-\x7E]/g, " ").toUpperCase();
const A = (s: string | null | undefined, n: number) => ascii(s).slice(0, n).padEnd(n, " ");
const N = (s: string | number | null | undefined, n: number) => digits(String(s ?? "")).slice(-n).padStart(n, "0");
const B = (n: number) => " ".repeat(n);
const money = (v: number, n: number) => N(Math.round(v * 100), n);
const ddmmyyyy = (d: Date) => `${String(d.getDate()).padStart(2, "0")}${String(d.getMonth() + 1).padStart(2, "0")}${d.getFullYear()}`;
const isoToDdmmyyyy = (iso: string) => iso.slice(0, 10).split("-").reverse().join("");

function check(line: string) {
  if (line.length !== 240) throw new Error(`Registro CNAB com ${line.length} posições (esperado 240)`);
  return line;
}

function contaFavorecido(it: RemessaItem): string {
  const [num, dv = ""] = (it.conta ?? "").split("-");
  if (it.forma === "pix") return B(20);
  if (it.forma === "ted") return N(it.agencia?.split("-")[0], 5) + " " + N(num, 12) + " " + A(dv, 1);
  return "0" + N(it.agencia?.split("-")[0], 4) + " " + "000000" + N(num, 6) + " " + A(dv, 1);
}

const PIX_TIPO: Record<string, string> = { telefone: "01", email: "02", cpf: "03", cnpj: "03", aleatoria: "04" };

function pixKey(tipo: string | null | undefined, chave: string | null | undefined): string {
  const k = (chave ?? "").trim();
  if (tipo === "telefone") { const d = digits(k); return d.startsWith("55") && d.length >= 12 ? `+${d}` : `+55${d}`; }
  if (tipo === "cpf" || tipo === "cnpj") return digits(k);
  return k;
}

export function buildRemessa(p: { payer: Payer; items: RemessaItem[]; dataPagamento: string; geradoEm?: Date; loteInicial?: number }): string {
  const now = p.geradoEm ?? new Date();
  const hora = `${String(now.getHours()).padStart(2, "0")}${String(now.getMinutes()).padStart(2, "0")}${String(now.getSeconds()).padStart(2, "0")}`;
  const pay = p.payer;
  const empresa = "2" + N(pay.cnpj, 14) + B(20) + N(pay.agencia, 5) + " " + N(pay.conta, 12) + " " + A(pay.dac, 1) + A(pay.razao_social, 30);
  const lines: string[] = [];
  lines.push(check("341" + "0000" + "0" + B(6) + "080" + empresa + A("BANCO ITAU SA", 30) + B(10) + "1" + ddmmyyyy(now) + hora + "0".repeat(14) + B(69)));

  let lote = (p.loteInicial ?? 1) - 1;
  const dataPg = isoToDdmmyyyy(p.dataPagamento);
  for (const forma of FORMA_ORDER) {
    const its = p.items.filter((i) => i.forma === forma);
    if (its.length === 0) continue;
    lote += 1;
    const L = N(lote, 4);
    lines.push(check("341" + L + "1" + "C" + "20" + FORMA_CODE[forma] + "040" + " " + empresa + B(30) + B(10)
      + A(pay.endereco, 30) + N(pay.numero, 5) + A(pay.complemento, 15) + A(pay.cidade, 20) + N(pay.cep, 8) + A(pay.uf, 2) + B(8) + B(10)));
    let seq = 0; let total = 0; const start = lines.length;
    for (const it of its) {
      seq += 1;
      total += Math.round(it.valor * 100);
      const camara = forma === "pix" ? "009" : forma === "ted" ? "018" : "000";
      const banco = forma === "pix" ? "000" : forma === "ted" ? N(it.banco_codigo, 3) : "341";
      const ident = forma === "pix" ? "04" : "00";
      lines.push(check("341" + L + "3" + N(seq, 5) + "A" + "000" + camara + banco + contaFavorecido(it) + A(it.nome, 30) + A(it.seu_numero, 20)
        + dataPg + "REA" + "00000000" + ident + "00000" + money(it.valor, 15) + B(20) + "0".repeat(8) + "0".repeat(15) + B(20)
        + "000000" + N(it.documento, 14) + "  01.3      5" + B(10)));
      if (forma === "pix") {
        seq += 1;
        const doc = digits(it.documento);
        lines.push(check("341" + L + "3" + N(seq, 5) + "B" + (PIX_TIPO[it.tipo_chave_pix ?? ""] ?? "04") + " " + (doc.length === 14 ? "2" : "1") + N(doc, 14)
          + B(95) + pixKey(it.tipo_chave_pix, it.chave_pix).slice(0, 100).padEnd(100, " ") + B(13)));
      }
    }
    const qtd = lines.length - start + 2;
    lines.push(check("341" + L + "5" + B(9) + N(qtd, 6) + N(total, 18) + "0".repeat(18) + B(181)));
  }
  // Quantidade de lotes = número do último lote (igual ao arquivo modelo do banco).
  lines.push(check("341" + "9999" + "9" + B(9) + N(lote, 6) + N(lines.length + 1, 6) + B(211)));
  return lines.join("\r\n") + "\r\n";
}

export const OCORRENCIAS: Record<string, string> = {
  "00": "Pagamento efetuado", BD: "Pagamento agendado", BE: "Agendado com forma alterada para OP", AE: "Data de pagamento alterada",
  AG: "Número do lote inválido", AH: "Sequencial do registro inválido", AJ: "Tipo de movimento inválido", AL: "Banco do favorecido inválido",
  AM: "Agência do favorecido inválida", AN: "Conta do favorecido inválida", AO: "Nome do favorecido inválido", AP: "Data de pagamento inválida",
  AR: "Valor inválido", BI: "CPF/CNPJ do favorecido inválido", CD: "CPF/CNPJ divergente do cadastrado no banco", CE: "Pagamento cancelado",
  CF: "Valor do documento inválido", DV: "TED devolvida pelo banco do favorecido", HA: "Lote não aceito", HM: "Erro no header do arquivo",
  PA: "PIX não efetivado", PB: "Erro no PSP do recebedor", PC: "Conta encerrada no PSP do recebedor", PD: "Tipo de conta incorreto",
  PE: "Transação não autorizada na conta do recebedor", PF: "CPF/CNPJ não confere com o titular da conta", PG: "CPF/CNPJ do recebedor incorreto",
  PH: "Ordem rejeitada pelo PSP do recebedor", PJ: "Chave PIX não cadastrada", PM: "Chave PIX inválida", PN: "Chave PIX não informada",
};

export function describeOcorrencias(codes: string): string {
  const list = (codes.match(/.{1,2}/g) ?? []).map((c) => c.trim()).filter(Boolean);
  return list.map((c) => `${c} — ${OCORRENCIAS[c] ?? "ocorrência do banco"}`).join("; ");
}

export interface RetornoRow { seu_numero: string; ocorrencias: string; motivo: string; valor_pago: number | null; data_pago: string | null }

export function parseRetorno(text: string): RetornoRow[] {
  const out: RetornoRow[] = [];
  for (const raw of text.split(/\r?\n/)) {
    const l = raw.replace(/\r$/, "");
    if (l.length < 240 || l[7] !== "3" || l[13] !== "A") continue;
    const seu = l.slice(73, 93).trim();
    if (!seu) continue;
    const oc = l.slice(230, 240).trim();
    const d = l.slice(154, 162);
    const v = Number(l.slice(162, 177)) / 100;
    out.push({
      seu_numero: seu, ocorrencias: oc, motivo: describeOcorrencias(oc),
      valor_pago: Number.isFinite(v) && v > 0 ? v : null,
      data_pago: /^\d{8}$/.test(d) && d !== "00000000" ? `${d.slice(4, 8)}-${d.slice(2, 4)}-${d.slice(0, 2)}` : null,
    });
  }
  return out;
}
