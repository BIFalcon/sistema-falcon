import { useState } from "react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { type LetterVersion } from "@/hooks/useLetter";
import { Sparkles, Loader2, History } from "lucide-react";

interface Props {
  versions: LetterVersion[];
  isGenerating: boolean;
  canEdit: boolean;
  onRegenerate: (instruction?: string) => void;
  onSaveManual: (text: Pick<LetterVersion, "ai_intro" | "ai_market_context" | "ai_operational" | "ai_financial" | "ai_outlook" | "ai_closing">) => void;
}

export function AiNarrativePanel({ versions, isGenerating, canEdit, onRegenerate, onSaveManual }: Props) {
  const [showInstruction, setShowInstruction] = useState(false);
  const [instruction, setInstruction] = useState("");
  const [selectedVersion, setSelectedVersion] = useState<string>("latest");
  const [isEditingManual, setIsEditingManual] = useState(false);
  const [manualText, setManualText] = useState({
    ai_intro: "", ai_market_context: "", ai_operational: "", ai_financial: "", ai_outlook: "", ai_closing: "",
  });

  const latest = versions[0];
  const viewing = selectedVersion === "latest"
    ? latest
    : versions.find((v) => v.id === selectedVersion) ?? latest;

  if (!latest) {
    return (
      <Card className="p-5 shadow-soft">
        <div className="text-center py-6">
          {isGenerating ? (
            <>
              <Loader2 className="h-6 w-6 animate-spin mx-auto mb-2 text-muted-foreground" />
              <p className="text-sm text-muted-foreground">Gerando narrativa…</p>
            </>
          ) : (
            <p className="text-sm text-muted-foreground">
              A narrativa será gerada automaticamente assim que o formulário for salvo.
            </p>
          )}
        </div>
      </Card>
    );
  }

  function handleRegenerate() {
    onRegenerate();
    setInstruction("");
    setShowInstruction(false);
  }

  function handleRegenerateWithInstruction() {
    if (!instruction.trim()) return;
    onRegenerate(instruction.trim());
    setInstruction("");
    setShowInstruction(false);
  }

  function startManualEdit() {
    setManualText({
      ai_intro: viewing?.ai_intro ?? "",
      ai_market_context: viewing?.ai_market_context ?? "",
      ai_operational: viewing?.ai_operational ?? "",
      ai_financial: viewing?.ai_financial ?? "",
      ai_outlook: viewing?.ai_outlook ?? "",
      ai_closing: viewing?.ai_closing ?? "",
    });
    setShowInstruction(false);
    setIsEditingManual(true);
  }

  function saveManualEdit() {
    onSaveManual(manualText);
    setIsEditingManual(false);
  }

  return (
    <Card className="p-5 shadow-soft space-y-4">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div>
          <h3 className="text-sm font-semibold uppercase tracking-wider">Narrativa gerada (IA)</h3>
          <p className="text-xs text-muted-foreground mt-0.5">
            Versão {viewing?.version_number} de {versions.length}
            {viewing?.ai_model && ` · ${viewing.ai_model === "manual" ? "Editado manualmente" : viewing.ai_model}`}
          </p>
        </div>
        {versions.length > 1 && (
          <div className="flex items-center gap-2">
            <History className="h-4 w-4 text-muted-foreground" />
            <Select value={selectedVersion} onValueChange={setSelectedVersion}>
              <SelectTrigger className="h-8 w-[180px] text-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="latest">Mais recente (v{latest.version_number})</SelectItem>
                {versions.map((v) => (
                  <SelectItem key={v.id} value={v.id}>
                    v{v.version_number} · {v.ai_model === "manual" ? "Editado manualmente" : new Date(v.created_at).toLocaleDateString("pt-BR")}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        )}
      </div>

      {viewing?.instruction && (
        <div className="text-xs bg-muted/50 rounded p-2 border-l-2 border-accent">
          <p className="font-semibold text-muted-foreground mb-0.5">Instrução usada:</p>
          <p className="text-foreground/80">{viewing.instruction}</p>
        </div>
      )}

      <div className="space-y-3 text-sm text-foreground/90">
        {[
          ["Introdução", viewing?.ai_intro],
          ["Contexto de mercado", viewing?.ai_market_context],
          ["Operacional", viewing?.ai_operational],
          ["Financeiro", viewing?.ai_financial],
          ["Perspectivas", viewing?.ai_outlook],
          ["Encerramento", viewing?.ai_closing],
        ].map(([t, body]) => {
          const field = ({
            Introdução: "ai_intro",
            "Contexto de mercado": "ai_market_context",
            Operacional: "ai_operational",
            Financeiro: "ai_financial",
            Perspectivas: "ai_outlook",
            Encerramento: "ai_closing",
          } as const)[t as string];
          return isEditingManual ? (
            <div key={t as string}>
              <p className="text-[10px] uppercase tracking-wider text-muted-foreground mb-1">{t}</p>
              <Textarea
                rows={field === "ai_operational" ? 5 : 3}
                value={manualText[field]}
                onChange={(e) => setManualText((m) => ({ ...m, [field]: e.target.value }))}
              />
            </div>
          ) : body ? (
            <div key={t as string}>
              <p className="text-[10px] uppercase tracking-wider text-muted-foreground mb-1">{t}</p>
              <p className="leading-relaxed whitespace-pre-line">{body}</p>
            </div>
          ) : null;
        })}
      </div>

      {canEdit && (
        <div className="border-t pt-4 space-y-3">
          {isEditingManual ? (
            <div className="flex gap-2">
              <Button size="sm" onClick={saveManualEdit} disabled={isGenerating} className="gap-2">
                {isGenerating ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
                Salvar edição
              </Button>
              <Button size="sm" variant="ghost" onClick={() => setIsEditingManual(false)} disabled={isGenerating}>Cancelar</Button>
            </div>
          ) : !showInstruction ? (
            <div className="flex flex-wrap gap-2">
              <Button size="sm" variant="outline" onClick={handleRegenerate} disabled={isGenerating} className="gap-2">
                {isGenerating ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
                {isGenerating ? "Regenerando…" : "Regenerar"}
              </Button>
              <Button size="sm" variant="outline" onClick={() => setShowInstruction(true)} disabled={isGenerating}>
                Regenerar com comentário
              </Button>
              <Button size="sm" variant="outline" onClick={startManualEdit} disabled={isGenerating}>
                Editar manualmente
              </Button>
            </div>
          ) : (
            <div className="space-y-2">
              <Label className="text-xs">O que você quer mudar?</Label>
              <Textarea
                rows={3}
                value={instruction}
                onChange={(e) => setInstruction(e.target.value)}
                placeholder="Ex.: deixar o tom mais otimista, focar mais nos resultados financeiros, citar mais detalhes operacionais…"
              />
              <div className="flex gap-2">
                <Button
                  size="sm"
                  onClick={handleRegenerateWithInstruction}
                  disabled={isGenerating || !instruction.trim()}
                  className="gap-2"
                >
                  {isGenerating ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
                  Regenerar
                </Button>
                <Button size="sm" variant="ghost" onClick={() => { setShowInstruction(false); setInstruction(""); }}>
                  Cancelar
                </Button>
              </div>
            </div>
          )}
        </div>
      )}
    </Card>
  );
}
