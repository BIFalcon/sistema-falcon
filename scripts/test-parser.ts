import fs from "fs";
const XLSX = await import("xlsx/xlsx.mjs");
(globalThis as any).XLSX = XLSX;
import { parseDreExcel } from "../src/lib/dreParser";

const buf = fs.readFileSync("/mnt/user-uploads/DRE_ibis_Juiz_de_Fora_05.2026.xlsx");
const file = new File([new Blob([buf])], "x.xlsx");
const res = await parseDreExcel(file, { targetMonth: 5, targetYear: 2026, hotelId: "ibis-juiz-de-fora" });
console.log("budget RBT series:", res.budgetSeries.receita_bruta_total);
console.log("budget RBT JUN:", res.budgetSeries.receita_bruta_total?.[5]);
console.log("budget RBT MAI:", res.budgetSeries.receita_bruta_total?.[4]);
