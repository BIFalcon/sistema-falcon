
- Indicadores DRE route, navigation and summary restrictions share dreAccess helpers; ADM-only access uses one linked hotel at a time and server DRE RPCs independently check hotel authorization.
- Novos Negocios uses DRE-specific read policies and can_read_dre_hotel, never general/global data-access helpers; its layout allows only DRE, indicators and account profile, and DRE resolution reads existing closings without creating them.
- Letter preview and download use requireLetterPdfBlob when live generation is configured; generation failures must surface instead of silently substituting a stored PDF.
- Letter DRE revenue composition uses letterRevenue keyed by the closing hotel ID; scoped templates prevent one hotel's line mapping from changing other hotels, and PDF rows must fit through distribution.
- Carta uses the authorized hotel list without persisted GOP scoping, defaults to a valid single hotel, and synchronizes direct closing links with shared filters; changing a filter releases the URL closing pin so the displayed letter follows the selection.
- RH monthly imports use rh_employees as the single source and import_rh_monthly as an atomic, serialized whole-period replacement; this prevents partial imports and keeps both RH panels consistent.
- Legacy payroll tables remain read-only historical fallbacks for periods without a consolidated upload; never combine both sources in the same period.
- Payroll RPCs retain the total_cost alias for compatibility, while consolidated values come from net_earnings; separate summary fields and an authorized overtime-history RPC preserve legacy/missing monetary data as NULL. payrollMetrics shares null-safe monthly series and ratio calculations with tests.
- RH payroll individual values are RH/Master-only through RLS and manager-checked RPCs; other authorized roles receive aggregates, never per-person costs.
- Use rhMonthlyParser for all new RH file reads and rhAccess for client permissions; server RPCs independently enforce permissions.
- Detailed payroll extras use nullable source columns and the versioned manager-only entries RPC; older layouts retain totals without fabricated detail. RH Roomnights uses an RH-authorized RPC reading the latest monthly DRE occupied-room indicator, not occupancy multiplied by cached availability.
- Turnover history uses independent authorized monthly snapshots, preserving event-time fields for period charts; departure reason categories are server-side aggregates so masked individual reasons remain private.
- Payroll table sorting uses a pure client-side payrollSort helper on copied rows; ordering never mutates cached data or changes export/access behavior.
- Sensitive exports log to sensitive_export_log before the file is generated — reuse it for every sensitive export module.
- Consolidated RH departments are classified server-side by rh_department_for_position and a monthly-row trigger; this keeps individual and aggregate views consistent for current rows and future imports without changing legacy payroll data.

- Investidores module: all reads/writes go through SECURITY DEFINER `inv_*` RPCs (tables have RLS with no direct policies) so masking, audit (audit_access_logs) and finance notifications stay server-side; access comes from user_roles (edit + full view for editor roles) and user_permissions keys (finance, extra full view), never hardcoded e-mails.
