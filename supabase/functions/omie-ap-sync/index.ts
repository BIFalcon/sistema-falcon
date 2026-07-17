import { createClient } from "npm:@supabase/supabase-js@2.58.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const OMIE_BASE = "https://app.omie.com.br/api/v1";

// Confirmed OMIE status_titulo values. Anything not listed falls back to
// "nao_aprovado_gg" and is recorded in status_desconhecidos for review.
const STATUS_MAP: Record<string, string> = {
  "PAGO": "pago",
  "ATRASADO": "nao_aprovado_gg",
  "VENCE HOJE": "nao_aprovado_gg",
  "A VENCER": "nao_aprovado_gg",
};

// Status que significam que o lançamento não deve entrar no Contas a Pagar
// de jeito nenhum — não é "pendente", é "não vai acontecer".
const SKIP_STATUS = new Set(["CANCELADO"]);

function toIsoDate(br: string | null | undefined): string | null {
  if (!br) return null;
  const m = br.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  if (!m) return null;
  return `${m[3]}-${m[2]}-${m[1]}`;
}

async function omieCall(
  call: string,
  endpoint: string,
  appKey: string,
  appSecret: string,
  param: Record<string, unknown>,
) {
  const res = await fetch(`${OMIE_BASE}/${endpoint}/`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ call, app_key: appKey, app_secret: appSecret, param: [param] }),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`OMIE ${call} falhou (${res.status}): ${text.slice(0, 300)}`);
  }
  return res.json();
}

