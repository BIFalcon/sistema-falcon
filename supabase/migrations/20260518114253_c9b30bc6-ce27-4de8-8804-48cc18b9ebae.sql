-- Bloco 1: migrar registros 'inserido' para 'agendado'
UPDATE public.ap_entries
SET payment_status = 'agendado'
WHERE payment_status = 'inserido';