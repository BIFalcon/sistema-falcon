
ALTER TABLE public.hotels
  ADD COLUMN IF NOT EXISTS bank_accounts jsonb DEFAULT '[]'::jsonb;

UPDATE public.hotels SET bank_accounts = '[]'::jsonb WHERE bank_accounts IS NULL;

UPDATE public.hotels SET bank_accounts = '[{"bank":"itau","account":"998694"}]'::jsonb
  WHERE id = 'restaurante-carneiros';

UPDATE public.hotels SET bank_accounts = '[{"bank":"itau","account":"98243-4"},{"bank":"santander","account":"13008609-4"}]'::jsonb
  WHERE name ILIKE '%cuiabá%' AND id <> 'condominio-cuiaba';

UPDATE public.hotels SET bank_accounts = '[{"bank":"santander","account":"130089743"}]'::jsonb
  WHERE id = 'condominio-cuiaba';

UPDATE public.hotels SET bank_accounts = '[{"bank":"itau","account":"98411-7"},{"bank":"santander","account":"13008447-0"}]'::jsonb
  WHERE name ILIKE '%divinóp%';

UPDATE public.hotels SET bank_accounts = '[{"bank":"itau","account":"99451-9"}]'::jsonb
  WHERE name ILIKE '%jaboa%';

UPDATE public.hotels SET bank_accounts = '[{"bank":"itau","account":"979599"}]'::jsonb
  WHERE name ILIKE '%arcoverde%';

UPDATE public.hotels SET bank_accounts = '[{"bank":"itau","account":"22210-1"}]'::jsonb
  WHERE name ILIKE '%confins%' AND name NOT ILIKE '%cond%';

UPDATE public.hotels SET bank_accounts = '[{"bank":"itau","account":"26624-9"}]'::jsonb
  WHERE name ILIKE '%cond%' AND name ILIKE '%confins%';

UPDATE public.hotels SET bank_accounts = '[{"bank":"itau","account":"99431-1"}]'::jsonb
  WHERE name ILIKE '%uberlândia%';

UPDATE public.hotels SET bank_accounts = '[{"bank":"itau","account":"25172-0"}]'::jsonb
  WHERE name ILIKE '%manhuaçu%';

UPDATE public.hotels SET bank_accounts = '[{"bank":"itau","account":"98341-6"},{"bank":"santander","account":"13008333-8"}]'::jsonb
  WHERE name ILIKE '%três rios%';

UPDATE public.hotels SET bank_accounts = '[{"bank":"itau","account":"25152-2"}]'::jsonb
  WHERE name ILIKE '%patos%';

UPDATE public.hotels SET bank_accounts = '[{"bank":"itau","account":"97752-2"}]'::jsonb
  WHERE name ILIKE '%caruaru%';

UPDATE public.hotels SET bank_accounts = '[{"bank":"itau","account":"99536-7"}]'::jsonb
  WHERE name ILIKE '%garanhuns%';

UPDATE public.hotels SET bank_accounts = '[{"bank":"itau","account":"98233-5"},{"bank":"santander","account":"130083417"}]'::jsonb
  WHERE name ILIKE '%juiz%';

UPDATE public.hotels SET bank_accounts = '[{"bank":"itau","account":"98242-6"},{"bank":"santander","account":"130084834"}]'::jsonb
  WHERE name ILIKE '%itaperuna%';

UPDATE public.hotels SET bank_accounts = '[{"bank":"itau","account":"98346-5"},{"bank":"santander","account":"13008332-1"}]'::jsonb
  WHERE name ILIKE '%barbacena%';

UPDATE public.hotels SET bank_accounts = '[{"bank":"itau","account":"98348-1"},{"bank":"santander","account":"130083314"}]'::jsonb
  WHERE name ILIKE '%muriaé%';

UPDATE public.hotels SET bank_accounts = '[{"bank":"itau","account":"98339-0"},{"bank":"santander","account":"130085701"}]'::jsonb
  WHERE name ILIKE '%petr%';

UPDATE public.hotels SET bank_accounts = '[{"bank":"itau","account":"98236-8"},{"bank":"santander","account":"13003344-7"}]'::jsonb
  WHERE name ILIKE '%serra talhada%';

UPDATE public.hotels SET bank_accounts = '[{"bank":"itau","account":"25162-1"}]'::jsonb
  WHERE name ILIKE '%macaé%';

UPDATE public.hotels SET bank_accounts = '[{"bank":"itau","account":"99755-3"}]'::jsonb
  WHERE name ILIKE '%porto alegre%' AND name NOT ILIKE '%obra%';

UPDATE public.hotels SET bank_accounts = '[{"bank":"itau","account":"98985-7"}]'::jsonb
  WHERE name ILIKE '%obra%';

UPDATE public.hotels SET bank_accounts = '[{"bank":"itau","account":"25172-0"}]'::jsonb
  WHERE name ILIKE '%carneiros%' AND name NOT ILIKE '%restaurante%';
