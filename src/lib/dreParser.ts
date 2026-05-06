/**
 * Parser de planilhas DRE para os 4 modelos da rede Falcon:
 * DEFAULT, CONFINS, MERCURE, MANHATTAN.
 *
 * Estratégia: detectar o template via heurísticas de nomes de aba; para cada
 * indicador-chave, varrer linhas em busca de rótulos por regex (mais robusto do
 * que fixar números de linha, pois variam entre hotéis da mesma família).
 *
 * Para cada indicador retorna: rótulo encontrado, valor numérico (mais à
 * direita não-nulo da linha) e o número da linha original.
 */
import * as XLSX from "xlsx";

export type DreTemplate = "DEFAULT" | "CONFINS" | "MERCURE" | "MANHATTAN";

export const DRE_LINE_CATEGORIES: Record<string, string> = {
  // TOPLINE
  "taxa de ocupa": "Topline",
  "número de apartamentos disp": "Topline",
  "numero de apartamentos disp": "Topline",
  "apartamentos ocupados": "Topline",
  "número de hóspedes": "Topline",
  "numero de hospedes": "Topline",
  "fator de ocupa": "Topline",
  "diária média": "Topline",
  "diaria media": "Topline",
  "revpar": "Topline",
  "receita bruta total": "Topline",
  "receita líquida total": "Topline",
  "receita liquida total": "Topline",
  "deduções da receita": "Topline",
  "deducoes da receita": "Topline",
  "despesas fixas totais": "Topline",
  "despesas variáveis total": "Topline",
  "despesas variaveis total": "Topline",
  "despesas totais": "Topline",
  "resultado operacional bruto": "Topline",
  "resultado operacional líquido": "Topline",
  "resultado operacional liquido": "Topline",
  "lucro antes": "Topline",
  "lucro líquido": "Topline",
  "lucro liquido": "Topline",
  "lucro / prejuízo a distribuir": "Topline",
  "lucro / prejuizo a distribuir": "Topline",
  "distribuição por uh": "Topline",
  "distribuicao por uh": "Topline",
  "por uh": "Topline",

  // RECEITAS
  "receita bruta de serviços": "Receitas",
  "receita bruta de servicos": "Receitas",
  "receita bruta a&b": "Receitas",
  "receita financeira": "Receitas",
  "outras receitas": "Receitas",

  // DESPESAS
  "impostos s/ vendas": "Despesas",
  "despesas com pessoal": "Despesas",
  "custo das mercadorias vendidas": "Despesas",
  "despesas operacionais": "Despesas",
  "despesas com prestadores": "Despesas",
  "custos de hospedagem": "Despesas",
  "despesas de utilidades": "Despesas",
  "despesas com manutenção": "Despesas",
  "despesas com manutencao": "Despesas",
  "despesas com vendas": "Despesas",
  "taxas accor": "Despesas",
  "taxas de administração": "Despesas",
  "taxas de administracao": "Despesas",
  "despesas financeiras": "Despesas",
  "total dos gastos de propriedade": "Despesas",
  "total dos impostos sobre o lucro": "Despesas",
  "total de taxas sobre": "Despesas",
};

export function getDreLineCategory(label: string): string {
  const norm = label
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim();
  for (const [key, cat] of Object.entries(DRE_LINE_CATEGORIES)) {
    const nk = key
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .toLowerCase();
    if (norm.startsWith(nk) || norm.includes(nk)) return cat;
  }
  if (norm.startsWith("(-)") || norm.startsWith("(+)")) return "Despesas Específicas";
  return "Despesas Específicas";
}

export interface DreLineMapping {
  catMacro: string;
  segment: string;
}

