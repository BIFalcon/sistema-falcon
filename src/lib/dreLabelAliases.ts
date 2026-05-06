/**
 * Mapeamento manual de rótulos de linhas DRE entre as abas
 * "DRE" (realizado) ↔ "Orçamento" / "ANO ANTERIOR".
 *
 * Cada grupo é uma lista de rótulos considerados equivalentes — ao bater
 * uma linha, o sistema também procura todos os outros rótulos do mesmo
 * grupo nas séries de orçado / ano anterior.
 *
 * REGRA: só inclua aqui pares semanticamente equivalentes. Diferenças de
 * caixa, acentos, parênteses, espaços e prefixos contábeis "(=)/(+)/(-)"
 * já são tratadas pelo `looseLabelMatch`. Use esta tabela para:
 *   - sinônimos (Lucro/Resultado, Comissão/Comissões…)
 *   - typos consagrados (Fomulários, Materias…)
 *   - reordenação de termos (ECAD - direitos autorais ↔ Direitos Autorais - ECAD)
 *   - variações singular/plural quando o significado é o mesmo
 */
export const DRE_LABEL_ALIASES: string[][] = [
  // — Indicadores topo —
  ["Número de Hóspedes", "Números de Hóspedes"],
  ["Resultado Operacional Bruto (GOP)", "Lucro Operacional Bruto (GOP)", "GOP"],
  ["Receita Bruta Total", "Receita Total Bruta", "RECEITA BRUTA TOTAL", "Total Das Receitas Bruta"],
  ["Receita Líquida Total", "Receita Total Líquida", "RECEITA LÍQUIDA TOTAL"],
  ["Lucro Líquido", "Resultado Líquido", "Resultado Líquido do Exercício"],

  // — Receitas —
  ["Receita de Hospedagem", "Receitas de Hospedagem"],
  ["Receita Bruta A&B", "Receita de A&B", "Receitas de Alimentos e Bebidas (A&B)", "Receita Bruta de A&B"],
  ["Receita das Mercadorias Vendidas", "Receita Mercadoria Vendida -CONVENIENCIA"],
  ["Receitas de Aplicações Financeiras", "Receita de Aplicações Financeiras"],
  ["Receita de Estacionamento", "Estacionamento"],
  ["Aluguéis de Salas de Eventos", "Aluguel de Salas", "(-) Aluguel de Salas"],

  // — Pessoal —
  ["13º Salário", "13° Salário", "Décimo Terceiro Salário"],
  ["Salários", "Salários e Ordenados"],
  ["INSS", "I.N.S.S."],
  ["FGTS", "F.G.T.S."],
  ["Vale Transporte", "Vale transporte", "Vale-Transporte"],
  ["Vale Refeição e Alimentação", "Vale Refeição", "Vale Alimentação"],
  ["Plano de Saúde e Medicina do Trabalho", "Assistência Médica", "Assistência Médica Social", "Plano de Saúde"],
  ["Indenizações e Aviso Prévio", "Aviso Prévio", "Rescisões"],
  ["Despesas com Alimentação", "Alimentação de Funcionários"],

  // — Custos / despesas operacionais —
  ["Custos de Hospedagem", "Custo de Hospedagem", "Despesas de Hospedagem"],
  ["Custos de A&B", "Despesas de Alimentos e Bebidas (A&B)", "Custo com A&B", "Custos de Alimentos e Bebidas"],
  ["Custos de café da manhã", "(-) Custo com Café da manhã", "Custo de Café da Manhã"],
  ["Custos de restaurante", "Custo de Restaurante"],
  ["Comissões de Cartão de Crédito", "Comissão de Cartão de Crédito", "Comissão de Cartões de Crédito", "Comissões de Cartões de Crédito"],
  ["Comissões de Agências / Reservas", "Comissão de Agentes de Viagens", "Despesas de Comissão de Agências"],
  ["Lavanderia Funcionários", "Lavanderia Industrial - Funcionários", "Lavanderia de Funcionários"],
  ["Lavanderia de Hóspedes", "Lavanderia Industrial - Hóspedes", "Lavanderia Hóspedes"],
  ["Lavanderia", "Despesas com Lavanderia"],
  ["Material de Limpeza", "Materiais de Limpeza", "Material de Higiene e Limpeza"],
  ["Material de Escritório", "Materiais de Escritório"],
  ["Materiais de Manutenção", "Materias de Manutenção"],
  ["Impressos e Formulários", "Impressos e Fomulários"],
  ["Utensílios e Materiais de Cozinha", "Utensilios de Cozinha", "Utensílios de Cozinha"],
  ["ECAD - direitos autorais", "Direitos Autorais - ECAD", "ECAD"],
  ["Aluguéis de máquinas e equipamentos", "Aluguel de Equipamentos", "(-) Aluguel de Equipamentos"],
  ["Aluguel de Imóveis", "(-) Aluguel fixo", "Aluguel Fixo"],
  ["Despesas com Manutenção", "Custos com Manutenção", "Manutenção e Reparo"],
  ["Telefonia, Internet e TV a Cabo.", "Telefonia, Internet e TV a Cabo", "Telefone", "Telefonia"],
  ["Informática e Sistemas", "Assistência em Software", "Sistemas de Informática"],
  ["Publicidade, Propaganda e Marketing", "Publicidade e Propaganda"],
  ["Condução, Transporte e Fretes", "Condução e Transporte", "Condução, Transporte"],
  ["Gastos com Veículos e Deslocamentos", "Combustível e Estacionamento", "Combustível"],
  ["Decoração / Animação / Eventos", "Decoração / Animação", "Decoração e Animação"],
  ["Serviços Bancários", "Despesas Bancárias", "Tarifas Bancárias"],
  ["Treinamentos", "Treinamento", "Treinamento de Vendas"],

  // — Impostos / fees —
  ["(-) Impostos", "(-) Impostos s/ vendas e serviços", "(-) Impostos s/ Vendas", "(-) Impostos s/ serviços"],
  ["PIS/COFINS", "PIS / COFINS", "PIS e COFINS"],
  ["(-) Taxas operacionais", "Taxas Operacionais"],
  ["Fees Accor Hotels", "Taxas Accor", "Fees Accor"],
  ["Fees Falcon Hotels", "Taxas Falcon", "Fees Falcon"],
  ["IPTU", "(-) IPTU", "(-) TCL / IPTU", "TCL / IPTU"],

  // — Fundo de reserva / distribuição —
  ["(-) Fundo de Reservas e Reposição Patrimonial", "Fundo de Reservas", "Fundo de Reposição Patrimonial"],
  ["DISTRIBUIÇÃO POR UH", "Distribuição por UH", "Distribuição de Lucros por Quota"],
];

/**
 * Devolve um Map onde cada label apontado cai numa lista de equivalentes.
 * As chaves são os labels normalizados (lower, sem acento, sem parênteses,
 * sem pontuação) — coerente com `cleanForMatch` em `useDre.ts`.
 */
export function buildAliasIndex(
  cleanFn: (s: string) => string,
): Map<string, string[]> {
  const idx = new Map<string, string[]>();
  for (const group of DRE_LABEL_ALIASES) {
    const cleaned = group.map(cleanFn).filter((s) => s.length > 0);
    for (const k of cleaned) {
      if (!idx.has(k)) idx.set(k, []);
      idx.get(k)!.push(...cleaned.filter((c) => c !== k));
    }
  }
  return idx;
}