
- RH monthly imports use rh_employees as the single source and import_rh_monthly as an atomic, serialized whole-period replacement; this prevents partial imports and keeps both RH panels consistent.
- Legacy payroll tables remain read-only historical fallbacks for periods without a consolidated upload; never combine both sources in the same period.
- RH payroll individual values are RH/Master-only through RLS and manager-checked RPCs; other authorized roles receive aggregates, never per-person costs.
- Use rhMonthlyParser for all new RH file reads and rhAccess for client permissions; server RPCs independently enforce permissions.
- Turnover history uses independent authorized monthly snapshots, preserving event-time fields for period charts; departure reason categories are server-side aggregates so masked individual reasons remain private.
- Payroll table sorting uses a pure client-side payrollSort helper on copied rows; ordering never mutates cached data or changes export/access behavior.
- Sensitive exports log to sensitive_export_log before the file is generated — reuse it for every sensitive export module.
- Consolidated RH departments are classified server-side by rh_department_for_position and a monthly-row trigger; this keeps individual and aggregate views consistent for current rows and future imports without changing legacy payroll data.

- Investidores module: all reads/writes go through SECURITY DEFINER `inv_*` RPCs (tables have RLS with no direct policies) so masking, audit (audit_access_logs) and finance notifications stay server-side; access comes from user_roles (edit + full view for editor roles) and user_permissions keys (finance, extra full view), never hardcoded e-mails.
