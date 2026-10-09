/**
 * Valida o nome do arquivo da DRE: "[Nome do Hotel] MM.YYYY".
 * Retorna a mensagem de erro, ou null se o nome estiver correto.
 */
const norm = (s: string) => s.trim().replace(/\s+/g, " ").toLocaleLowerCase("pt-BR");

export function validateDreFileName(
  fileName: string,
  hotelName: string,
  month: number,
  year: number,
): string | null {
  const base = fileName.replace(/\.[^.]+$/, "");
  const expected = `${String(month).padStart(2, "0")}.${year}`;
  const example = `${hotelName} ${expected}`;
  const m = base.trim().match(/^(.+?)\s+(\d{2})\.(\d{4})$/);
  if (!m) {
    return `Nome do arquivo fora do padrão. Use "[Nome do Hotel] MM.AAAA", por exemplo: "${example}.xlsx".`;
  }
  if (norm(m[1]) !== norm(hotelName)) {
    return `O arquivo parece ser de outro hotel ("${m[1].trim()}"). Este fechamento é do ${hotelName} — renomeie para "${example}".`;
  }
  if (`${m[2]}.${m[3]}` !== expected) {
    return `O arquivo parece ser de outro mês (${m[2]}.${m[3]}). Este fechamento é de ${expected} — renomeie para "${example}".`;
  }
  return null;
}
