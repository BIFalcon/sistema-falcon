-- Read-only acceptance checks. Run in a transaction with an authorized request.jwt.claim.sub.
SELECT public.horas_uteis_24('2026-09-22 16:47-03','2026-09-23 17:51-03') = 26 AS previa_gg,
 public.horas_uteis_24('2026-09-23 17:51-03','2026-10-13 18:39-03') = 337 AS gg_gop,
 public.horas_uteis_24('2026-10-13 18:39-03','2026-10-19 22:29-03') = 100 AS gop_fernando,
 public.horas_uteis_24('2026-09-22 16:47-03','2026-10-19 22:29-03') = 462 AS total,
 public.horas_uteis_24('2026-10-24 00:00-03','2026-10-26 00:00-03') = 0 AS weekends_excluded,
 public.horas_uteis_24('2026-10-12 00:00-03','2026-10-13 00:00-03') = 24 AS holidays_count;