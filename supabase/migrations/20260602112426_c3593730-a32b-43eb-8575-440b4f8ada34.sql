-- Block 12 + 13: número fixo de apartamentos por hotel, renomear Três Rios, desativar Uberlândia
ALTER TABLE public.hotels
  ADD COLUMN IF NOT EXISTS num_apartments integer NULL,
  ADD COLUMN IF NOT EXISTS is_active boolean NOT NULL DEFAULT true;

UPDATE public.hotels SET num_apartments = 72  WHERE name ILIKE '%arcoverde%';
UPDATE public.hotels SET num_apartments = 120 WHERE name ILIKE '%barbacena%';
UPDATE public.hotels SET num_apartments = 120 WHERE name ILIKE '%divinóp%' OR name ILIKE '%divinop%';
UPDATE public.hotels SET num_apartments = 78  WHERE name ILIKE '%itaperuna%';
UPDATE public.hotels SET num_apartments = 220 WHERE name ILIKE '%jaboa%';
UPDATE public.hotels SET num_apartments = 108 WHERE name ILIKE '%manhuaçu%' OR name ILIKE '%manhuacu%';
UPDATE public.hotels SET num_apartments = 108 WHERE name ILIKE '%muriaé%' OR name ILIKE '%muriae%';
UPDATE public.hotels SET num_apartments = 120 WHERE name ILIKE '%patos%';
UPDATE public.hotels SET num_apartments = 106 WHERE name ILIKE '%petr%';
UPDATE public.hotels SET num_apartments = 179 WHERE name ILIKE '%cuiabá%' AND id <> 'condominio-cuiaba';
UPDATE public.hotels SET num_apartments = 179 WHERE name ILIKE '%cuiaba%' AND id <> 'condominio-cuiaba';
UPDATE public.hotels SET num_apartments = 144 WHERE name ILIKE '%juiz%';
UPDATE public.hotels SET num_apartments = 126 WHERE name ILIKE '%macaé%' AND name NOT ILIKE '%mercure%';
UPDATE public.hotels SET num_apartments = 126 WHERE name ILIKE '%macae%' AND name NOT ILIKE '%mercure%';
UPDATE public.hotels SET num_apartments = 92  WHERE name ILIKE '%serra talhada%';
UPDATE public.hotels SET num_apartments = 280 WHERE name ILIKE '%confins%' AND name NOT ILIKE '%cond%';
UPDATE public.hotels SET num_apartments = 104 WHERE name ILIKE '%garanhuns%';
UPDATE public.hotels SET num_apartments = 112 WHERE name ILIKE '%manhattan%';
UPDATE public.hotels SET num_apartments = 165 WHERE name ILIKE '%mercure%';
UPDATE public.hotels SET num_apartments = 53  WHERE name ILIKE '%carneiros%';
UPDATE public.hotels SET num_apartments = 126 WHERE name ILIKE '%três rios%' OR name ILIKE '%tres rios%' OR name ILIKE '%3 rios%';
UPDATE public.hotels SET num_apartments = 120 WHERE name ILIKE '%caruaru%';

-- Renomear Ibis Styles Três Rios para 3 Rios Plaza
UPDATE public.hotels
  SET name = '3 Rios Plaza'
  WHERE name ILIKE '%três rios%' OR name ILIKE '%tres rios%';

-- Desativar Ibis Budget Uberlândia (soft delete)
UPDATE public.hotels
  SET is_active = false
  WHERE name ILIKE '%uberlândia%' OR name ILIKE '%uberlandia%';