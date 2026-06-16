import fs from "fs";
import * as XLSX from "xlsx";
import "xlsx/types";
// Force SSF module
import { SSF } from "ssf";
(XLSX as any).SSF = SSF;

const { parseDreExcel } = await import("../src/lib/dreParser");
const buf = fs.readFileSync("/mnt/user-uploads/DRE_ibis_Juiz_de_Fora_05.2026.xlsx");
const blob = new Blob([buf]);
const file = new File([blob], "DRE_ibis_Juiz_de_Fora_05.2026.xlsx");
const res = await parseDreExcel(file, { targetMonth: 5, targetYear: 2026, hotelId: "ibis-juiz-de-fora" });
console.log("MonthCol main:", res.monthColumnIndex);
console.log("Warnings:", res.warnings);
console.log("prev RBT:", res.previousSeries.receita_bruta_total);
console.log("budget RBT:", res.budgetSeries.receita_bruta_total);
