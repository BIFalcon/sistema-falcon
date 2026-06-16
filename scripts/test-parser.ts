import fs from "fs";
const XLSX = await import("xlsx/xlsx.mjs");
(globalThis as any).XLSX = XLSX;
import { parseDreExcel } from "../src/lib/dreParser";

async function run(path: string, hotelId: string) {
  const buf = fs.readFileSync(path);
  const file = new File([new Blob([buf])], "x.xlsx");
  const res = await parseDreExcel(file, { targetMonth: 5, targetYear: 2026, hotelId });
  console.log("\n===", path);
  console.log("Warnings:", res.warnings);
  console.log("prev RBT:", res.previousSeries.receita_bruta_total);
  console.log("budget RBT:", res.budgetSeries.receita_bruta_total);
}
await run("/mnt/user-uploads/DRE_ibis_Juiz_de_Fora_05.2026.xlsx", "ibis-juiz-de-fora");
