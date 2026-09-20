-- Índices para paginação estável (ORDER BY id) e checagem de duplicatas por hotel
CREATE INDEX IF NOT EXISTS conc_opera_hotel_id_idx ON public.conc_opera_entries (hotel_id, id);
CREATE INDEX IF NOT EXISTS conc_opera_hotel_date_id_idx ON public.conc_opera_entries (hotel_id, business_date, id);
CREATE INDEX IF NOT EXISTS conc_opera_hotel_entrykey_idx ON public.conc_opera_entries (hotel_id, entry_key);

CREATE INDEX IF NOT EXISTS conc_acquirer_hotel_id_idx ON public.conc_acquirer_entries (hotel_id, id);
CREATE INDEX IF NOT EXISTS conc_acquirer_hotel_date_id_idx ON public.conc_acquirer_entries (hotel_id, sale_date, id);
CREATE INDEX IF NOT EXISTS conc_acquirer_hotel_entrykey_idx ON public.conc_acquirer_entries (hotel_id, entry_key);

CREATE INDEX IF NOT EXISTS conc_bank_hotel_id_idx ON public.conc_bank_entries (hotel_id, id);
CREATE INDEX IF NOT EXISTS conc_bank_hotel_date_id_idx ON public.conc_bank_entries (hotel_id, line_date, id);
CREATE INDEX IF NOT EXISTS conc_bank_hotel_entrykey_idx ON public.conc_bank_entries (hotel_id, entry_key);
