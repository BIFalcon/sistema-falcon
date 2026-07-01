DELETE FROM public.ar_to_invoice_entries e
USING public._ar_cleanup_ids c
WHERE e.id = c.id;
DROP TABLE public._ar_cleanup_ids;