/** Repeat all server matching stages until a complete pass makes no changes. */
export async function reconcileUntilStable(runPass: () => Promise<number>): Promise<number> {
  let total = 0;
  for (;;) {
    const matched = await runPass();
    if (!Number.isSafeInteger(matched) || matched < 0) {
      throw new Error("Resultado inválido da conciliação automática.");
    }
    total += matched;
    if (matched === 0) return total;
  }
}