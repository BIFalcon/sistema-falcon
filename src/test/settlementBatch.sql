-- Read-only live assertions: concrete real lot from the user's Serra Talhada case.
SELECT (public.conc_batch_summary('rede','9b6e040a-5ceb-4792-9558-b25b02dbf0e0')->>'amount')::numeric=2480.70 AS exact_batch_amount;
SELECT count(*)=17 AND count(*) FILTER(WHERE status='Conciliado')=17 AND round(sum(net),2)=2480.70 AS all_17_sales_reconciled
FROM public.conc_batch_rows('rede','9b6e040a-5ceb-4792-9558-b25b02dbf0e0');
-- All or nothing, unknown/empty composition cannot release a batch.
SELECT (public.conc_batch_summary('rede',r.id)->>'ready')::boolean IS NOT TRUE AS empty_batch_blocked
FROM public.conc_rede_recebidos r WHERE NOT EXISTS(SELECT 1 FROM public.conc_batch_rows('rede',r.id)) LIMIT 1;
SELECT NOT EXISTS(SELECT 1 FROM public.conc_rede_recebidos r
WHERE (public.conc_batch_summary('rede',r.id)->>'ready')::boolean
AND EXISTS(SELECT 1 FROM public.conc_batch_rows('rede',r.id) WHERE status<>'Conciliado')) AS never_release_partial;