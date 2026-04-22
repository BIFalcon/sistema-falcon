import { useEffect, useMemo, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { useFilters } from "@/contexts/FilterContext";
import { useAuth } from "@/contexts/AuthContext";
import { useClosing, useEnsureClosing } from "@/hooks/useClosings";
import { useLetter, useEnsureLetter, useUpdateLetter, useGenerateLetterAi, getLetterPdfSignedUrl } from "@/hooks/useLetter";
import { useDreIndicators } from "@/hooks/useDre";
import { CartaStageStepper } from "@/components/closings/CartaStageStepper";
import { ApprovalActions } from "@/components/closings/ApprovalActions";
import { CommentsThread } from "@/components/closings/CommentsThread";
import { StatusBadge } from "@/components/closings/StatusBadge";
import { MONTHS_PT, hotelSkipsCarta, sanitizeFileName } from "@/lib/constants";
import { ArrowLeft, Sparkles, FileDown, Save, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { generateLetterPdf } from "@/lib/letterPdf";
import { supabase } from "@/integrations/supabase/client";
import type { IndicatorKey } from "@/lib/dreParser";

export default function CartaPage() {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const { hotelId, month, year } = useFilters();
  const { user, allowedHotels, hasRole, isMaster } = useAuth();

  const ensure = useEnsureClosing();
  const ensureLetter = useEnsureLetter();
  const updateLetter = useUpdateLetter();
  const genAi = useGenerateLetterAi();

  const closingIdParam = params.get("closing");
  const [resolvedId, setResolvedId] = useState<string | null>(closingIdParam);

  useEffect(() => {
    if (!resolvedId && hotelId) {
      ensure.mutateAsync({ hotelId, month, year })
        .then((c) => setResolvedId(c.id))
        .catch((err) => toast.error(err.message));
    }
  }, [resolvedId, hotelId, month, year]); // eslint-disable-line react-hooks/exhaustive-deps

  const { data: closing } = useClosing(resolvedId);
  const { data: letter } = useLetter(resolvedId);
  const { data: indicators = [] } = useDreIndicators(resolvedId);

  const hotel = useMemo(
    () => allowedHotels.find((h) => h.id === closing?.hotel_id) ?? null,
    [allowedHotels, closing?.hotel_id],
  );

  const skip = hotelSkipsCarta(closing?.hotel_id);
  const canEdit = isMaster || hasRole("gop") || hasRole("controladoria") || hasRole("gg");
  const [generating, setGenerating] = useState(false);

  // Garante a row de letter quando faltar
  useEffect(() => {
    if (resolvedId && user && letter === null && !skip) {
      ensureLetter.mutateAsync({ closingId: resolvedId, userId: user.id }).catch(() => {});
    }
  }, [resolvedId, user?.id, letter, skip]); // eslint-disable-line

  const [draft, setDraft] = useState({
    highlight_market: "",
    highlight_operations: "",
    highlight_revenue: "",
    highlight_costs: "",
    highlight_outlook: "",
    custom_notes: "",
  });
  useEffect(() => {
    if (letter) {
      setDraft({
        highlight_market: letter.highlight_market ?? "",
        highlight_operations: letter.highlight_operations ?? "",
        highlight_revenue: letter.highlight_revenue ?? "",
        highlight_costs: letter.highlight_costs ?? "",
        highlight_outlook: letter.highlight_outlook ?? "",
        custom_notes: letter.custom_notes ?? "",
      });
    }
  }, [letter?.id]); // eslint-disable-line

  if (!hotelId && !resolvedId) {
    return (
      <div className="max-w-2xl mx-auto pt-12">
        <Card className="p-8 text-center shadow-soft">
          <h2 className="text-lg font-semibold mb-1">Selecione um hotel</h2>
          <p className="text-sm text-muted-foreground">Use o filtro de hotel no topo.</p>
        </Card>
      </div>
    );
  }
  if (!closing) return <div className="text-sm text-muted-foreground">Carregando…</div>;

  const indicatorMap: Partial<Record<IndicatorKey, number | null>> = {};
  for (const r of indicators) {
    const m = /^\[(\w+)\]/.exec(r.line_label);
    if (m) indicatorMap[m[1] as IndicatorKey] = r.line_value;
  }

  async function handleSave() {
    if (!letter) return;
    try {
      await updateLetter.mutateAsync({ id: letter.id, closingId: resolvedId!, patch: draft });
      toast.success("Destaques salvos");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Erro ao salvar");
    }
  }

  async function handleGenerateAi() {
    if (!letter || !resolvedId) return;
    try {
      // salva primeiro
      await updateLetter.mutateAsync({ id: letter.id, closingId: resolvedId, patch: draft });
      const r = await genAi.mutateAsync({ closingId: resolvedId, letterId: letter.id });
      toast.success(`Narrativa gerada (${r.model})`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Erro na IA");
    }
  }

  async function handleGeneratePdf() {
    if (!letter || !closing) return;
    setGenerating(true);
    try {
      const blob = await generateLetterPdf({ letter, closing, hotel, indicators: indicatorMap });
      const version = (letter.pdf_version ?? 0) + 1;
      const path = `${closing.id}/v${version}_carta_${sanitizeFileName(hotel?.name ?? closing.hotel_id)}.pdf`;
      const up = await supabase.storage.from("investor-letters").upload(path, blob, {
        contentType: "application/pdf",
        upsert: false,
      });
      if (up.error) throw up.error;
      await updateLetter.mutateAsync({
        id: letter.id,
        closingId: closing.id,
        patch: { pdf_url: path, pdf_generated_at: new Date().toISOString(), pdf_version: version },
      });
      toast.success(`PDF v${version} gerado`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Erro ao gerar PDF");
    } finally {
      setGenerating(false);
    }
  }

  async function handleDownloadPdf() {
    if (!letter?.pdf_url) return;
    const url = await getLetterPdfSignedUrl(letter.pdf_url);
    if (!url) return toast.error("Não foi possível gerar link");
    window.open(url, "_blank", "noopener");
  }

  return (
    <div className="space-y-6 max-w-[1400px]">
      <div className="flex items-start justify-between gap-4">
        <div>
          <Button variant="ghost" size="sm" className="gap-2 mb-2 -ml-2" onClick={() => navigate("/")}>
            <ArrowLeft className="h-4 w-4" /> Voltar ao Dashboard
          </Button>
          <p className="text-xs font-semibold uppercase tracking-[0.16em] text-accent">Carta ao Investidor</p>
          <h1 className="text-2xl font-semibold">{hotel?.name ?? closing.hotel_id}</h1>
          <p className="text-sm text-muted-foreground">{MONTHS_PT[closing.month - 1]} de {closing.year}</p>
        </div>
        <StatusBadge status={closing.status_carta} size="md" />
      </div>

      <Card className="p-5 shadow-soft">
        <CartaStageStepper status={closing.status_carta} />
      </Card>

      {skip ? (
        <Card className="p-6 shadow-soft">
          <p className="text-sm text-muted-foreground">
            Este hotel está configurado para <strong>pular a Carta ao Investidor</strong>. O fluxo segue direto para o Financeiro após a aprovação da DRE.
          </p>
        </Card>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          <div className="lg:col-span-2 space-y-6">
            <Card className="p-5 shadow-soft">
              <h3 className="text-sm font-semibold uppercase tracking-wider mb-4">Destaques (preenchidos pelo GG/GOP)</h3>
              <div className="space-y-3">
                {[
                  ["highlight_market", "Mercado e ambiente competitivo"],
                  ["highlight_operations", "Destaques operacionais"],
                  ["highlight_revenue", "Receitas"],
                  ["highlight_costs", "Custos e despesas"],
                  ["highlight_outlook", "Perspectivas e próximos passos"],
                  ["custom_notes", "Notas adicionais"],
                ].map(([key, label]) => (
                  <div key={key} className="space-y-1">
                    <Label className="text-xs">{label}</Label>
                    <Textarea
                      rows={3}
                      value={(draft as Record<string, string>)[key]}
                      disabled={!canEdit}
                      onChange={(e) => setDraft((d) => ({ ...d, [key]: e.target.value }))}
                      placeholder="Resumo do mês…"
                    />
                  </div>
                ))}
              </div>
              <div className="flex flex-wrap gap-2 mt-4">
                <Button size="sm" onClick={handleSave} disabled={!canEdit || !letter} className="gap-2">
                  <Save className="h-4 w-4" /> Salvar destaques
                </Button>
                <Button size="sm" variant="outline" onClick={handleGenerateAi} disabled={!canEdit || !letter || genAi.isPending} className="gap-2">
                  {genAi.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
                  {genAi.isPending ? "Gerando narrativa…" : "Gerar narrativa com IA"}
                </Button>
                <Button size="sm" variant="outline" onClick={handleGeneratePdf} disabled={!letter || generating} className="gap-2">
                  {generating ? <Loader2 className="h-4 w-4 animate-spin" /> : <FileDown className="h-4 w-4" />}
                  {generating ? "Gerando PDF…" : "Gerar PDF"}
                </Button>
                {letter?.pdf_url && (
                  <Button size="sm" variant="ghost" onClick={handleDownloadPdf} className="gap-2">
                    <FileDown className="h-4 w-4" /> Baixar PDF v{letter.pdf_version}
                  </Button>
                )}
              </div>
            </Card>

            {letter?.ai_intro && (
              <Card className="p-5 shadow-soft">
                <h3 className="text-sm font-semibold uppercase tracking-wider mb-3">Prévia da narrativa (IA)</h3>
                <div className="space-y-3 text-sm text-foreground/90">
                  {[
                    ["Introdução", letter.ai_intro],
                    ["Contexto de mercado", letter.ai_market_context],
                    ["Operacional", letter.ai_operational],
                    ["Financeiro", letter.ai_financial],
                    ["Perspectivas", letter.ai_outlook],
                    ["Encerramento", letter.ai_closing],
                  ].map(([t, body]) => body ? (
                    <div key={t}>
                      <p className="text-[10px] uppercase tracking-wider text-muted-foreground mb-1">{t}</p>
                      <p className="leading-relaxed">{body}</p>
                    </div>
                  ) : null)}
                </div>
              </Card>
            )}

            <Card className="p-5 shadow-soft">
              <h3 className="text-sm font-semibold uppercase tracking-wider mb-3">Ações do estágio</h3>
              <ApprovalActions closingId={closing.id} stage="carta" currentStatus={closing.status_carta} />
            </Card>
          </div>

          <div>
            <CommentsThread closingId={closing.id} stage="carta" />
          </div>
        </div>
      )}
    </div>
  );
}