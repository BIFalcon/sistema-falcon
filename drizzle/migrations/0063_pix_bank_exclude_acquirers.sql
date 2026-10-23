CREATE OR REPLACE FUNCTION public.conc_is_pix_bank(description text)
 RETURNS boolean LANGUAGE sql IMMUTABLE SET search_path TO 'public', 'pg_temp'
AS $function$
 SELECT coalesce(upper(description),'') !~ '\mBOLETOS?\M'
   AND coalesce(upper(description),'') !~ '\m(REDE|REDECARD|CIELO|STONE|GETNET|ZOOP|SAFRAPAY|PAGSEGURO|PAGBANK|SUMUP|VERO|BIN|ADYEN|AMEX)\M'
   AND coalesce(upper(description),'') ~ '(PIX|\mRECEBIDOS\M|\mRECEBIMENTOS\M)';
$function$;