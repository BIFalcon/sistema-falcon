/** A geração atual é obrigatória; falhas nunca autorizam usar um PDF salvo. */
export async function requireLetterPdfBlob(buildBlob: () => Promise<Blob | null>): Promise<Blob> {
  const blob = await buildBlob();
  if (!blob || blob.size === 0) {
    throw new Error("Não foi possível gerar a carta. Tente novamente; nenhum PDF antigo foi baixado.");
  }
  return blob;
}