# Sistema Falcon

Sistema de gestão de fechamento mensal de hotéis da rede Accor/Falcon.

## Stack

- **Frontend:** React 18, TypeScript, Vite, TailwindCSS, shadcn/ui
- **Backend:** Supabase (Auth, PostgreSQL, Storage, Edge Functions)
- **Estado:** TanStack Query (React Query)
- **Roteamento:** React Router v6
- **PDF:** jsPDF
- **Excel:** xlsx

## Módulos

- **DRE** — Upload e workflow de aprovação do Demonstrativo de Resultado
- **Carta ao Investidor** — Redação e aprovação da carta mensal
- **Financeiro** — Visão geral e decisão de distribuição de lucros
- **Envio** — Controle de envio ao investidor
- **Contas a Pagar** — Importação TOTVS/OMIE, aprovação GG, vínculo de documentos
- **Contas a Receber** — A Faturar e Open Folio (Opera Cloud)
- **Indicadores DRE** — Gráficos históricos de KPIs hoteleiros
- **Performance SLA** — Acompanhamento de prazos de fechamento

## Papéis (roles)

| Role | Acesso |
|------|--------|
| `processos` | Master — acesso total a todos os hotéis |
| `controladoria` | Aprova DRE |
| `gop` | Aprova DRE |
| `financeiro` | Gerencia Contas a Pagar/Receber |
| `gg` | Gerente Geral — aprova lançamentos e redige carta |
| `ri` | Relações com Investidores |

## Workflow de fechamento mensal

```
DRE → Carta ao Investidor → Financeiro → Envio
```

Cada etapa tem um ciclo de aprovação com status rastreados em `closings`.

## Edge Functions (Supabase)

| Função | Descrição |
|--------|-----------|
| `parse-ap-report` | Parser OMIE/TOTVS para Contas a Pagar |
| `parse-ar-report` | Parser Opera Cloud para Contas a Receber |
| `validate-ap-document` | Validação de documentos via IA |
| `notify-gg-ap` | Notificação de pendências ao GG (AP) |
| `notify-gg-open-folio` | Notificação ao GG (Open Folio) |
| `notify-gg-to-invoice` | Notificação ao GG (A Faturar) |
| `generate-letter` | Geração de carta ao investidor |
| `manage-users` | Gestão de usuários via Admin API |
| `process-notifications` | Processamento da fila de notificações |

## Variáveis de ambiente

Configuradas no Supabase — não requerem `.env` local para desenvolvimento via Lovable.
