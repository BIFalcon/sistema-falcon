import * as XLSX from 'xlsx';
for (const f of ['/tmp/mercure_macae.xlsx','/tmp/mercure_poa.xlsm']) {
  console.log('\n=====', f, '=====');
  const wb = XLSX.readFile(f);
  for (const sn of wb.SheetNames) {
    const ws = wb.Sheets[sn];
    const rows = XLSX.utils.sheet_to_json(ws, {header:1, raw:false, defval:null});
    console.log(`\n--- sheet "${sn}" rows=${rows.length} ---`);
    rows.slice(0, 60).forEach((r,i)=>{
      const cells = (r||[]).slice(0,15).map(c=>c==null?'':String(c).slice(0,18));
      console.log(String(i).padStart(3), '|', cells.join(' | '));
    });
  }
}
