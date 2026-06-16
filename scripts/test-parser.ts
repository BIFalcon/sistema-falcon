import fs from "fs";
import * as XLSX from "xlsx";
import ssf from "ssf";
(XLSX as any).SSF = ssf;

const { parseDreExcel } = await import("../src/lib/dreParser");
async function run(path: string, hotelId: string) {
  const buf = fs.readFileSync(path);
  const file = new File([new Blob([buf])], "x.xlsx");
  const res = await parseDreExcel(file, { targetMonth: 5, targetYear: 2026, hotelId });
  console.log("\n===", path);
  console.log("Warnings:", res.warnings);
  console.log("prev RBT series:", res.previousSeries.receita_bruta_total);
  console.log("prev RBT Feb:", res.previousSeries.receita_bruta_total?.[1]);
  console.log("budget RBT series:", res.budgetSeries.receita_bruta_total);
}
await run("/mnt/user-uploads/DRE_ibis_Juiz_de_Fora_05.2026.xlsx", "ibis-juiz-de-fora");
await run("/mnt/user-uploads/DRE_Ibis_Budget_Divinópolis_05.2026.xlsx", "ibis-budget-divinopolis");
