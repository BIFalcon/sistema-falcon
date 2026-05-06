import { parseDreExcel } from './src/lib/dreParser.ts';
import fs from 'fs';
class FileMock {
  constructor(buf, name){ this.buf=buf; this.name=name; }
  async arrayBuffer(){ return this.buf.buffer.slice(this.buf.byteOffset, this.buf.byteOffset+this.buf.byteLength); }
}
for (const [file, m, y] of [
  ['/tmp/mercure_macae.xlsx', 2, 2026],
  ['/tmp/mercure_poa.xlsm', 3, 2026],
]) {
  const buf = fs.readFileSync(file);
  console.log('\n========', file, m, y);
  try {
    const r = await parseDreExcel(new FileMock(buf, file), {targetMonth:m, targetYear:y});
    console.log('template=', r.template, 'sheet=', r.sheetUsed);
    console.log('warnings=', r.warnings);
    console.log('lines count=', r.lines?.length);
    console.log('indicators count:', Object.keys(r.indicators||{}).length);
    const sample = (r.lines||[]).slice(0,12);
    for (const l of sample) console.log(' -', l.label, '=>', l.value);
  } catch (e) {
    console.log('ERROR:', e.message);
  }
}