const DRE_LINE_MAP: Array<{ pattern: RegExp; catMacro: string; segment: string }> = [
  // ── DEDUÇÕES DA RECEITA ──
  { pattern: /^iss$/i,                           catMacro: "Deduções da Receita",  segment: "(-) Impostos s/ vendas e serviços" },
  { pattern: /^icms$/i,                          catMacro: "Deduções da Receita",  segment: "(-) Impostos s/ vendas e serviços" },
  { pattern: /^pis$/i,                           catMacro: "Deduções da Receita",  segment: "(-) Impostos s/ vendas e serviços" },
  { pattern: /^cofins$/i,                        catMacro: "Deduções da Receita",  segment: "(-) Impostos s/ vendas e serviços" },
  { pattern: /imposto.*vend/i,                   catMacro: "Deduções da Receita",  segment: "(-) Impostos s/ vendas e serviços" },

  // ── DESPESAS FIXAS — Pessoal ──
  { pattern: /^sal[aá]rio/i,                     catMacro: "Despesas Fixas",       segment: "Despesas com Pessoal" },
  { pattern: /^f[eé]rias$/i,                     catMacro: "Despesas Fixas",       segment: "Despesas com Pessoal" },
  { pattern: /^encargos$/i,                      catMacro: "Despesas Fixas",       segment: "Despesas com Pessoal" },
  { pattern: /vale\s*refei/i,                    catMacro: "Despesas Fixas",       segment: "Despesas com Pessoal" },
  { pattern: /vale\s*transport/i,                catMacro: "Despesas Fixas",       segment: "Despesas com Pessoal" },
  { pattern: /rescis/i,                          catMacro: "Despesas Fixas",       segment: "Despesas com Pessoal" },
  { pattern: /uniforme/i,                        catMacro: "Despesas Fixas",       segment: "Despesas com Pessoal" },
  { pattern: /lavanderia\s*func/i,               catMacro: "Despesas Fixas",       segment: "Despesas com Pessoal" },
  { pattern: /treinamento/i,                     catMacro: "Despesas Fixas",       segment: "Despesas com Pessoal" },
  { pattern: /confraterniza/i,                   catMacro: "Despesas Fixas",       segment: "Despesas com Pessoal" },
  { pattern: /plano\s*de\s*sa[úu]de/i,           catMacro: "Despesas Fixas",       segment: "Despesas com Pessoal" },
  { pattern: /m[ãa]o\s*de\s*obra/i,              catMacro: "Despesas Fixas",       segment: "Despesas com Pessoal" },
  { pattern: /repasse\s*de\s*sal/i,              catMacro: "Despesas Fixas",       segment: "Despesas com Pessoal" },

  // ── DESPESAS FIXAS — Custo das Mercadorias ──
  { pattern: /custo.*mercadoria/i,               catMacro: "Despesas Fixas",       segment: "(-) Custo das Mercadorias Vendidas" },
  { pattern: /custo.*caf[eé]\s*da\s*manh/i,      catMacro: "Despesas Fixas",       segment: "(-) Custo das Mercadorias Vendidas" },

  // ── DESPESAS FIXAS — Operacionais ──
  { pattern: /taxa\s*de\s*condom/i,              catMacro: "Despesas Fixas",       segment: "Despesas Operacionais" },
  { pattern: /aluguel.*m[áa]quina/i,             catMacro: "Despesas Fixas",       segment: "Despesas Operacionais" },
  { pattern: /material.*escrit/i,                catMacro: "Despesas Fixas",       segment: "Despesas Operacionais" },
  { pattern: /material.*inform[áa]t/i,           catMacro: "Despesas Fixas",       segment: "Despesas Operacionais" },
  { pattern: /telefon/i,                         catMacro: "Despesas Fixas",       segment: "Despesas Operacionais" },
  { pattern: /correio/i,                         catMacro: "Despesas Fixas",       segment: "Despesas Operacionais" },
  { pattern: /impresso/i,                        catMacro: "Despesas Fixas",       segment: "Despesas Operacionais" },
  { pattern: /associa.*classe/i,                 catMacro: "Despesas Fixas",       segment: "Despesas Operacionais" },
  { pattern: /viagen.*estadi/i,                  catMacro: "Despesas Fixas",       segment: "Despesas Operacionais" },
  { pattern: /despesa.*alimenta/i,               catMacro: "Despesas Fixas",       segment: "Despesas Operacionais" },
  { pattern: /condu.*transport/i,                catMacro: "Despesas Fixas",       segment: "Despesas Operacionais" },
  { pattern: /decora.*anima/i,                   catMacro: "Despesas Fixas",       segment: "Despesas Operacionais" },
  { pattern: /^seguro/i,                         catMacro: "Despesas Fixas",       segment: "Despesas Operacionais" },
  { pattern: /ecad/i,                            catMacro: "Despesas Fixas",       segment: "Despesas Operacionais" },
  { pattern: /taxas.*emolumento/i,               catMacro: "Despesas Fixas",       segment: "Despesas Operacionais" },
  { pattern: /aquisi.*bens.*pequeno/i,           catMacro: "Despesas Fixas",       segment: "Despesas Operacionais" },
  { pattern: /despesa.*n[ãa]o\s*previst/i,       catMacro: "Despesas Fixas",       segment: "Despesas Operacionais" },

  // ── DESPESAS FIXAS — Prestadores ──
  { pattern: /assessoria\s*cont[áa]b/i,          catMacro: "Despesas Fixas",       segment: "Despesas com Prestadores de Serviços" },
  { pattern: /auditoria/i,                       catMacro: "Despesas Fixas",       segment: "Despesas com Prestadores de Serviços" },
  { pattern: /advocaci/i,                        catMacro: "Despesas Fixas",       segment: "Despesas com Prestadores de Serviços" },
  { pattern: /assist.*software/i,                catMacro: "Despesas Fixas",       segment: "Despesas com Prestadores de Serviços" },
  { pattern: /servi.*terceiro/i,                 catMacro: "Despesas Fixas",       segment: "Despesas com Prestadores de Serviços" },

  // ── DESPESAS VARIÁVEIS — Hospedagem ──
  { pattern: /amenitie/i,                        catMacro: "Despesas Variáveis",   segment: "Custos de Hospedagem" },
  { pattern: /material.*apartamento/i,           catMacro: "Despesas Variáveis",   segment: "Custos de Hospedagem" },
  { pattern: /lavanderia\s*enxoval/i,            catMacro: "Despesas Variáveis",   segment: "Custos de Hospedagem" },
  { pattern: /lavanderia\s*h[oó]spede/i,         catMacro: "Despesas Variáveis",   segment: "Custos de Hospedagem" },
  { pattern: /material.*limpeza/i,               catMacro: "Despesas Variáveis",   segment: "Custos de Hospedagem" },
  { pattern: /utens[íi]lio.*cozinha/i,           catMacro: "Despesas Variáveis",   segment: "Custos de Hospedagem" },

  // ── DESPESAS VARIÁVEIS — Utilidades ──
  { pattern: /energia\s*el[eé]tric/i,            catMacro: "Despesas Variáveis",   segment: "Despesas de Utilidades" },
  { pattern: /[áa]gua\s*e\s*esgoto/i,            catMacro: "Despesas Variáveis",   segment: "Despesas de Utilidades" },
  { pattern: /^g[áa]s$/i,                        catMacro: "Despesas Variáveis",   segment: "Despesas de Utilidades" },

  // ── DESPESAS VARIÁVEIS — Manutenção ──
  { pattern: /contrato.*manuten/i,               catMacro: "Despesas Variáveis",   segment: "Despesas com Manutenção" },
  { pattern: /^laudos?$/i,                       catMacro: "Despesas Variáveis",   segment: "Despesas com Manutenção" },
  { pattern: /material.*manuten/i,               catMacro: "Despesas Variáveis",   segment: "Despesas com Manutenção" },
  { pattern: /servi.*eventual.*manuten/i,        catMacro: "Despesas Variáveis",   segment: "Despesas com Manutenção" },

  // ── DESPESAS VARIÁVEIS — Vendas ──
  { pattern: /comiss.*ag[eê]ncia/i,              catMacro: "Despesas Variáveis",   segment: "Despesas com Vendas" },
  { pattern: /comiss.*cart[ãa]o/i,               catMacro: "Despesas Variáveis",   segment: "Despesas com Vendas" },
  { pattern: /publicidade|propaganda|marketing/i,catMacro: "Despesas Variáveis",   segment: "Despesas com Vendas" },
  { pattern: /assessoria.*vend/i,                catMacro: "Despesas Variáveis",   segment: "Despesas com Vendas" },
  { pattern: /viagem.*comercial/i,               catMacro: "Despesas Variáveis",   segment: "Despesas com Vendas" },
  { pattern: /^brinde/i,                         catMacro: "Despesas Variáveis",   segment: "Despesas com Vendas" },

  // ── DESPESAS VARIÁVEIS — Taxas Accor ──
  { pattern: /auditoria.*servi.*software/i,      catMacro: "Despesas Variáveis",   segment: "Taxas Accor" },
  { pattern: /tars.*fideliza/i,                  catMacro: "Despesas Variáveis",   segment: "Taxas Accor" },
  { pattern: /royalt.*accor/i,                   catMacro: "Despesas Variáveis",   segment: "Taxas Accor" },
  { pattern: /taxa.*reserva.*accor/i,            catMacro: "Despesas Variáveis",   segment: "Taxas Accor" },
  { pattern: /fee.*marketing.*accor/i,           catMacro: "Despesas Variáveis",   segment: "Taxas Accor" },

  // ── DESPESAS VARIÁVEIS — Taxas de Administração ──
  { pattern: /taxa.*adm.*falcon/i,               catMacro: "Despesas Variáveis",   segment: "Taxas de Administração" },

  // ── DESPESAS VARIÁVEIS — Financeiras ──
  { pattern: /tarifa.*banc/i,                    catMacro: "Despesas Variáveis",   segment: "Despesas Financeiras" },
  { pattern: /taxa.*antecipa/i,                  catMacro: "Despesas Variáveis",   segment: "Despesas Financeiras" },
  { pattern: /^pcld$/i,                          catMacro: "Despesas Variáveis",   segment: "Despesas Financeiras" },
  { pattern: /juros\s*passivo/i,                 catMacro: "Despesas Variáveis",   segment: "Despesas Financeiras" },
  { pattern: /desconto.*concedido/i,             catMacro: "Despesas Variáveis",   segment: "Despesas Financeiras" },

  // ── DEDUÇÕES PÓS GOP ──
  { pattern: /tcl|iptu/i,                        catMacro: "Deduções pós GOP",     segment: "Total dos Gastos de Propriedade" },
  { pattern: /fundo.*reserva/i,                  catMacro: "Deduções pós GOP",     segment: "Total dos Gastos de Propriedade" },
  { pattern: /taxa.*adm.*gop/i,                  catMacro: "Deduções pós GOP",     segment: "Total dos Gastos de Propriedade" },
  { pattern: /gasto.*propriedade/i,              catMacro: "Deduções pós GOP",     segment: "Total dos Gastos de Propriedade" },
  { pattern: /^irpj$/i,                          catMacro: "Deduções pós GOP",     segment: "Total dos Impostos sobre o Lucro" },
  { pattern: /^csll$/i,                          catMacro: "Deduções pós GOP",     segment: "Total dos Impostos sobre o Lucro" },
  { pattern: /taxa.*sucesso/i,                   catMacro: "Deduções pós GOP",     segment: "Total de Taxas sobre o Lucro Líquido" },
  { pattern: /compensa.*prejuiz/i,               catMacro: "Deduções pós GOP",     segment: "Total de Prejuízo a compensar" },
  { pattern: /irrf.*aplica/i,                    catMacro: "Despesas Variáveis",   segment: "Despesas Financeiras" },

  // ── Entradas adicionais ──
  { pattern: /^benef[íi]cio/i,                   catMacro: "Despesas Fixas",       segment: "Despesas com Pessoal" },
  { pattern: /outras.*despesa.*funcion/i,        catMacro: "Despesas Fixas",       segment: "Despesas com Pessoal" },
  { pattern: /outros.*custo.*servi/i,            catMacro: "Despesas Fixas",       segment: "Despesas com Prestadores de Serviços" },
  { pattern: /outras.*despesa.*operac/i,         catMacro: "Despesas Fixas",       segment: "Despesas Operacionais" },
  { pattern: /condu.*transport/i,                catMacro: "Despesas Fixas",       segment: "Despesas Operacionais" },
  { pattern: /publicidade.*propaganda/i,         catMacro: "Despesas Variáveis",   segment: "Despesas com Vendas" },
  { pattern: /assessoria.*vend.*rm/i,            catMacro: "Despesas Variáveis",   segment: "Despesas com Vendas" },
  { pattern: /^taxas\s+accor$/i,                 catMacro: "Despesas Variáveis",   segment: "Taxas Accor" },
  { pattern: /juros\s*passivo/i,                 catMacro: "Despesas Variáveis",   segment: "Despesas Financeiras" },
  { pattern: /desconto.*concedido/i,             catMacro: "Despesas Variáveis",   segment: "Despesas Financeiras" },
];

