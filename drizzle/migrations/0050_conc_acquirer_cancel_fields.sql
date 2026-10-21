ALTER TABLE public.conc_acquirer_entries
  ADD COLUMN IF NOT EXISTS cancelada_pelo_estabelecimento boolean,
  ADD COLUMN IF NOT EXISTS data_cancelamento date,
  ADD COLUMN IF NOT EXISTS valor_cancelado numeric,
  ADD COLUMN IF NOT EXISTS em_disputa_chargeback boolean,
  ADD COLUMN IF NOT EXISTS adjusts_entry_id uuid;
COMMENT ON COLUMN public.conc_acquirer_entries.adjusts_entry_id IS 'Linha de ajuste (delta) gerada na reimportação da Rede quando o valor do mesmo NSU+bandeira mudou; aponta para a linha original.';
CREATE INDEX IF NOT EXISTS conc_acquirer_hotel_nsu_idx ON public.conc_acquirer_entries (hotel_id, nsu) WHERE nsu IS NOT NULL;