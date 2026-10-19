
- RH monthly imports use rh_employees as the single source and import_rh_monthly as an atomic, serialized whole-period replacement; this prevents partial imports and keeps both RH panels consistent.
- Legacy payroll tables remain read-only historical fallbacks for periods without a consolidated upload; never combine both sources in the same period.
- RH payroll individual values are RH/Master-only through RLS and manager-checked RPCs; other authorized roles receive aggregates, never per-person costs.
- Use rhMonthlyParser for all new RH file reads and rhAccess for client permissions; server RPCs independently enforce permissions.
- Sensitive exports log to sensitive_export_log before the file is generated — reuse it for every sensitive export module.

- Investidores module: all reads/writes go through SECURITY DEFINER `inv_*` RPCs (tables have RLS with no direct policies) so masking, audit (audit_access_logs) and finance notifications stay server-side; access comes from user_roles (edit + full view for editor roles) and user_permissions keys (finance, extra full view), never hardcoded e-mails.
