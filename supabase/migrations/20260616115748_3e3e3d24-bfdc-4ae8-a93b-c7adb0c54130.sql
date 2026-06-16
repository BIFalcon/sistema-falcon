
-- Backfill: corrige valores de Abril (mês 4) na série "ANO ANTERIOR" do Ibis Petrópolis.
-- Origem dos valores: DRE 2026 Ibis Petrópolis, aba "ANO ANTERIOR", coluna ABRIL.
WITH correct_values(suffix, val) AS (
  VALUES
    ('ocupacao_4',              0.2915::numeric),
    ('adr_4',                   193.68::numeric),
    ('revpar_4',                56.46::numeric),
    ('roomnights_4',            927::numeric),
    ('uhs_total_4',             106::numeric),
    ('uhs_disponiveis_4',       3180::numeric),
    ('receita_hospedagem_4',    214996.46::numeric),
    ('receita_ab_4',            53422.13::numeric),
    ('receita_bruta_total_4',   233868.62::numeric),
    ('receita_liquida_total_4', 220146.25::numeric),
    ('gop_4',                   4315.51::numeric),
    ('lucro_liquido_4',         3146.17::numeric)
)
UPDATE public.dre_parsed_lines d
SET line_value = cv.val
FROM public.closings c, correct_values cv
WHERE d.closing_id = c.id
  AND c.hotel_id = 'ibis-budget-petropolis'
  AND d.line_label = '[series_prev_' || cv.suffix || ']';
