import fs from "fs";
import { parseDreExcel } from "../src/lib/dreParser";

const buf = fs.readFileSync("/mnt/user-uploads/DRE_ibis_Juiz_de_Fora_05.2026.xlsx");
const blob = new Blob([buf]);
const file = new File([blob], "DRE_ibis_Juiz_de_Fora_05.2026.xlsx");
const res = await parseDreExcel(file, { targetMonth: 5, targetYear: 2026, hotelId: "ibis-juiz-de-fora" });
console.log("Template:", res.template);
console.log("MonthCol:", res.monthColumnIndex);
console.log("Warnings:", res.warnings);
console.log("\nprev RBT series:", res.previousSeries.receita_bruta_total);
console.log("prev Feb:", res.previousSeries.receita_bruta_total?.[1]);
console.log("\nbudget RBT series:", res.budgetSeries.receita_bruta_total);
