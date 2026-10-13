/** Regras da planilha de importação de Contas a Receber do OMIE. */

const addDays = (iso: string, n: number): string => {
  const d = new Date(`${iso}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};

const addBusinessDays = (iso: string, n: number): string => {
  const d = new Date(`${iso}T12:00:00Z`);
  let left = n;
  while (left > 0) {
    d.setUTCDate(d.getUTCDate() + 1);
    const wd = d.getUTCDay();
    if (wd !== 0 && wd !== 6) left--;
  }
  return d.toISOString().slice(0, 10);
};

/**
 * Vencimento a partir do texto "Prazo de recebimento" da Rede:
 * "no mesmo dia" = mesma data; "disponível em D+1" = +1 dia;
 * "1 dia útil" = +1 dia útil (sem contar sábado e domingo); "31 dias" = +31 dias.
 * Texto não reconhecido → null.
 */
export function vencimentoPorPrazo(baseIso: string | null | undefined, prazo: string | null | undefined): string | null {
  if (!baseIso) return null;
  const t = String(prazo ?? "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().trim();
  if (!t) return null;
  if (t.includes("mesmo dia")) return baseIso;
  const dPlus = t.match(/d\s*\+\s*(\d+)/);
  if (dPlus) return addDays(baseIso, Number(dPlus[1]));
  const util = t.match(/(\d+)\s*dias?\s*ute?is?/) ?? t.match(/(\d+)\s*dias?\s*util/);
  if (util) return addBusinessDays(baseIso, Number(util[1]));
  const dias = t.match(/(\d+)\s*dias?/);
  if (dias) return addDays(baseIso, Number(dias[1]));
  return null;
}

/** B2B: sempre 31 dias a partir da data da venda. */
export const vencimentoB2B = (saleIso: string | null | undefined): string | null =>
  saleIso ? addDays(saleIso, 31) : null;

export const OMIE_CLIENTE = "000.000.000-00";

/** "YYYY-MM-DD" → "DD/MM/YYYY". */
export const omieDate = (iso: string | null | undefined): string => {
  if (!iso) return "";
  const [y, m, d] = iso.split("-");
  return `${d}/${m}/${y}`;
};
