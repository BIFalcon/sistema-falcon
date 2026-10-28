ALTER TABLE public.ap_entries
 ADD COLUMN IF NOT EXISTS barcode text,
 ADD COLUMN IF NOT EXISTS pix_key text,
 ADD COLUMN IF NOT EXISTS beneficiary_bank text,
 ADD COLUMN IF NOT EXISTS beneficiary_agency text,
 ADD COLUMN IF NOT EXISTS beneficiary_account text,
 ADD COLUMN IF NOT EXISTS beneficiary_name text,
 ADD COLUMN IF NOT EXISTS beneficiary_tax_id text,
 ADD COLUMN IF NOT EXISTS payment_document_number text,
 ADD COLUMN IF NOT EXISTS source_document_type text,
 ADD COLUMN IF NOT EXISTS source_registered_date date,
 ADD COLUMN IF NOT EXISTS source_forecast_date date,
 ADD COLUMN IF NOT EXISTS source_due_date date;
COMMENT ON COLUMN public.ap_entries.bank_account IS 'Operation/payer account; never the supplier beneficiary account from OMIE transfer columns';
COMMENT ON COLUMN public.ap_entries.payment_document_number IS 'OMIE Número do Documento, distinct from Nota Fiscal retained in document_number';
COMMENT ON COLUMN public.ap_entries.due_date IS 'OMIE imports prioritize nonempty Data de Previsão (completa), falling back to Data de Vencimento (completa) only when forecast is empty';