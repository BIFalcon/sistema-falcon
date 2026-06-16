import * as fs from 'fs';
import { parseDre } from '../src/lib/dreParser.ts';
const buf = fs.readFileSync('/tmp/arc.xlsx');
const file = new File([buf], 'arc.xlsx');
const r = await parseDre(file, { targetYear: 2026, targetMonth: 5 });
console.log('warnings:', r.warnings);
for (const [k,v] of Object.entries(r.previousSeries||{})) console.log('prev', k, JSON.stringify(v));
console.log('previousIndicators:', r.previousIndicators);
console.log('prevLines count:', r.prevLines?.length);
