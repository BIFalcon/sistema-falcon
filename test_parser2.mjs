import { parseDreExcel } from './src/lib/dreParser.ts';
import fs from 'fs';
class FileMock { constructor(buf, name){ this.buf=buf; this.name=name; } async arrayBuffer(){ return this.buf.buffer.slice(this.buf.byteOffset, this.buf.byteOffset+this.buf.byteLength); } }
function hasAnyData(parsed){
  const hasIndicator = Object.values(parsed.indicators).some(i=>i&&typeof i.value==='number'&&Number.isFinite(i.value));
  if (hasIndicator) return true;
  if (parsed.monthColumnIndex==null) return false;
  return parsed.lines.some(l=>typeof l.value==='number'&&Number.isFinite(l.value));
}
for (const [file, y, upTo] of [
  ['/tmp/mercure_macae.xlsx', 2026, 12],
  ['/tmp/mercure_poa.xlsm', 2026, 12],
]) {
  const buf = fs.readFileSync(file);
  console.log('\n========', file);
  for (let m=1;m<=upTo;m++){
    const r = await parseDreExcel(new FileMock(buf, file), {targetMonth:m, targetYear:y});
    console.log(`m=${m} monthCol=${r.monthColumnIndex} lines=${r.lines?.length} ind#=${Object.values(r.indicators).filter(v=>v).length} hasData=${hasAnyData(r)}`);
  }
}
