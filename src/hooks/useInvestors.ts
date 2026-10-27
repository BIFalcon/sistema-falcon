import { useQuery, useMutation, useQueryClient, keepPreviousData } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function rpc<T>(name: string, args?: Record<string, unknown>): Promise<T> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data, error } = await (supabase.rpc as any)(name, args ?? {});
  if (error) throw error;
  return data as T;
}

export type DataStatus = "completo" | "parcial" | "pendente";

export interface InvestorAccess { can_access: boolean; can_edit: boolean; is_finance: boolean; can_view_full: boolean; can_pay?: boolean; can_send?: boolean }

export function useInvestorAccess() {
  const { user } = useAuth();
  return useQuery({
    queryKey: ["inv-access", user?.id],
    enabled: !!user?.id,
    staleTime: 10 * 60_000,
    queryFn: () => rpc<InvestorAccess>("inv_my_access"),
  });
}

export interface UnitRow {
  unit_id: string; hotel_id: string; hotel_name: string; codigo_uh: string; modalidade: "pool" | "condo";
  investor_id: string | null; investor_nome: string | null; investor_documento: string | null;
  payee_id: string | null; payee_nome: string | null; status_dados: DataStatus; vigente_desde: string | null; total_count: number;
}

export interface UnitFilters { hotelId: string | null; modalidade: string | null; search: string; status: string | null; page: number; pageSize: number }

export function useInvestorUnits(f: UnitFilters, enabled = true) {
  return useQuery({
    queryKey: ["inv-units", f],
    enabled,
    placeholderData: keepPreviousData,
    staleTime: 60_000,
    queryFn: () => rpc<UnitRow[]>("inv_list_units", {
      _hotel_id: f.hotelId, _modalidade: f.modalidade, _search: f.search || null, _status: f.status,
      _limit: f.pageSize, _offset: f.page * f.pageSize,
    }),
  });
}

export interface InvestorStats { total_uhs: number; investidores: number; uhs_pool: number; pendentes_parciais: number }

export function useInvestorStats(hotelId: string | null, modalidade: string | null, enabled = true) {
  return useQuery({
    queryKey: ["inv-stats", hotelId, modalidade],
    enabled,
    staleTime: 60_000,
    queryFn: () => rpc<InvestorStats>("inv_stats", { _hotel_id: hotelId, _modalidade: modalidade }),
  });
}

export interface PayeeJson {
  id: string; investor_id: string; nome_favorecido: string; documento_favorecido: string | null;
  banco_codigo: string | null; banco_nome: string | null; agencia: string | null; conta: string | null;
  tipo_conta: "corrente" | "poupanca" | null; email: string | null; telefone: string | null;
  tipo_chave_pix: string | null; chave_pix: string | null; status_dados: DataStatus; observacao: string | null; full: boolean;
}

export interface PayeeShare { percentual: number; payee: PayeeJson }

export interface UnitDetail {
  unit: { id: string; hotel_id: string; hotel_name: string; codigo_uh: string; modalidade: "pool" | "condo"; matricula: string | null };
  current: { link_id: string; investor_id: string; investor_nome: string; investor_documento: string | null; codigo_externo: string | null; ativo: boolean; data_inicio: string } | null;
  payee: PayeeJson | null;
  shares: PayeeShare[];
  full: boolean;
  history: { id: string; investor_id: string; investor_nome: string; payee_nome: string | null; data_inicio: string; data_fim: string | null; motivo_troca: string | null; created_by: string | null }[];
}

export function useUnitDetail(unitId: string | undefined, full: boolean) {
  return useQuery({
    queryKey: ["inv-unit", unitId, full],
    enabled: !!unitId,
    staleTime: full ? 0 : 60_000,
    gcTime: full ? 0 : 5 * 60_000,
    queryFn: () => rpc<UnitDetail>("inv_unit_detail", { _unit_id: unitId, _full: full }),
  });
}

export interface InvestorDetail {
  investor: { id: string; nome: string; documento: string | null; codigo_externo: string | null; email: string | null; telefone: string | null; ativo: boolean };
  full: boolean;
  payees: PayeeJson[];
  units: { unit_id: string; hotel_name: string; codigo_uh: string; modalidade: string; data_inicio: string; data_fim: string | null; payee_nome: string | null; status_dados: DataStatus }[];
}

