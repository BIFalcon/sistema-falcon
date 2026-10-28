const normalized = (value: unknown) => String(value ?? "").trim().normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();

const columns = {
  barcode: ["codigo de barras"],
  pix_key: ["chave pix para transferencia", "chave pix"],
  beneficiary_bank: ["banco para transferencia"],
  beneficiary_agency: ["agencia para transferencia"],
  beneficiary_account: ["conta corrente para transferencia"],
  beneficiary_name: ["nome do titular da conta para transferencia"],
  beneficiary_tax_id: ["cnpj ou cpf do titular para transferencia"],
  payment_document_number: ["numero do documento"],
  source_document_type: ["tipo do documento"],
  source_registered_date: ["data de registro (completa)"],
  source_forecast_date: ["data de previsao (completa)", "data de previsao"],
  source_due_date: ["data de vencimento (completa)", "vencimento"],
} as const;

type Field = keyof typeof columns;
export type OmiePaymentDetails = Record<Field, string | null>;

export function getOmiePaymentColumns(header: string[]): Record<Field, number> {
  const names = header.map(normalized);
  return Object.fromEntries(Object.entries(columns).map(([key, aliases]) => {
    // Exact aliases avoid confusing the payer's account with the beneficiary's.
    const alias = aliases.find((name) => names.includes(name));
    return [key, alias === undefined ? -1 : names.indexOf(alias)];
  })) as Record<Field, number>;
}

export function readOmiePaymentDetails(
  row: unknown[], indexes: Record<Field, number>, parseDate: (value: unknown) => string | null,
): OmiePaymentDetails {
  return Object.fromEntries(Object.entries(indexes).map(([key, index]) => {
    const raw = row[index];
    const text = String(raw ?? "").trim();
    // N/D represents missing data, never an actual account or PIX key.
    const missing = !text || /^(n\/d|n\/a)$/i.test(text);
    return [key, missing ? null : key.startsWith("source_") && key.endsWith("_date") ? parseDate(raw) : text];
  })) as OmiePaymentDetails;
}