export function getDreLineCategorization(label: string): DreLineMapping | null {
  for (const entry of DRE_LINE_MAP) {
    if (entry.pattern.test(label)) {
      return { catMacro: entry.catMacro, segment: entry.segment };
    }
  }
  return null;
}

/**
 * Árvore fixa de exibição das Linhas da DRE.
 * Estrutura: Grupo (nível 1) → Subcategoria (nível 2) → Linha específica (nível 3)
 * Os labels são usados para buscar os valores salvos no banco.
 */
export interface DreTreeNode {
  label: string;
  children?: DreTreeNode[];
}

export const DRE_FIXED_TREE: DreTreeNode[] = [
  {
    label: "Topline",
    children: [
      { label: "Apartamentos Ocupados" },
      { label: "Taxa de Ocupação" },
      { label: "Número de Hóspedes" },
      { label: "Fator de Ocupação" },
      { label: "Diária Média (ADR)" },
      { label: "RevPAR" },
    ],
  },
  {
    label: "Receitas",
    children: [
      {
        label: "Receita Bruta Total",
        children: [
          {
            label: "Receita Bruta de Serviços",
            children: [
              { label: "Receita de Hospedagem" },
              { label: "No Show" },
              { label: "(-) Café da Manhã" },
            ],
          },
          {
            label: "Receita Bruta A&B",
            children: [
              { label: "Receita das Mercadorias Vendidas" },
              { label: "(+) Café da Manhã" },
            ],
          },
          {
            label: "Receita Financeira Líquida",
            children: [
              { label: "Receitas de Aplicações Financeiras" },
              { label: "(-) Rendimentos de Fundo de Reserva" },
              { label: "Juros Ativos" },
              { label: "Descontos Financeiros Obtidos" },
            ],
          },
          {
            label: "Outras Receitas",
            children: [
              { label: "Aluguéis de Salas de Eventos" },
              { label: "Lavanderia de Hóspedes" },
              { label: "Receita de Estacionamento" },
              { label: "Outras Receitas" },
            ],
          },
        ],
      },
      {
        label: "Deduções da Receita Total",
        children: [
          { label: "ISS" },
          { label: "ICMS" },
          { label: "PIS" },
          { label: "COFINS" },
        ],
      },
      { label: "Receita Líquida Total" },
      { label: "Resultado Operacional Bruto (GOP)" },
      { label: "Resultado Operacional Líquido" },
      { label: "Lucro Líquido / Prejuízo do Exercício" },
      { label: "Total de Taxas sobre o Lucro Líquido" },
      { label: "Lucro / Prejuízo a Distribuir do período" },
      { label: "Distribuição por UH" },
      { label: "Por UH" },
    ],
  },
  {
    label: "Despesas",
    children: [
      { label: "Despesas Totais" },
      {
        label: "Despesas Fixas Totais",
        children: [
          {
            label: "(-) Custo das Mercadorias Vendidas",
            children: [
              { label: "(-) Custo com Mercadorias Vendidas" },
              { label: "(-) Custo com Café da manhã" },
            ],
          },
          {
            label: "Despesas com Pessoal",
            children: [
              { label: "Salários" },
              { label: "Férias" },
              { label: "Encargos" },
              { label: "Vale Refeição e Alimentação" },
              { label: "Vale transporte" },
              { label: "Rescisões" },
              { label: "Uniformes / EPI" },
              { label: "Lavanderia Funcionários" },
              { label: "Treinamentos" },
              { label: "Confraternizações" },
              { label: "Plano de Saúde e Medicina do Trabalho" },
              { label: "Mão de Obra Direta - PF" },
              { label: "Mão de Obra Direta - PJ" },
              { label: "(-) Repasse de Salários" },
              { label: "Benefícios" },
            ],
          },
          {
            label: "Despesas Operacionais",
            children: [
              { label: "Taxa de Condomínio" },
              { label: "Aluguéis de máquinas e equipamentos" },
              { label: "Material de Escritório" },
              { label: "Materiais de Informática" },
              { label: "Telefonia, Internet e TV a Cabo." },
              { label: "Correios" },
              { label: "Impressos e Formulários" },
              { label: "Associação de Classe" },
              { label: "Viagens e Estadias" },
              { label: "Despesas com Alimentação" },
              { label: "Condução, Transporte e Fretes" },
              { label: "Decoração / Animação" },
              { label: "Seguros" },
              { label: "ECAD - direitos autorais" },
              { label: "Taxas e Emolumentos" },
              { label: "Aquisição de bens de pequeno valor" },
              { label: "Despesas não previstas" },
            ],
          },
          {
            label: "Despesas com Prestadores de Serviços",
            children: [
              { label: "Assessoria Contábil" },
              { label: "Auditoria e Consultoria" },
              { label: "Advocacia" },
              { label: "Assistência em Software" },
              { label: "Serviços Prestados Por Terceiros" },
            ],
          },
        ],
      },
      {
        label: "Despesas Variáveis Totais",
        children: [
          {
            label: "Custos de Hospedagem",
            children: [
              { label: "Amenities" },
              { label: "Materiais de Apartamento" },
              { label: "Lavanderia Enxoval" },
              { label: "Lavanderia Hóspedes" },
              { label: "Material de Limpeza" },
              { label: "Utensílios e Materiais de Cozinha" },
            ],
          },
          {
            label: "Despesas com Vendas",
            children: [
              { label: "Comissões de Agências / Reservas" },
              { label: "Comissões de Cartão de Crédito" },
              { label: "Publicidade, Propaganda e Marketing" },
              { label: "Assessoria de Vendas e RM" },
              { label: "Despesa com viagens comerciais" },
              { label: "Brindes" },
            ],
          },
          {
            label: "Despesas com Manutenção",
            children: [
              { label: "Contratos de Manutenção" },
              { label: "Laudos" },
              { label: "Materiais de Manutenção" },
              { label: "Serviços eventuais de Manutenção" },
            ],
          },
          {
            label: "Despesas de Utilidades",
            children: [
              { label: "Energia Elétrica" },
              { label: "Água e Esgoto" },
              { label: "Gás" },
            ],
          },
          {
            label: "Taxas Accor",
            children: [
              { label: "Auditorias, Serviços e Softwares" },
              { label: "Tars e Fidelização" },
              { label: "Royalties Accor" },
              { label: "Taxas de reserva Accor" },
              { label: "Fees de Marketing Accor" },
            ],
          },
          {
            label: "Taxas de Administração",
            children: [
              { label: "Taxas de Administração Falcon s/ Receita" },
            ],
          },
          {
            label: "Despesas Financeiras",
            children: [
              { label: "Tarifas Bancárias" },
              { label: "Taxa de antecipação" },
              { label: "IRRF - Aplicação Financeira" },
              { label: "PCLD" },
              { label: "Juros Passivos" },
              { label: "Descontos Concedidos" },
            ],
          },
        ],
      },
      {
        label: "Deduções pós GOP",
        children: [
          {
            label: "Total dos Gastos de Propriedade",
            children: [
              { label: "(-) TCL / IPTU" },
              { label: "(-) Fundo de Reservas e Reposição Patrimonial" },
              { label: "(-) Taxa de Condomínio" },
              { label: "(-) Taxa de Administração s/ GOP" },
              { label: "(-) Gastos da propriedade" },
            ],
          },
          {
            label: "Total dos Impostos sobre o Lucro",
            children: [
              { label: "IRPJ" },
              { label: "CSLL" },
            ],
          },
          {
            label: "Total de Taxas sobre o Lucro Líquido",
            children: [
              { label: "Taxa de Sucesso" },
            ],
          },
          {
            label: "Total de Prejuízo a compensar",
            children: [
              { label: "Compensação de prejuizo acumulado" },
            ],
          },
        ],
      },
    ],
  },
];

