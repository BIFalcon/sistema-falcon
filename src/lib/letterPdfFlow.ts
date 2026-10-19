/** A geração atual é obrigatória; falhas nunca autorizam usar um PDF salvo. */
export async function requireLetterPdfBlob(buildBlob: () => Promise<Blob | null>): Promise<Blob> {
  const blob = await buildBlob();
  if (!blob || blob.size === 0) {
    throw new Error("Não foi possível gerar a carta. Tente novamente; nenhum PDF antigo foi baixado.");
  }
  return blob;
}
export const CHART_RENDER_ERROR =
  "Os gráficos da carta não puderam ser desenhados neste navegador. Desative extensões de privacidade/antivírus (bloqueio de Canvas) ou a aceleração gráfica do Chrome e tente novamente; nenhum PDF incompleto foi gerado.";

/** True se a imagem RGBA tem pixels não-brancos suficientes (gráfico realmente desenhado). */
export function hasVisibleInk(rgba: ArrayLike<number>, minRatio = 0.002): boolean {
  const total = Math.floor(rgba.length / 4);
  if (total === 0) return false;
  let ink = 0;
  for (let i = 0; i < rgba.length; i += 4) {
    if (rgba[i + 3] > 0 && (rgba[i] < 235 || rgba[i + 1] < 235 || rgba[i + 2] < 235)) ink++;
  }
  return ink / total >= minRatio;
}
