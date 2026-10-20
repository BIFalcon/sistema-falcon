export interface LetterRevenueRow {
  kind: "item";
  label: string;
  rx: RegExp[];
}

/** Revenue composition is scoped to the closing's hotel, not the selected filter. */
export function getLetterRevenueRows(hotelId: string): LetterRevenueRow[] {
  if (hotelId === "manhattan-poa") {
    return [
      { kind: "item", label: "Receita de Hospedagem", rx: [/^receita de hospedagem$/i] },
      { kind: "item", label: "Outras Receitas de Hospedagem", rx: [/^outras receitas de hospedagem$/i] },
      { kind: "item", label: "Receita de A&B", rx: [/^receita de a&b$/i] },
      { kind: "item", label: "Receitas com Aluguéis", rx: [/^receitas com alugu[ée]is$/i] },
      { kind: "item", label: "Outras Receitas de Serviços e Vendas", rx: [/^outras receitas de servi[çc]os e vendas$/i] },
      { kind: "item", label: "Outras Receitas Operacionais", rx: [/^outras receitas operacionais$/i] },
    ];
  }
  return [
    { kind: "item", label: "Receita Bruta de Serviços", rx: [/receita\s+bruta\s+(de\s+)?servi[çc]os/i, /^receita\s+(de\s+)?hospedagem/i] },
    { kind: "item", label: "Receita Bruta A&B", rx: [/^receita\s+bruta\s+a&b/i, /^receita\s+(de\s+)?a&b/i, /alimentos?\s+e\s+bebidas?/i] },
    { kind: "item", label: "Receita Financeira Líquida", rx: [/receita\s+financeira/i] },
    { kind: "item", label: "Outras Receitas", rx: [/^outras\s+receitas/i] },
  ];
}

export function findLetterDreValue(
  lines: { label: string; value: number | null }[],
  patterns: RegExp[],
): number | null {
  const cleaned = lines.map((line) => ({
    label: line.label.replace(/^\[\w+\]\s*/, "").trim(),
    value: line.value,
  }));
  for (const pattern of patterns) {
    const hit = cleaned.find((line) => pattern.test(line.label));
    if (hit) return hit.value;
  }
  return null;
}