export function useInvestorDetail(investorId: string | undefined, full: boolean) {
  return useQuery({
    queryKey: ["inv-investor", investorId, full],
    enabled: !!investorId,
    staleTime: full ? 0 : 60_000,
    gcTime: full ? 0 : 5 * 60_000,
    queryFn: () => rpc<InvestorDetail>("inv_investor_detail", { _investor_id: investorId, _full: full }),
  });
}

export function useSearchInvestors(q: string, enabled: boolean) {
  return useQuery({
    queryKey: ["inv-search", q],
    enabled,
    staleTime: 30_000,
    queryFn: () => rpc<{ id: string; nome: string; documento: string | null; codigo_externo: string | null; ativo: boolean }[]>("inv_search_investors", { _q: q }),
  });
}

export function useInvestorPayees(investorId: string | null) {
  return useQuery({
    queryKey: ["inv-payees", investorId],
    enabled: !!investorId,
    queryFn: () => rpc<{ id: string; nome_favorecido: string; documento: string | null; status_dados: DataStatus }[]>("inv_list_payees", { _investor_id: investorId }),
  });
}

function useInvalidate() {
  const qc = useQueryClient();
  return () => {
    ["inv-units", "inv-stats", "inv-unit", "inv-investor", "inv-payees", "inv-search"].forEach((k) => qc.invalidateQueries({ queryKey: [k] }));
  };
}

export function useInvestorMutations() {
  const inv = useInvalidate();
  // eslint-disable-next-line react-hooks/rules-of-hooks
  const wrap = <A, R>(fn: (a: A) => Promise<R>) => useMutation<R, Error, A>({ mutationFn: fn, onSuccess: inv });
  return {
    importRows: wrap((a: { hotelId: string; modalidade: string; rows: unknown[]; fileName: string }) =>
      rpc<Record<string, number>>("inv_import", { _hotel_id: a.hotelId, _modalidade: a.modalidade, _rows: a.rows, _file_name: a.fileName })),
    changeLink: wrap((a: { unitId: string; investorId: string; payeeId: string | null; motivo: string; dataInicio: string }) =>
      rpc<string>("inv_change_link", { _unit_id: a.unitId, _investor_id: a.investorId, _payee_id: a.payeeId, _motivo: a.motivo, _data_inicio: a.dataInicio })),
    setModalidade: wrap((a: { unitIds: string[]; modalidade: string }) => rpc<number>("inv_set_modalidade", { _unit_ids: a.unitIds, _modalidade: a.modalidade })),
    setObservacao: wrap((a: { payeeIds: string[]; observacao: string }) => rpc<number>("inv_set_observacao", { _payee_ids: a.payeeIds, _observacao: a.observacao })),
    savePayee: wrap((a: { id: string | null; investorId: string; data: Record<string, unknown> }) =>
      rpc<string>("inv_save_payee", { _id: a.id, _investor_id: a.investorId, _data: a.data })),
    saveInvestor: wrap((a: { id: string | null; nome: string; documento: string; codigo: string; email: string; telefone: string }) =>
      rpc<string>("inv_save_investor", { _id: a.id, _nome: a.nome, _documento: a.documento, _codigo_externo: a.codigo, _email: a.email, _telefone: a.telefone })),
    createUnit: wrap((a: { hotelId: string; codigo: string; modalidade: string; matricula: string }) =>
      rpc<string>("inv_create_unit", { _hotel_id: a.hotelId, _codigo_uh: a.codigo, _modalidade: a.modalidade, _matricula: a.matricula })),
    setMatricula: wrap((a: { unitId: string; matricula: string }) => rpc<void>("inv_set_unit_matricula", { _unit_id: a.unitId, _matricula: a.matricula })),
    setShares: wrap((a: { unitId: string; shares: { payee_id: string; percentual: number }[] }) =>
      rpc<void>("inv_set_payee_shares", { _unit_id: a.unitId, _shares: a.shares })),
    setActive: wrap((a: { id: string; ativo: boolean }) => rpc<void>("inv_set_investor_active", { _id: a.id, _ativo: a.ativo })),
  };
}

export async function fetchPendingExport(hotelId: string | null) {
  return rpc<{ hotel_name: string; codigo_uh: string; investidor: string | null; favorecido: string | null; status_dados: string; falta: string | null; observacao: string | null }[]>(
    "inv_pending_export", { _hotel_id: hotelId });
}

