/**
 * Categorias oficiais de pendência de Contas a Pagar.
 * Usadas no card "Problemas identificados", nos filtros e no modal de notificação.
 */

export type IssueCategory =
  | "cnpj_divergente"
  | "sem_documento"
  | "valor_divergente"
  | "sem_aprovacao";

export interface IssueCategoryDef {
  key: IssueCategory;
  label: string;
  description: string;
  tone: "danger" | "warning" | "amber" | "info";
}

export const ISSUE_CATEGORIES: IssueCategoryDef[] = [
  {
    key: "sem_aprovacao",
    label: "Sem aprovação GG",
    description: "Pendência de aprovação no lançamento",
    tone: "warning",
  },
  {
    key: "sem_documento",
    label: "Sem documento",
    description: "Pendência de documentação anexada",
    tone: "info",
  },
  {
    key: "valor_divergente",
    label: "Valor divergente da NF",
    description: "Lançamento de valor divergente da NF",
    tone: "amber",
  },
  {
    key: "cnpj_divergente",
    label: "CNPJ divergente",
    description: "Boleto ou NF com CNPJ diferente do hotel",
    tone: "danger",
  },
];