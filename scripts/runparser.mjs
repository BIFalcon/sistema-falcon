import * as XLSX from "xlsx";
import fs from "fs";
const buf = fs.readFileSync("/tmp/jf.xlsx");
const wb = XLSX.read(buf, { type: "buffer", cellDates: true });
const ws = wb.Sheets["ANO ANTERIOR"];
const rows = XLSX.utils.sheet_to_json(ws, { header: 1, raw: true, defval: null });
console.log("row7", rows[7]);
console.log("row11", rows[11]);
