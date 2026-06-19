import * as XLSX from "xlsx";
import fs from "fs";
const buf = fs.readFileSync("/tmp/jf.xlsx");
const wb = XLSX.read(buf, { type: "buffer", cellDates: true });
const prevWs = wb.Sheets["ANO ANTERIOR"];
const rows = XLSX.utils.sheet_to_json(prevWs, { header:1, blankrows:false, defval:null, raw:true });
const displayRows = XLSX.utils.sheet_to_json(prevWs, { header:1, blankrows:false, defval:null, raw:false });
console.log("rows count", rows.length);
// dump rows 0..10 to see how blankrows:false shifted them
for (let i=0;i<15;i++){
  const r = rows[i];
  if(r) console.log(i, r.slice(0,18));
}
