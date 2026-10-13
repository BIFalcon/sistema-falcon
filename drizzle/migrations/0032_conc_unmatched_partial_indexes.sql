CREATE INDEX IF NOT EXISTS conc_opera_unmatched_idx ON public.conc_opera_entries (hotel_id, business_date, categoria, amount) WHERE matched_at IS NULL;
CREATE INDEX IF NOT EXISTS conc_acquirer_unmatched_idx ON public.conc_acquirer_entries (hotel_id, sale_date, categoria, amount) WHERE matched_at IS NULL;
CREATE INDEX IF NOT EXISTS conc_bank_unmatched_idx ON public.conc_bank_entries (hotel_id, line_date, amount) WHERE matched_at IS NULL;
CREATE INDEX IF NOT EXISTS conc_match_items_entry_side_idx ON public.conc_match_items (entry_id, side);