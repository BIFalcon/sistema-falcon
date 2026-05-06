import * as XLSX from 'xlsx';
function dump(file, sheet, fromRow=0, toRow=40, cols=20) {
  const wb = XLSX.readFile(file);
  const ws = wb.Sheets[sheet];
  if (!ws) { console.log('NO SHEET', sheet); return; }
  const rows = XLSX.utils.sheet_to_json(ws, {header:1, raw:false, defval:null});
  console.log(`\n### ${file} :: ${sheet} (${rows.length} rows)`);
  for (let i=fromRow;i<Math.min(toRow,rows.length);i++){
    const r=(rows[i]||[]).slice(0,cols).map(c=>c==null?'':String(c).slice(0,20));
    console.log(String(i).padStart(3),'|',r.join(' | '));
  }
}
dump('/tmp/mercure_poa.xlsm','DRE COLUNADO POOL',0,30,20);
dump('/tmp/mercure_poa.xlsm','DRE COLUNADO POOL',30,80,20);