export type IndicatorKey =
  | "ocupacao"
  | "adr"
  | "revpar"
  | "roomnights"
  | "distribuicao_por_uh"
  | "uhs_total"
  | "uhs_disponiveis"
  | "receita_hospedagem"
  | "receita_ab"
  | "receita_bruta_total"
  | "receita_liquida_total"
  | "gop"
  | "ebitda"
  | "lucro_liquido";

export interface IndicatorHit {
  key: IndicatorKey;
  label: string;
  value: number | null;
  row: number;
  sheet: string;
}

export interface ParsedDre {
  template: DreTemplate;
  sheetUsed: string;
  indicators: Record<IndicatorKey, IndicatorHit | null>;
  lines: { row: number; label: string; value: number | null; level?: number }[];
  warnings: string[];
  monthColumnIndex: number | null;
  monthHeaderLabel: string | null;
  /**
   * Séries mensais Jan-Dez (1..12) por indicador, extraídas:
   * - `currentSeries`: da própria aba DRE do ano corrente (12 colunas mensais)
   * - `previousSeries`: da aba "ANO ANTERIOR" quando existir
   * Usadas pelos gráficos comparativos da Carta ao Investidor.
   */
  currentSeries: Partial<Record<IndicatorKey, (number | null)[]>>;
  previousSeries: Partial<Record<IndicatorKey, (number | null)[]>>;
  /**
   * Indicadores do MESMO MÊS do ano anterior (lidos da aba "ANO ANTERIOR"),
   * para exibir lado a lado na Carta (ex.: "Ocupação 55% / Ano anterior 39%").
   */
  previousIndicators: Partial<Record<IndicatorKey, number | null>>;
  budgetSeries: Partial<Record<IndicatorKey, (number | null)[]>>;
  budgetIndicators: Partial<Record<IndicatorKey, number | null>>;
  budgetLines: Array<{
    label: string;
    level: number;
    values: Record<number, number | null>; // mes 1-12 → valor
  }>;
  prevLines: Array<{
    label: string;
    level: number;
    values: Record<number, number | null>;
  }>;
}

