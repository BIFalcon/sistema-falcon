import * as fs from 'fs';
import * as XLSX from 'xlsx';
import { parseDreExcel } from '../src/lib/dreParser.ts';
// patch SSF
if (!XLSX.SSF) (XLSX).SSF = (await import('xlsx/dist/xlsx.full.min.js')).SSF;
const buf = fs.readFileSync('/tmp/arc.xlsx');
const file = new File([buf], 'arc.xlsx');
const r = await parseDreExcel(file, { targetYear: 2026, targetMonth: 5 });
console.log('warnings:', r.warnings);
for (const [k,v] of Object.entries(r.previousSeries||{})) console.log('prev', k, JSON.stringify(v));
console.log('---');
for (const [k,v] of Object.entries(r.currentSeries||{})) console.log('curr', k, JSON.stringify(v));
console.log('previousIndicators:', r.previousIndicators);
console.log('prevLines count:', r.prevLines?.length);
