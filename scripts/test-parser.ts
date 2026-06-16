import * as XLSX from "xlsx";
import fs from "fs";
import { parseDre } from "../src/lib/dreParser";

const buf = fs.readFileSync("/mnt/user-uploads/DRE_ibis_Juiz_de_Fora_05.2026.xlsx");
const wb = XLSX.read(buf, { type: "buffer", cellDates: false });
const res = parseDre(wb, { fileName: "test", targetMonth: 5, targetYear: 2026, hotelId: "ibis-juiz-de-fora" });
console.log("Template:", res.template);
console.log("Warnings:", res.warnings);
console.log("\nprevious receita_bruta_total series:", res.previousSeries.receita_bruta_total);
console.log("\nprevious Feb specifically:", res.previousSeries.receita_bruta_total?.[1]);
