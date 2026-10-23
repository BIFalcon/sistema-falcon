-- Integration fixture lifecycle, executed through the authorized database data tools.
-- Use an existing bank upload to preserve its hotel/author; never mint or impersonate a user.
INSERT INTO public.conc_bank_entries(id,hotel_id,upload_id,entry_key,line_date,description,amount)
SELECT 'c02c105e-142b-49c4-987e-21a7e2b7d491',hotel_id,id,'test:daily-closing:20261023',DATE '2099-01-01','TEST FECHAMENTO DIARIO',200
FROM public.conc_uploads WHERE kind='bank' AND hotel_id IS NOT NULL AND uploaded_by IS NOT NULL ORDER BY created_at DESC LIMIT 1;
-- Assert exactly one open -200 adjustment.
SELECT count(*)=1 AND min(valor)=-200 AS passed FROM public.conc_pendencias
WHERE entry_id='c02c105e-142b-49c4-987e-21a7e2b7d491' AND status='aberta';
-- Uses the same bank-state transition as manual reconciliation and Rede/B2B settlement.
UPDATE public.conc_bank_entries SET matched_at=now() WHERE id='c02c105e-142b-49c4-987e-21a7e2b7d491';
-- Assert reverted timestamp and real matching reference.
SELECT count(*)=1 AS passed FROM public.conc_pendencias p JOIN public.conc_matches m ON m.id=p.match_id
WHERE p.entry_id='c02c105e-142b-49c4-987e-21a7e2b7d491' AND p.status='revertida' AND p.revertida_em IS NOT NULL;
-- Undo must reopen exactly one cycle and preserve the reverted cycle.
UPDATE public.conc_bank_entries SET matched_at=NULL WHERE id='c02c105e-142b-49c4-987e-21a7e2b7d491';
SELECT count(*) FILTER(WHERE status='aberta')=1 AND count(*) FILTER(WHERE status='revertida')=1 AS passed
FROM public.conc_pendencias WHERE entry_id='c02c105e-142b-49c4-987e-21a7e2b7d491';
DELETE FROM public.conc_bank_entries WHERE id='c02c105e-142b-49c4-987e-21a7e2b7d491' AND entry_key='test:daily-closing:20261023';