async function omieListAll(
  call: string,
  endpoint: string,
  appKey: string,
  appSecret: string,
  extraParams: Record<string, unknown>,
  resultKey: string,
): Promise<any[]> {
  const all: any[] = [];
  let pagina = 1;
  while (true) {
    const data = await omieCall(call, endpoint, appKey, appSecret, {
      pagina,
      registros_por_pagina: 200,
      ...extraParams,
    });
    const rows = data[resultKey] ?? [];
    all.push(...rows);
    if (pagina >= (data.total_de_paginas ?? 1)) break;
    pagina++;
  }
  return all;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const admin = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  const { data: configs, error: cfgErr } = await admin
    .from("omie_sync_config")
    .select("*")
    .eq("active", true);

  if (cfgErr) {
    return new Response(JSON.stringify({ error: cfgErr.message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const results: any[] = [];

  for (const config of configs ?? []) {
    const log = {
      hotel_id: config.hotel_id,
      dry_run: config.dry_run,
      status: "success" as "success" | "error",
      entries_fetched: 0,
      entries_written: 0,
      entries_cancelados_ignorados: 0,
      fornecedores_nao_encontrados: 0,
      status_desconhecidos: new Set<string>(),
      categorias_nao_encontradas: new Set<string>(),
      error_message: null as string | null,
    };

    try {
      const appKey = Deno.env.get(config.secret_app_key_env);
      const appSecret = Deno.env.get(config.secret_app_secret_env);
      if (!appKey || !appSecret) {
        throw new Error(
          `Secrets ${config.secret_app_key_env}/${config.secret_app_secret_env} não configuradas`,
        );
      }

      // 1) Categorias
      const categorias = await omieListAll(
        "ListarCategorias",
        "geral/categorias",
        appKey,
        appSecret,
        {},
        "categoria_cadastro",
      );
      const categoriaMap = new Map<string, { descricao: string; despesa: boolean; receita: boolean }>();
      for (const c of categorias) {
        categoriaMap.set(c.codigo, {
          descricao: c.descricao,
          despesa: c.conta_despesa === "S",
          receita: c.conta_receita === "S",
        });
      }
      if (categorias.length > 0) {
        await admin.from("omie_categorias_cache").upsert(
          categorias.map((c: any) => ({
            hotel_id: config.hotel_id,
            codigo: c.codigo,
            descricao: c.descricao,
            conta_despesa: c.conta_despesa === "S",
            conta_receita: c.conta_receita === "S",
          })),
          { onConflict: "hotel_id,codigo" },
        );
      }

      // 2) Contas correntes
      const contas = await omieListAll(
        "ListarContasCorrentes",
        "geral/contacorrente",
        appKey,
        appSecret,
        {},
        "ListarContasCorrentes",
      );
      const contaMap = new Map<number, string>();
      for (const c of contas) contaMap.set(c.nCodCC, c.descricao);
      if (contas.length > 0) {
        await admin.from("omie_contas_correntes_cache").upsert(
          contas.map((c: any) => ({
            hotel_id: config.hotel_id,
            n_cod_cc: c.nCodCC,
            descricao: c.descricao,
            inativo: c.inativo === "S",
          })),
          { onConflict: "hotel_id,n_cod_cc" },
        );
      }

      // 3) Fornecedores (cache-first)
      const { data: fornecedorCacheRows } = await admin
        .from("omie_fornecedores_cache")
        .select("codigo_cliente_omie, razao_social")
        .eq("hotel_id", config.hotel_id);
      const fornecedorMap = new Map<number, string>(
        (fornecedorCacheRows ?? []).map((r: any) => [r.codigo_cliente_omie, r.razao_social]),
      );

      // 4) Contas a Pagar — janela fixa por data de vencimento
      const hoje = new Date();
      const ultimoDiaMesCorrente = new Date(hoje.getFullYear(), hoje.getMonth() + 1, 0);
      const fmtBr = (d: Date) =>
        `${String(d.getDate()).padStart(2, "0")}/${String(d.getMonth() + 1).padStart(2, "0")}/${d.getFullYear()}`;
      const inicio = new Date(config.janela_data_inicio + "T00:00:00");
      const dataDe = fmtBr(inicio);
      const dataAte = fmtBr(ultimoDiaMesCorrente);

      const lancamentosBrutos = await omieListAll(
        "ListarContasPagar",
        "financas/contapagar",
        appKey,
        appSecret,
        {
          apenas_importado_api: "N",
          filtrar_por_data_de: dataDe,
          filtrar_por_data_ate: dataAte,
          exibir_obs: "S",
        },
        "conta_pagar_cadastro",
      );
      const lancamentos = lancamentosBrutos.filter(
        (l: any) => !SKIP_STATUS.has(String(l.status_titulo ?? "").trim().toUpperCase()),
      );
      log.entries_cancelados_ignorados = lancamentosBrutos.length - lancamentos.length;
      log.entries_fetched = lancamentos.length;

      // Preenche cache de fornecedores faltantes
      const codigosFaltantes = [
        ...new Set(
          lancamentos
            .map((l: any) => l.codigo_cliente_fornecedor)
            .filter((c: number) => c && !fornecedorMap.has(c)),
        ),
      ];
      if (codigosFaltantes.length > 0) {
        const novosFornecedores = await omieListAll(
          "ListarClientesResumido",
          "geral/clientes",
          appKey,
          appSecret,
          {
            clientesPorCodigo: codigosFaltantes.map((c) => ({ codigo_cliente_omie: c })),
          },
          "clientes_cadastro_resumido",
        );
        for (const f of novosFornecedores) {
          fornecedorMap.set(f.codigo_cliente, f.razao_social);
        }
        if (novosFornecedores.length > 0) {
          await admin.from("omie_fornecedores_cache").upsert(
            novosFornecedores.map((f: any) => ({
              hotel_id: config.hotel_id,
              codigo_cliente_omie: f.codigo_cliente,
              razao_social: f.razao_social,
              nome_fantasia: f.nome_fantasia,
              cnpj_cpf: f.cnpj_cpf,
            })),
            { onConflict: "hotel_id,codigo_cliente_omie" },
          );
        }
      }

      // 5) Monta linhas em formato ap_entries
      const seenKeys = new Set<string>();
      const rows = [] as any[];
      for (const l of lancamentos) {
        const supplier = fornecedorMap.get(l.codigo_cliente_fornecedor);
        if (!supplier) log.fornecedores_nao_encontrados++;

        const statusRaw = String(l.status_titulo ?? "").trim().toUpperCase();
        const paymentStatus = STATUS_MAP[statusRaw];
        if (!paymentStatus && statusRaw) log.status_desconhecidos.add(statusRaw);

        const categoriasRateio: any[] = l.categorias ?? [];
        const ordenadas = [...categoriasRateio].sort(
          (a, b) => (b.percentual ?? 0) - (a.percentual ?? 0),
        );
        const principal = ordenadas[0];
        const catInfo = principal ? categoriaMap.get(principal.codigo_categoria) : null;
        if (principal && !catInfo) log.categorias_nao_encontradas.add(principal.codigo_categoria);

        const rateioObs =
          categoriasRateio.length > 1
            ? ` [Rateio: ${categoriasRateio
                .map(
                  (c) =>
                    `${categoriaMap.get(c.codigo_categoria)?.descricao ?? c.codigo_categoria} ${Number(c.percentual ?? 0).toFixed(1)}%`,
                )
                .join(", ")}]`
            : "";

        const entryKey = `omie-api-${l.codigo_lancamento_omie}`;
        if (seenKeys.has(entryKey)) continue;
        seenKeys.add(entryKey);

        rows.push({
          hotel_id: config.hotel_id,
          source_system: "omie_api",
          entry_key: entryKey,
          supplier: supplier ?? `[Fornecedor ${l.codigo_cliente_fornecedor} não encontrado]`,
          cnpj: null,
          document_number: l.numero_documento_fiscal ?? l.numero_documento ?? null,
          description: ((l.observacao ?? "") + rateioObs) || null,
          due_date: toIsoDate(l.data_vencimento),
          amount: l.valor_documento,
          payment_method: l.cnab_integracao_bancaria?.codigo_forma_pagamento ?? null,
          category: catInfo?.descricao ?? null,
          interest_fees: l.cnab_integracao_bancaria?.juros_boleto ?? null,
          omie_situation: statusRaw,
          payment_status: paymentStatus ?? "nao_aprovado_gg",
          bank_account: contaMap.get(l.id_conta_corrente) ?? null,
          is_distribution: false,
          gg_approval: "pending",
          gg_approval_by: null,
          gg_approval_at: null,
          gg_approval_notes: null,
          primary_document_id: null,
          original_amount: l.valor_documento,
          archived_at: null,
          raw: l,
        });
      }

      // 6) Grava (ou só loga em dry-run)
      if (!config.dry_run && rows.length > 0) {
        const chunkSize = 500;
        for (let i = 0; i < rows.length; i += chunkSize) {
          const { error: upErr } = await admin
            .from("ap_entries")
            .upsert(rows.slice(i, i + chunkSize), { onConflict: "hotel_id,entry_key" });
          if (upErr) throw upErr;
        }
        log.entries_written = rows.length;
      }

      await admin
        .from("omie_sync_config")
        .update({
          last_synced_at: new Date().toISOString(),
          last_status: "success",
          last_error: null,
        })
        .eq("id", config.id);
    } catch (err) {
      log.status = "error";
      log.error_message = err instanceof Error ? err.message : String(err);
      await admin
        .from("omie_sync_config")
        .update({ last_status: "error", last_error: log.error_message })
        .eq("id", config.id);
    }

    await admin.from("omie_sync_logs").insert({
      hotel_id: log.hotel_id,
      dry_run: log.dry_run,
      status: log.status,
      entries_fetched: log.entries_fetched,
      entries_written: log.entries_written,
      entries_cancelados_ignorados: log.entries_cancelados_ignorados,
      fornecedores_nao_encontrados: log.fornecedores_nao_encontrados,
      status_desconhecidos: [...log.status_desconhecidos],
      categorias_nao_encontradas: [...log.categorias_nao_encontradas],
      error_message: log.error_message,
    });

    results.push({
      hotel_id: log.hotel_id,
      status: log.status,
      dry_run: log.dry_run,
      entries_fetched: log.entries_fetched,
      entries_written: log.entries_written,
      fornecedores_nao_encontrados: log.fornecedores_nao_encontrados,
      status_desconhecidos: [...log.status_desconhecidos],
      categorias_nao_encontradas: [...log.categorias_nao_encontradas],
      error_message: log.error_message,
    });
  }

  return new Response(JSON.stringify({ results }), {
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
});