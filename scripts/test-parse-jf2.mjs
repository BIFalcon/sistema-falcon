import { parseDreExcel } from "../src/lib/dreParser.ts";
import fs from "fs";
const buf = fs.readFileSync("/tmp/jf.xlsx");
// simulate File API
const file = new File([buf], "jf.xlsx");
const res = await parseDreExcel(file, { targetMonth: 5, targetYear: 2026, hotelId: "ibis-juiz-de-fora" });
console.log("prev ocup:", res.previousSeries.ocupacao);
console.log("prev adr :", res.previousSeries.adr);
console.log("prev rbt :", res.previousSeries.receita_bruta_total);
console.log("warnings:", res.warnings);
