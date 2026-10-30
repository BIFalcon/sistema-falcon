export async function undoConciliation(
  matchId: string,
  execute: (matchId: string) => Promise<{ data: unknown; error: unknown }>,
): Promise<void> {
  if (!matchId) throw new Error("Conciliação indisponível");
  const { data, error } = await execute(matchId);
  if (error) throw error;
  if (data !== true) throw new Error("Não foi possível confirmar que a conciliação foi desfeita");
}