export interface FullExportRow {
  hotel_name: string; codigo_uh: string; matricula: string | null; modalidade: string; investidor: string | null; investidor_documento: string | null;
  investidor_email: string | null; investidor_telefone: string | null; vigente_desde: string | null; favorecido: string | null; favorecido_documento: string | null;
  favorecido_email: string | null; favorecido_telefone: string | null; percentual: number | null; banco_codigo: string | null; banco_nome: string | null;
  agencia: string | null; conta: string | null; tipo_conta: string | null; tipo_chave_pix: string | null; chave_pix: string | null; status_dados: string; observacao: string | null;
}

export async function fetchFullExport(hotelId: string | null) {
  return rpc<FullExportRow[]>("inv_full_export", { _hotel_id: hotelId });
}

export async function fetchExistingUnitCodes(hotelId: string): Promise<Set<string>> {
  const codes = new Set<string>();
  for (let page = 0; page < 20; page++) {
    const rows = await rpc<UnitRow[]>("inv_list_units", { _hotel_id: hotelId, _limit: 200, _offset: page * 200 });
    rows.forEach((r) => codes.add(r.codigo_uh));
    if (rows.length < 200) break;
  }
  return codes;
}

export const STATUS_LABEL: Record<DataStatus, string> = { completo: "Completo", parcial: "Parcial", pendente: "Pendente" };

// ===== Distribuição & Pagamentos =====
export type PaymentStatus = "pronto" | "bloqueado" | "enviado" | "agendado" | "pago" | "rejeitado";
export interface PaymentItem {
  id: string; unit_id: string; codigo_uh: string; investidor_nome: string | null; favorecido_nome: string | null; percentual: number | null;
  valor: number; status: PaymentStatus; motivo: string | null; forma: string | null; ocorrencias: string | null; valor_pago: number | null; data_pago: string | null;
}
export interface DistributionOverview {
  dre_valor_por_uh: number | null; uhs_pool: number; can_send: boolean; payer_ok: boolean;
  batch: { id: string; valor_por_uh: number; valor_fonte: "dre" | "manual"; data_pagamento: string; remessas: number; last_remessa_at: string | null } | null;
  items: PaymentItem[];
}

export function useDistribution(hotelId: string | null, month: number, year: number, enabled: boolean) {
  return useQuery({
    queryKey: ["inv-dist", hotelId, month, year],
    enabled: enabled && !!hotelId,
    queryFn: () => rpc<DistributionOverview>("inv_distribution_overview", { _hotel_id: hotelId, _month: month, _year: year }),
  });
}

export interface PayerAccount { razao_social: string; cnpj: string; agencia: string; conta: string; dac: string; endereco: string | null; numero: string | null; complemento: string | null; cidade: string | null; cep: string | null; uf: string | null }

export function usePayerAccount(hotelId: string | null, enabled: boolean) {
  return useQuery({ queryKey: ["inv-payer", hotelId], enabled: enabled && !!hotelId, queryFn: () => rpc<PayerAccount | null>("inv_payer_get", { _hotel_id: hotelId }) });
}

export function useDistributionMutations() {
  const qc = useQueryClient();
  const inv = () => { qc.invalidateQueries({ queryKey: ["inv-dist"] }); qc.invalidateQueries({ queryKey: ["inv-payer"] }); };
  return {
    createBatch: useMutation({ onSuccess: inv, mutationFn: (a: { hotelId: string; month: number; year: number; valor: number; data: string }) =>
      rpc<string>("inv_create_batch", { _hotel_id: a.hotelId, _month: a.month, _year: a.year, _valor_por_uh: a.valor, _data_pagamento: a.data }) }),
    remessaData: useMutation({ onSuccess: inv, mutationFn: (batchId: string) => rpc<{ payer: PayerAccount; data_pagamento: string; lote: number; items: import("@/lib/cnab240Itau").RemessaItem[] }>("inv_remessa_data", { _batch_id: batchId }) }),
    applyReturn: useMutation({ onSuccess: inv, mutationFn: (a: { rows: unknown[]; fileName: string }) =>
      rpc<{ pagos: number; agendados: number; rejeitados: number; nao_encontrados: number }>("inv_apply_return", { _rows: a.rows, _file_name: a.fileName }) }),
    savePayer: useMutation({ onSuccess: inv, mutationFn: (a: { hotelId: string; data: Record<string, string> }) => rpc<void>("inv_payer_save", { _hotel_id: a.hotelId, _d: a.data }) }),
  };
}