/**
 * Indicadores em ordem de prioridade. Cada indicador tem um conjunto de regex
 * para tentar bater com o rótulo da linha (mais à esquerda da linha).
 * Os regex foram construídos a partir das planilhas reais dos 4 modelos.
 */
export const INDICATORS: { key: IndicatorKey; rx: RegExp[] }[] = [
  { key: "uhs_total", rx: [/^n[úu]mero\s+de\s+apartamentos$/i, /^n[úu]mero\s+de\s+apartamentos\s+no/i, /^uhs?\s+pool/i] },
  { key: "uhs_disponiveis", rx: [/n[úu]mero\s+de\s+apartamentos\s+dispon/i, /^apartamentos\s+dispon[íi]veis/i, /uhs?\s+dispon/i] },
  { key: "roomnights", rx: [/^roomnights$/i, /^room\s*nights?$/i, /^apartamentos\s+ocupados/i] },
  { key: "ocupacao", rx: [/taxa\s+de\s+ocupa/i] },
  { key: "adr", rx: [/^di[áa]ria\s+m[ée]dia\s+bruta/i, /^di[áa]ria\s+m[ée]dia(\s+\(em\s+r\$\))?$/i, /^di[áa]ria\s+m[ée]dia(?!\s+l[íi]quida)/i] },
  { key: "revpar", rx: [/^revpar\s+total/i, /^revpar\s+hospedagem/i, /^revpar(\s+\(em\s+r\$\))?$/i, /revpar/i] },
  { key: "receita_hospedagem", rx: [/^receita\s+(de\s+)?hospedagem/i] },
  { key: "receita_ab", rx: [/^receita\s+(bruta\s+)?a&b/i, /^receita\s+de\s+a&b/i, /^receitas?\s+(de\s+)?alimentos?\s+e\s+bebidas?/i] },
  { key: "receita_bruta_total", rx: [/^receita\s+bruta\s+total/i, /^receita\s+total\s+bruta/i, /^total\s+das?\s+receitas?\s+brutas?/i] },
  { key: "receita_liquida_total", rx: [/^receita\s+l[íi]quida\s+total/i, /^receita\s+total\s+l[íi]quida/i, /^\(=\)\s*receita\s+l[íi]quida/i, /^receita\s+l[íi]quida(?:\s|$)/i] },
  { key: "gop", rx: [/^resultado\s+operacional\s+bruto/i, /\bgop\b/i] },
  { key: "ebitda", rx: [/ebitda/i] },
  { key: "lucro_liquido", rx: [/^lucro\s+l[íi]quido/i, /^resultado\s+l[íi]quido\s+do\s+exerc/i, /^resultado\s+l[íi]quido/i] },
  { key: "distribuicao_por_uh", rx: [/^por\s+uh$/i] },
];

/**
 * Identifica o template a partir das abas existentes.
 * Mapeamento validado com planilhas reais (Modelo_-_Demais, Modelo_Mercure,
 * Modelo_Manhattan, Modelo_Confins).
 */
function detectTemplate(sheetNames: string[]): DreTemplate {
  const lower = sheetNames.map((n) => n.toLowerCase());
  const has = (s: string) => lower.some((n) => n.includes(s));
  // MANHATTAN: aba "DRE COLUNADO POOL" + várias abas com sufixos _COND/_POOL
  if (has("dre colunado pool") || has("dre_colunado_cond") || has("painel pool")) return "MANHATTAN";
  // MERCURE: aba "POOL - DRE COLUNADO"
  if (has("pool - dre colunado") || has("pool - balanço patrimonial")) return "MERCURE";
  // CONFINS: muitas abas "Ajuste <mês>" + "Lucro Presumido"
  const ajusteCount = lower.filter((n) => n.startsWith("ajuste ")).length;
  if (ajusteCount >= 5 || has("lucro presumido") || has("irpj.csll.l.presumido")) return "CONFINS";
  return "DEFAULT";
}

/**
 * Seleciona a aba que contém a DRE colunada com indicadores e valores mensais.
 * SEMPRE prefere a aba "crua" (não "Carta DRE") porque ela tem os números
 * mensais nas colunas, enquanto "Carta DRE" agrega trimestres / acumulados.
 */
function pickSheet(wb: XLSX.WorkBook, template: DreTemplate): string {
  const names = wb.SheetNames;
  const lower = names.map((n) => n.toLowerCase());
  const find = (test: (n: string) => boolean) => {
    const i = lower.findIndex(test);
    return i >= 0 ? names[i] : null;
  };
  if (template === "MANHATTAN") {
    return find((n) => n === "dre colunado pool") ?? find((n) => n.includes("dre colunado pool")) ?? find((n) => n === "dre") ?? names[0];
  }
  if (template === "MERCURE") {
    return find((n) => n === "pool - dre colunado") ?? find((n) => n.includes("dre colunado")) ?? names[0];
  }
  if (template === "CONFINS") {
    return find((n) => n === "dre") ?? find((n) => n.includes("dre") && !n.includes("old") && !n.includes("carta")) ?? names[0];
  }
  // DEFAULT: aba "DRE" (não "DRE (3)" nem "Carta DRE")
  return find((n) => n === "dre") ?? find((n) => n.includes("dre") && !n.includes("(") && !n.includes("carta")) ?? names[0];
}

