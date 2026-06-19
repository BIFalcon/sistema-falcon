import { parseDre } from "../src/lib/dreParser";
import fs from "fs";
const buf = fs.readFileSync("/tmp/jf.xlsx");
const res = parseDre(buf, { year: 2026, month: 5, hotelId: "ibis-juiz-de-fora" });
console.log("prev ocup series", res.previousSeries.ocupacao);
console.log("prev adr series", res.previousSeries.adr);
console.log("prev rbt series", res.previousSeries.receita_bruta_total);
