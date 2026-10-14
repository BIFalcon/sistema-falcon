
- RH payroll panel: individual payroll rows (rh_payroll_entries) are readable only by RH/Master via RLS; other roles get aggregates via SECURITY DEFINER RPCs — never expose per-person cost.
- Sensitive exports log to sensitive_export_log before the file is generated — reuse it for every sensitive export module.

- Investidores module: all reads/writes go through SECURITY DEFINER `inv_*` RPCs (tables have RLS with no direct policies) so masking, audit (audit_access_logs) and finance notifications stay server-side; access comes from user_roles (edit) and user_permissions keys (finance/full view), never hardcoded e-mails.