/**
 * Nomes (e abreviações) dos meses em PT-BR para detectar o cabeçalho.
 * Cada mês tem múltiplas variantes aceitas — qualquer prefixo por 3 letras
 * (jan, fev, mar, abr, mai, jun, jul, ago, set, out, nov, dez) também bate.
 */
const MONTH_VARIANTS: string[][] = [
  ["janeiro", "jan"],
  ["fevereiro", "fev"],
  ["março", "marco", "mar"],
  ["abril", "abr"],
  ["maio", "mai"],
  ["junho", "jun"],
  ["julho", "jul"],
  ["agosto", "ago"],
  ["setembro", "set"],
  ["outubro", "out"],
  ["novembro", "nov"],
  ["dezembro", "dez"],
];

function matchMonth(norm: string, targetMonth: number): boolean {
  const variants = MONTH_VARIANTS[targetMonth - 1] ?? [];
  for (const v of variants) {
    if (norm === v) return true;
    if (norm.startsWith(v + "/")) return true;     // "abr/24"
    if (norm.startsWith(v + "-")) return true;     // "abr-24"
    if (norm.startsWith(v + " ")) return true;     // "abril 2024"
    // Aceita o nome completo como prefixo (cobre "abril/24" e "abril 2024")
    if (v.length >= 4 && norm.startsWith(v)) return true;
  }
  // Aceita prefixo de 3 letras isolado (ex.: "abr" antes de algum sufixo qualquer)
  const short = variants.find((v) => v.length === 3);
  if (short && norm.length <= 8 && norm.startsWith(short)) return true;
  return false;
}

/**
 * Localiza a linha de cabeçalho com nomes de meses e devolve o índice da
 * coluna correspondente ao mês alvo (1=Jan ... 12=Dez), além do label.
 */
function findMonthColumn(
  rows: unknown[][],
  targetMonth: number,
): { headerRow: number; colIndex: number; label: string } | null {
  let dateMatch: { headerRow: number; colIndex: number; label: string } | null = null;
  for (let r = 0; r < Math.min(rows.length, 30); r++) {
    const row = rows[r] ?? [];
    for (let c = 0; c < row.length; c++) {
      const cell = row[c];
      if (typeof cell === "string") {
        const norm = cell.trim().toLowerCase();
        if (matchMonth(norm, targetMonth)) {
          return { headerRow: r, colIndex: c, label: cell.trim() };
        }
      }
      // CONFINS: cabeçalho com Date object (ex.: 2026-01-01)
      if (cell instanceof Date && dateMatch === null) {
        if (cell.getMonth() + 1 === targetMonth) {
          dateMatch = { headerRow: r, colIndex: c, label: cell.toISOString().slice(0, 10) };
        }
      }
    }
  }
  return dateMatch;
}

/** Extrai label da linha (primeira string não-vazia). */
function rowLabel(row: unknown[]): string | null {
  for (const cell of row) {
    if (typeof cell === "string" && cell.trim().length > 0) return cell.trim();
  }
  return null;
}

/**
 * Extrai label e nível hierárquico baseado na coluna onde o texto aparece.
 * Convenção: col 3 = nível 1, col 4 = nível 2, col 5 = nível 3.
 * Fallback: usa rowLabel + nível 3.
 */
function rowLabelAndLevel(
  row: unknown[],
  firstMonthCol: number,
): { label: string; level: number } | null {
  const textCols: { col: number; text: string }[] = [];
  for (let c = 2; c < firstMonthCol; c++) {
    const cell = row[c];
    if (typeof cell === "string" && cell.trim().length > 1) {
      textCols.push({ col: c, text: cell.trim() });
    }
  }
  if (textCols.length === 0) return null;
  const COLUMN_HEADERS = /^(realizado|or[çc]ado|desvio|ano\s*anterior|acumulado|m[ée]dia|total|ytd|janeiro|fevereiro|mar[çc]o|abril|maio|junho|julho|agosto|setembro|outubro|novembro|dezembro)$/i;
  const validCols = textCols.filter((c) => !COLUMN_HEADERS.test(c.text));
  if (validCols.length === 0) return null;
  const minCol = Math.min(...validCols.map((c) => c.col));
  const maxCol = Math.max(...validCols.map((c) => c.col));
  const range = maxCol - minCol || 1;
  const rightmost = validCols.reduce((a, b) => (a.col > b.col ? a : b));
  const relPos = (rightmost.col - minCol) / range;
  const level = relPos < 0.33 ? 1 : relPos < 0.66 ? 2 : 3;
  return { label: rightmost.text, level };
}

/**
 * Retorna o valor da linha para uma coluna específica. Se a coluna estiver
 * vazia, faz fallback para o último número finito não-zero da linha.
 *
 * IMPORTANTE: o fallback SÓ é usado quando `colIndex` é null (não foi possível
 * localizar a coluna do mês). Quando temos a coluna correta, devolvemos
 * exatamente o valor dela — inclusive 0 ou null — para evitar que o parser
 * pegue valores de colunas "Média"/"Total" por engano.
 */
function rowValueAt(
  row: unknown[],
  colIndex: number | null,
  excludeCols?: Set<number>,
): number | null {
  if (colIndex != null) {
    const c = row[colIndex];
    if (typeof c === "number" && Number.isFinite(c)) return c;
    // Coluna localizada mas célula vazia/string → não cai em fallback,
    // pois isso traria valores de outros meses (ex.: coluna "Média").
    return null;
  }
  for (let i = row.length - 1; i >= 0; i--) {
    if (excludeCols?.has(i)) continue;
    const c = row[i];
    if (typeof c === "number" && Number.isFinite(c) && c !== 0) return c;
  }
  return null;
}

