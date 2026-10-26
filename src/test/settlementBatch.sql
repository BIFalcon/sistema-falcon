-- Read-only live assertions: concrete real lot from the user's Serra Talhada case.
SELECT (public.conc_batch_summary('rede','9b6e040a-5ceb-4792-9558-b25b02dbf0e0')->>'amount')::numeric=2480.70 AS exact_batch_amount;
SELECT count(*)=17 AND count(*) FILTER(WHERE status='Conciliado')=17 AND round(sum(net),2)=2480.70 AS all_17_sales_reconciled
FROM public.conc_batch_rows('rede','9b6e040a-5ceb-4792-9558-b25b02dbf0e0');
-- All or nothing, unknown/empty composition cannot release a batch.
SELECT public.conc_batch_summary('rede','00000000-0000-0000-0000-000000000000') IS NULL AS unknown_batch_blocked;
SELECT NOT EXISTS(SELECT 1 FROM public.conc_rede_recebidos r
WHERE (public.conc_batch_summary('rede',r.id)->>'ready')::boolean
AND EXISTS(SELECT 1 FROM public.conc_batch_rows('rede',r.id) WHERE status<>'Conciliado')) AS never_release_partial;
-- This attempted write MUST raise the settlement guard and leave the bank pending:
-- UPDATE public.conc_bank_entries SET matched_at=now()
-- WHERE id='6112a93e-353a-4f89-ad4d-ae6c64a9470a' AND matched_at IS NULL;