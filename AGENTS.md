
- RH payroll panel: individual payroll rows (rh_payroll_entries) are readable only by RH/Master via RLS; other roles get aggregates via SECURITY DEFINER RPCs — never expose per-person cost.
- Sensitive exports log to sensitive_export_log before the file is generated — reuse it for every sensitive export module.