export async function parseDreExcel(
  file: File,
  opts: { targetMonth?: number } = {},
): Promise<ParsedDre> {
  const buf = await file.arrayBuffer();
  // cellDates: true para que CONFINS (datas no header) gere objetos Date
  const wb = XLSX.read(buf, { type: "array", cellDates: true });
  const template = detectTemplate(wb.SheetNames);
  const sheetName = pickSheet(wb, template);
  const ws = wb.Sheets[sheetName];
  if (!ws) throw new Error(`Aba não encontrada (${sheetName})`);
  const rows: unknown[][] = XLSX.utils.sheet_to_json(ws, {
    header: 1, blankrows: false, defval: null, raw: true,
  });

  const indicators: Record<IndicatorKey, IndicatorHit | null> = {
    ocupacao: null, adr: null, revpar: null, roomnights: null,
    distribuicao_por_uh: null,
    uhs_total: null, uhs_disponiveis: null,
    receita_hospedagem: null, receita_ab: null,
    receita_bruta_total: null, receita_liquida_total: null,
    gop: null, ebitda: null, lucro_liquido: null,
  };
  const lines: ParsedDre["lines"] = [];
  const warnings: string[] = [];

  // Localiza a coluna do mês alvo. Se não informado, último mês com dado é usado (fallback).
  const targetMonth = opts.targetMonth;
  const monthInfo = targetMonth ? findMonthColumn(rows, targetMonth) : null;
  const monthCol = monthInfo?.colIndex ?? null;
  if (targetMonth && !monthInfo) {
    warnings.push(`Coluna do mês ${targetMonth} não localizada no cabeçalho — usando fallback.`);
  }

  // Identifica colunas de "Média/Total/Acumulado" no cabeçalho para EVITAR
  // que o fallback de rowValueAt as utilize quando monthCol falha.
  const aggregateCols = new Set<number>();
  for (let r = 0; r < Math.min(rows.length, 30); r++) {
    const row = rows[r] ?? [];
    for (let c = 0; c < row.length; c++) {
      const cell = row[c];
      if (typeof cell === "string") {
        const norm = cell.trim().toLowerCase();
        if (/^(m[ée]dia|total|acumulado|ano|ytd)\b/.test(norm)) aggregateCols.add(c);
      }
    }
  }

  // Detecta a primeira coluna de mês para servir de referência ao
  // determinar quais colunas são labels vs dados.
  let firstMonthCol = 6;
  let firstMonthColFound = false;
  for (let r = 0; r < Math.min(rows.length, 30); r++) {
    const row = rows[r] ?? [];
    for (let c = 0; c < row.length; c++) {
      const cell = row[c];
      if (typeof cell === "string") {
        const norm = cell.trim().toLowerCase();
        if (/^(janeiro|jan)/.test(norm)) {
          firstMonthCol = c;
          firstMonthColFound = true;
          break;
        }
      }
      if (cell instanceof Date && cell.getMonth() === 0) {
        if (!firstMonthColFound) {
          firstMonthCol = c;
          firstMonthColFound = true;
        }
        break;
      }
    }
    if (firstMonthColFound) break;
  }

  rows.forEach((row, idx) => {
    if (!row || row.every((c) => c == null || c === "")) return;
    const ll = rowLabelAndLevel(row, firstMonthCol);
    if (!ll) return;
    const { label, level } = ll;
    // Remove código contábil do início do label (ex: "3010101001 Diárias" → "Diárias")
    // MAS só se o restante tiver pelo menos 3 chars (evita apagar labels numéricos válidos)
    const cleanLabel = label.replace(/^\d[\d\.]*\s+/, "").trim();
    const finalLabel = cleanLabel.length >= 3 ? cleanLabel : label;
    // Filtra labels estruturais que não devem aparecer no seletor de
    // Indicadores DRE (cabeçalhos de seção, títulos de planilha etc.).
    const STRUCTURAL_LABELS = [
      /^dre(\s|$)/i,
      /^topline$/i,
      /^receitas?$/i,
      /^despesas?$/i,
      /^resultado$/i,
      /^acumulado$/i,
      /^nivel$/i,
      /^nível$/i,
      /distribui[çc][aã]o\s+por\s+uh$/i,
      /^>>>/,
      /^resultado\s+acumulado/i,
      /^lucro\s*\/\s*prejuízo\s+acumulado/i,
      /^lucro\s+antes/i,
      /^\d{5,}/,                           // linha começa com código contábil (5+ dígitos)
      /^\d{4,}\.\d/,                       // código no formato 3.1.2.03.001
    ];
    if (STRUCTURAL_LABELS.some((rx) => rx.test(label))) return;
    if (/dre\s+\d{4}/i.test(label)) return;
    let value = rowValueAt(row, monthCol, aggregateCols);
    // CONFINS: "UHs Pool: 280" — extrai o número embutido no rótulo
    if (value == null) {
      const m = finalLabel.match(/(\d{2,5})\s*$/);
      if (m) value = Number(m[1]);
    }
    lines.push({ row: idx + 1, label: finalLabel, value, level });
    for (const ind of INDICATORS) {
      if (indicators[ind.key]) continue;
      if (ind.rx.some((rx) => rx.test(finalLabel))) {
        indicators[ind.key] = { key: ind.key, label: finalLabel, value, row: idx + 1, sheet: sheetName };
      }
    }
  });

  if (!indicators.gop) warnings.push("GOP / Resultado Operacional Bruto não localizado.");
  if (!indicators.receita_bruta_total) warnings.push("Receita Bruta Total não localizada.");
  if (!indicators.ocupacao) warnings.push("Taxa de Ocupação não localizada.");
  if (!indicators.lucro_liquido) warnings.push("Lucro Líquido não localizado.");
  warnings.push(`[DEBUG] firstMonthCol=${firstMonthCol}, monthCol=${monthCol}, template=${template}, sheet=${sheetName}, totalRows=${rows.length}`);

  // ─── Séries mensais Jan-Dez para gráficos da Carta ───
  // Chaves de interesse para os gráficos:
  const SERIES_KEYS: IndicatorKey[] = ["ocupacao", "adr", "receita_bruta_total"];
  const currentSeries = extractMonthlySeries(rows, SERIES_KEYS);

  // Aba "ANO ANTERIOR" (presente nos modelos DEFAULT/MERCURE/MANHATTAN)
  const prevSheetName = wb.SheetNames.find((n) => /ano\s*anterior/i.test(n));
  let previousSeries: Partial<Record<IndicatorKey, (number | null)[]>> = {};
  let previousIndicators: Partial<Record<IndicatorKey, number | null>> = {};
  if (prevSheetName) {
    const prevWs = wb.Sheets[prevSheetName];
    if (prevWs) {
      const prevRows: unknown[][] = XLSX.utils.sheet_to_json(prevWs, {
        header: 1, blankrows: false, defval: null, raw: true,
      });
      previousSeries = extractMonthlySeries(prevRows, SERIES_KEYS);
      // Para a tabela de "Indicadores extraídos" precisamos do MESMO mês
      // do ano anterior — em todas as métricas (não só as 3 dos gráficos).
      if (targetMonth) {
        const prevMonthInfo = findMonthColumn(prevRows, targetMonth);
        const prevMonthCol = prevMonthInfo?.colIndex ?? null;
        const allKeys: IndicatorKey[] = INDICATORS.map((i) => i.key);
        for (const k of allKeys) {
          const rxs = INDICATORS.find((i) => i.key === k)?.rx ?? [];
          for (const row of prevRows) {
            const lbl = rowLabel(row ?? []);
            if (!lbl) continue;
            if (rxs.some((rx) => rx.test(lbl))) {
              const v = rowValueAt(row, prevMonthCol);
              previousIndicators[k] = typeof v === "number" ? v : null;
              break;
            }
          }
        }
      }
    }
  } else {
    warnings.push('Aba "ANO ANTERIOR" não localizada — gráficos comparativos sem série prévia.');
  }

  // Aba "Orçamento" — série Jan-Dez dos valores orçados
  const budgetSheetName = wb.SheetNames.find((n) => /or[çc]amento/i.test(n));
  let budgetSeries: Partial<Record<IndicatorKey, (number | null)[]>> = {};
  let budgetIndicators: Partial<Record<IndicatorKey, number | null>> = {};
  if (budgetSheetName) {
    const budgetWs = wb.Sheets[budgetSheetName];
    if (budgetWs) {
      const budgetRows: unknown[][] = XLSX.utils.sheet_to_json(budgetWs, {
        header: 1, blankrows: false, defval: null, raw: true,
      });
      budgetSeries = extractMonthlySeries(budgetRows, SERIES_KEYS);
      if (targetMonth) {
        const budgetMonthInfo = findMonthColumn(budgetRows, targetMonth);
        const budgetMonthCol = budgetMonthInfo?.colIndex ?? null;
        const allKeys: IndicatorKey[] = INDICATORS.map((i) => i.key);
        for (const k of allKeys) {
          const rxs = INDICATORS.find((i) => i.key === k)?.rx ?? [];
          for (const row of budgetRows) {
            const lbl = rowLabel(row ?? []);
            if (!lbl) continue;
            if (rxs.some((rx) => rx.test(lbl))) {
              const v = rowValueAt(row, budgetMonthCol);
              budgetIndicators[k] = typeof v === "number" ? v : null;
              break;
            }
          }
        }
      }
    }
  }

  return {
    template,
    sheetUsed: sheetName,
    indicators,
    lines,
    warnings,
    monthColumnIndex: monthCol,
    monthHeaderLabel: monthInfo?.label ?? null,
    currentSeries,
    previousSeries,
    previousIndicators,
    budgetSeries,
    budgetIndicators,
  };
}

