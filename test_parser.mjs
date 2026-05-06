import { parseDreExcel } from './src/lib/dreParser.ts';
import * as XLSX from 'xlsx';
import fs from 'fs';

for (const [file, m, y] of [
  ['/tmp/mercure_macae.xlsx', 2, 2026],
  ['/tmp/mercure_poa.xlsm', 3, 2026],
]) {
  const buf = fs.readFileSync(file);
  console.log('\n========', file, m, y);
  try {
    const r = parseDreExcel(buf, m, y);
    console.log('template=', r.template, 'sheet=', r.sheetUsed);
    console.log('warnings=', r.warnings);
    console.log('lines count=', r.lines?.length, 'currentSeries lines:', r.currentSeries?.length);
    console.log('indicators keys:', Object.keys(r.indicators).slice(0,12));
    const sample = (r.lines||[]).slice(0,8);
    for (const l of sample) console.log(' -', l.label, '=>', l.value);
  } catch (e) {
    console.log('ERROR:', e.message);
  }
}
