import fs from "fs";
const XLSX = await import("xlsx/xlsx.mjs") as any;
(globalThis as any).XLSX = XLSX;

const buf = fs.readFileSync("/mnt/user-uploads/DRE_ibis_Juiz_de_Fora_05.2026.xlsx");
const wb = XLSX.read(buf, { type: "buffer", cellDates: true });
const ws = wb.Sheets["Orçamento"];
const rows: any[][] = XLSX.utils.sheet_to_json(ws, { header: 1, blankrows: false, defval: null, raw: true });
const display: any[][] = XLSX.utils.sheet_to_json(ws, { header: 1, blankrows: false, defval: null, raw: false });

// Find all cells where row/display has "JUNHO" or relates to month 6
for (let r = 0; r < Math.min(rows.length, 30); r++) {
  const w = Math.max((rows[r]||[]).length, (display[r]||[]).length);
  for (let c = 0; c < w; c++) {
    const a = rows[r]?.[c], b = display[r]?.[c];
    for (const cell of [a, b]) {
      if (cell instanceof Date) {
        if (cell.getMonth()+1 === 6) console.log(`Date cell month=6 at R${r} C${c}:`, cell);
      } else if (typeof cell === "string") {
        const n = cell.trim().toLowerCase();
        if (n.startsWith("junho") || n === "jun") console.log(`String month=6 at R${r} C${c}:`, JSON.stringify(cell));
      } else if (typeof cell === "number" && cell > 20000 && cell < 80000) {
        const d = new Date((cell - 25569) * 86400000);
        if (d.getUTCMonth()+1 === 6) console.log(`Numeric date month=6 at R${r} C${c}: ${cell} =>`, d.toISOString());
      }
    }
  }
}
console.log("\n--- Row 9 ---", rows[8]);
console.log("--- Display Row 9 ---", display[8]);