/**
 * Extrai, para cada indicador-chave, a série Jan-Dez (12 valores) percorrendo
 * os cabeçalhos de meses na planilha. Quando uma coluna mensal não existir,
 * o slot fica `null` (gráfico ignora).
 */
function extractMonthlySeries(
  rows: unknown[][],
  keys: IndicatorKey[],
): Partial<Record<IndicatorKey, (number | null)[]>> {
  // Mapeia mês (1..12) → colIndex
  const monthCols = new Map<number, number>();
  for (let m = 1; m <= 12; m++) {
    const info = findMonthColumn(rows, m);
    if (info) monthCols.set(m, info.colIndex);
  }
  if (monthCols.size === 0) return {};
  const out: Partial<Record<IndicatorKey, (number | null)[]>> = {};
  for (const key of keys) {
    const rxs = INDICATORS.find((i) => i.key === key)?.rx ?? [];
    if (!rxs.length) continue;
    // Acha 1ª linha com label que bata o regex
    let hitRow: unknown[] | null = null;
    for (const row of rows) {
      const label = rowLabel(row ?? []);
      if (!label) continue;
      if (rxs.some((rx) => rx.test(label))) { hitRow = row; break; }
    }
    if (!hitRow) continue;
    const series: (number | null)[] = new Array(12).fill(null);
    for (const [m, c] of monthCols) {
      const cell = hitRow[c];
      if (typeof cell === "number" && Number.isFinite(cell)) series[m - 1] = cell;
    }
    out[key] = series;
  }
  return out;
}

export const INDICATOR_LABELS: Record<IndicatorKey, string> = {
  ocupacao: "Taxa de Ocupação",
  adr: "Diária Média (ADR)",
  revpar: "RevPAR",
  roomnights: "Room Nights",
  distribuicao_por_uh: "Distribuição por UH",
  uhs_total: "UHs Totais",
  uhs_disponiveis: "UHs Disponíveis",
  receita_hospedagem: "Receita de Hospedagem",
  receita_ab: "Receita A&B",
  receita_bruta_total: "Receita Bruta Total",
  receita_liquida_total: "Receita Líquida Total",
  gop: "GOP",
  ebitda: "EBITDA",
  lucro_liquido: "Lucro Líquido",
};

export function formatIndicator(key: IndicatorKey, value: number | null): string {
  if (value == null || !Number.isFinite(value)) return "—";
  if (key === "ocupacao") {
    // valores podem vir em fração (0.48) ou já em porcentagem
    const pct = value <= 1 ? value * 100 : value;
    return `${pct.toFixed(1)}%`;
  }
  if (key === "roomnights" || key === "uhs_total" || key === "uhs_disponiveis") {
    return Math.round(value).toLocaleString("pt-BR");
  }
  if (key === "adr" || key === "revpar" || key === "distribuicao_por_uh") {
    return value.toLocaleString("pt-BR", { style: "currency", currency: "BRL", minimumFractionDigits: 2 });
  }
  return value.toLocaleString("pt-BR", { style: "currency", currency: "BRL", maximumFractionDigits: 0 });
}