import * as XLSX from 'xlsx';
const wb = XLSX.readFile('/tmp/mercure_poa.xlsm');
console.log('sheets:', wb.SheetNames);
for (const sn of wb.SheetNames) {
  const ws = wb.Sheets[sn];
  const rows = XLSX.utils.sheet_to_json(ws, {header:1, raw:false, defval:null});
  console.log(`\n--- "${sn}" rows=${rows.length} ---`);
  rows.slice(0,8).forEach((r,i)=>console.log(i,'|',(r||[]).slice(0,16).map(c=>c==null?'':String(c).slice(0,18)).join(' | ')));
}
