-- Read-only checks for the category expression used by rh_departure_reason_category.
-- Returns only failures; execution rights for the private helper stay restricted.
WITH cases(input, expected) AS (VALUES
 ('em 02/09/2026 — Demitido SEM justa causa','Demitido sem justa causa'),
 ('Pedido de demissão sem justa causa','Pedido de demissão sem justa causa'),
 ('Rescisão por acordo entre as partes','Rescisão por acordo entre as partes'),
 ('Término do contrato de experiência','Término do contrato de experiência'),
 ('Rescisão de experiência antecipada','Rescisão de experiência antecipada'),
 ('Motivo desconhecido','Outros'),
 ('Demitido COM justa causa','Outros')
), normalized AS (
 SELECT input, expected, translate(lower(input), 'áàâãäéèêëíìîïóòôõöúùûüç', 'aaaaaeeeeiiiiooooouuuuc') value FROM cases
), classified AS (
 SELECT input, expected, CASE
 WHEN value ~ '(rescisao|experiencia|contrato)' AND value ~ 'antecipad' THEN 'Rescisão de experiência antecipada'
 WHEN value ~ '(termino|fim|vencimento)' AND value ~ 'experiencia' THEN 'Término do contrato de experiência'
 WHEN value ~ 'acordo' AND value ~ '(partes|rescisao)' THEN 'Rescisão por acordo entre as partes'
 WHEN value ~ 'pedido' AND value ~ 'demissao' THEN 'Pedido de demissão sem justa causa'
 WHEN value ~ '(demitido|demissao|dispensa)' AND value ~ 'sem justa causa' THEN 'Demitido sem justa causa'
 ELSE 'Outros' END actual FROM normalized
)
SELECT input, expected, actual FROM classified WHERE actual IS DISTINCT FROM expected;