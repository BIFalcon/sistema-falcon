import { useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ScrollArea } from "@/components/ui/scroll-area";
import { toast } from "sonner";
import { useAuth } from "@/contexts/AuthContext";
import { parseInvestorFile, type ParsedInvestorFile } from "@/lib/investorImportParser";
import { fetchExistingUnitCodes, useInvestorMutations } from "@/hooks/useInvestors";
import { StatusSelo } from "./StatusSelo";

export function ImportInvestorsDialog({ open, onOpenChange, defaultHotelId }: { open: boolean; onOpenChange: (o: boolean) => void; defaultHotelId: string | null }) {
  const { allowedHotels } = useAuth();
  const [hotelId, setHotelId] = useState<string>(defaultHotelId ?? "");
  const [modalidade, setModalidade] = useState("pool");
  const [file, setFile] = useState<File | null>(null);
  const [parsed, setParsed] = useState<ParsedInvestorFile | null>(null);
  const [existing, setExisting] = useState<Set<string>>(new Set());
  const [obsPend, setObsPend] = useState("");
  const [busy, setBusy] = useState(false);
  const { importRows } = useInvestorMutations();

  const reset = () => { setFile(null); setParsed(null); setObsPend(""); setExisting(new Set()); };

  const onPick = async (f: File | null) => {
    reset();
    if (!f) return;
    if (!hotelId) { toast.error("Escolha o hotel antes de enviar a planilha."); return; }
    setBusy(true);
    try {
      const [p, codes] = await Promise.all([parseInvestorFile(f), fetchExistingUnitCodes(hotelId)]);
      setFile(f); setParsed(p); setExisting(codes);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Erro ao ler a planilha");
    } finally { setBusy(false); }
  };

  const rows = parsed?.rows ?? [];
  const novas = rows.filter((r) => !existing.has(r.codigo_uh)).length;
  const investidores = new Set(rows.map((r) => r.investor.documento ?? r.investor.nome.toLowerCase())).size;
  const favorecidos = rows.filter((r) => r.payee).length;
  const pend = rows.filter((r) => r.status === "pendente").length;
  const parc = rows.filter((r) => r.status === "parcial").length;
  const hotelName = allowedHotels.find((h) => h.id === hotelId)?.name;

  const confirm = async () => {
    if (!parsed || !file) return;
    const payload = rows.map((r) => ({
      codigo_uh: r.codigo_uh,
      investor: r.investor,
      payee: r.payee ? { ...r.payee, observacao: r.status === "pendente" && obsPend.trim() ? obsPend.trim() : null } : null,
    }));
    try {
      const res = await importRows.mutateAsync({ hotelId, modalidade, rows: payload, fileName: file.name });
      toast.success(`Importação concluída: ${res.uhs} UHs, ${res.investidores} investidores (${res.investidores_novos} novos), ${res.pendentes} pendentes.`);
      reset(); onOpenChange(false);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Erro na importação — nada foi gravado.");
    }
  };

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) reset(); onOpenChange(o); }}>
      <DialogContent className="max-w-3xl">
        <DialogHeader>
          <DialogTitle>Importar planilha de investidores</DialogTitle>
          <DialogDescription>Linha 1 com o nome do hotel, linha 2 com o cabeçalho e uma linha por UH. Endereços, nascimento, estado civil e colunas sem título são ignorados.</DialogDescription>
        </DialogHeader>
        <div className="grid grid-cols-3 gap-3">
          <div className="space-y-1">
            <Label>Hotel</Label>
            <Select value={hotelId} onValueChange={(v) => { setHotelId(v); reset(); }}>
              <SelectTrigger><SelectValue placeholder="Escolha" /></SelectTrigger>
              <SelectContent>{allowedHotels.map((h) => <SelectItem key={h.id} value={h.id}>{h.name}</SelectItem>)}</SelectContent>
            </Select>
          </div>
          <div className="space-y-1">
            <Label>Modalidade padrão (UHs novas)</Label>
            <Select value={modalidade} onValueChange={setModalidade}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent><SelectItem value="pool">Pool</SelectItem><SelectItem value="condo">Condo</SelectItem></SelectContent>
            </Select>
          </div>
          <div className="space-y-1">
            <Label>Arquivo (.xlsx)</Label>
            <Input type="file" accept=".xlsx,.xls" disabled={busy || !hotelId} onChange={(e) => onPick(e.target.files?.[0] ?? null)} />
          </div>
        </div>

        {busy && <p className="text-sm text-muted-foreground">Lendo planilha…</p>}

        {parsed && (
          <div className="space-y-3">
            {parsed.hotelTitle && hotelName && !parsed.hotelTitle.toLowerCase().includes(hotelName.toLowerCase().split(" ").slice(-1)[0]) && (
              <p className="text-sm text-warning-foreground bg-warning/15 rounded p-2">Atenção: a planilha diz "{parsed.hotelTitle}", mas o hotel escolhido é {hotelName}.</p>
            )}
            <div className="grid grid-cols-5 gap-2 text-center">
              {[["UHs", rows.length], ["UHs novas", novas], ["Investidores", investidores], ["Favorecidos", favorecidos], ["Pendentes / parciais", `${pend} / ${parc}`]].map(([l, v]) => (
                <div key={String(l)} className="rounded border p-2"><div className="text-lg font-semibold">{v}</div><div className="text-xs text-muted-foreground">{l}</div></div>
              ))}
            </div>
            {pend > 0 && (
              <div className="space-y-1">
                <Label>Observação para as UHs pendentes (opcional)</Label>
                <Input value={obsPend} onChange={(e) => setObsPend(e.target.value)} placeholder="Ex.: aguardando termo de adesão ao pool assinado" />
              </div>
            )}
            {parsed.warnings.length > 0 && (
              <div>
                <p className="text-sm font-medium mb-1">Avisos ({parsed.warnings.length})</p>
                <ScrollArea className="h-32 rounded border p-2">
                  <ul className="text-xs space-y-1">{parsed.warnings.map((w, i) => <li key={i}>• {w.mensagem}</li>)}</ul>
                </ScrollArea>
              </div>
            )}
            <ScrollArea className="h-48 rounded border">
              <table className="w-full text-xs">
                <thead className="sticky top-0 bg-muted"><tr><th className="p-1 text-left">UH</th><th className="p-1 text-left">Investidor</th><th className="p-1 text-left">Favorecido</th><th className="p-1">Status</th><th className="p-1">Ação</th></tr></thead>
                <tbody>{rows.map((r) => (
                  <tr key={r.codigo_uh} className="border-t">
                    <td className="p-1">{r.codigo_uh}</td><td className="p-1">{r.investor.nome}</td><td className="p-1">{r.payee?.nome_favorecido ?? "—"}</td>
                    <td className="p-1 text-center"><StatusSelo status={r.status} /></td>
                    <td className="p-1 text-center">{existing.has(r.codigo_uh) ? "Atualizar" : "Criar"}</td>
                  </tr>))}
                </tbody>
              </table>
            </ScrollArea>
          </div>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancelar</Button>
          <Button disabled={!parsed || rows.length === 0 || importRows.isPending} onClick={confirm}>
            {importRows.isPending ? "Importando…" : `Confirmar importação (${rows.length} UHs)`}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
