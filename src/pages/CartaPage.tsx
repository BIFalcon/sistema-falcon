import { useEffect, useMemo, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { useFilters } from "@/contexts/FilterContext";
import { useAuth } from "@/contexts/AuthContext";
import { useClosing, useEnsureClosing } from "@/hooks/useClosings";
import {
  useLetter,
  useEnsureLetter,
  useUpdateLetter,
  useGenerateLetterAi,
  useLetterHighlights,
  useLetterVersions,
  downloadLetterPdfBlob,
} from "@/hooks/useLetter";
import { useDreIndicators } from "@/hooks/useDre";
import { useHotel, useFalconLogo } from "@/hooks/useHotelAssets";
import { CartaStageStepper } from "@/components/closings/CartaStageStepper";
import { ApprovalActions } from "@/components/closings/ApprovalActions";
import { CommentsThread } from "@/components/closings/CommentsThread";
import { StatusBadge } from "@/components/closings/StatusBadge";
import { HighlightsEditor } from "@/components/closings/HighlightsEditor";
import { AiNarrativePanel } from "@/components/closings/AiNarrativePanel";
import { MONTHS_PT, hotelSkipsCarta, sanitizeFileName } from "@/lib/constants";
import { ArrowLeft, FileDown, Save, Loader2, AlertTriangle } from "lucide-react";
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
  const { data: highlights = [] } = useLetterHighlights(letter?.id);
  const { data: versions = [] } = useLetterVersions(letter?.id);
  const { data: indicators = [] } = useDreIndicators(resolvedId);
  const { data: hotelRow } = useHotel(closing?.hotel_id);
  const { data: falconLogoUrl } = useFalconLogo();

  const hotel = useMemo(
    () => allowedHotels.find((h) => h.id === closing?.hotel_id) ?? null,
    [allowedHotels, closing?.hotel_id],
  );

  const skip = hotelSkipsCarta(closing?.hotel_id);
  const canEdit = isMaster || hasRole("gop") || hasRole("controladoria") || hasRole("gg");
  const [generatingPdf, setGeneratingPdf] = useState(false);

  const missingAssets: string[] = [];
  if (hotelRow && !hotelRow.cover_url) missingAssets.push("Foto de capa do hotel");
  if (hotelRow && !hotelRow.brand_logo_url) missingAssets.push("Logo da bandeira");
  if (!falconLogoUrl) missingAssets.push("Logo Falcon institucional");
  const assetsReady = missingAssets.length === 0;

  // Garante a row de letter quando faltar
  useEffect(() => {
    if (resolvedId && user && letter === null && !skip) {
      ensureLetter.mutateAsync({ closingId: resolvedId, userId: user.id }).catch(() => {});
    }
  }, [resolvedId, user?.id, letter, skip]); // eslint-disable-line

  const [draft, setDraft] = useState({
    reserve_fund: "" as string,
    rps_score: "" as string,
    operational_comment: "" as string,
  });
  useEffect(() => {
    if (letter) {
      setDraft({
        reserve_fund: letter.reserve_fund != null ? String(letter.reserve_fund) : "",
        rps_score: letter.rps_score != null ? String(letter.rps_score) : "",
        operational_comment: letter.operational_comment ?? "",
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
  const prevIndicatorMap: Partial<Record<IndicatorKey, number | null>> = {};
  for (const r of indicators) {
    const mp = /^\[prev_(\w+)\]/.exec(r.line_label);
    if (mp) { prevIndicatorMap[mp[1] as IndicatorKey] = r.line_value; continue; }
    const m = /^\[(\w+)\]/.exec(r.line_label);
    if (m) indicatorMap[m[1] as IndicatorKey] = r.line_value;
  }

  function validate(): string | null {
    const reserve = draft.reserve_fund.replace(",", ".").trim();
    const rps = draft.rps_score.replace(",", ".").trim();
    if (!reserve) return "Informe o Fundo de Reserva";
    if (Number.isNaN(Number(reserve))) return "Fundo de Reserva inválido";
    if (!rps) return "Informe a Nota RPS";
    if (Number.isNaN(Number(rps))) return "Nota RPS inválida";
    if (highlights.length === 0) return "Adicione pelo menos um destaque do mês";
    const empty = highlights.find((h) => !h.title.trim());
    if (empty) return "Todos os destaques precisam ter um título";
    return null;
  }

  async function handleSaveAndGenerate() {
    if (!letter || !resolvedId) return;
    const err = validate();
    if (err) {
      toast.error(err);
      return;
    }
    try {
      await updateLetter.mutateAsync({
        id: letter.id,
        closingId: resolvedId,
        patch: {
          reserve_fund: Number(draft.reserve_fund.replace(",", ".")),
          rps_score: Number(draft.rps_score.replace(",", ".")),
          operational_comment: draft.operational_comment || null,
        },
      });
      toast.success("Formulário salvo. Gerando narrativa…");
      const r = await genAi.mutateAsync({ closingId: resolvedId, letterId: letter.id });
      toast.success(`Narrativa v${r.version} gerada (${r.model})`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Erro ao salvar/gerar");
    }
  }

  async function handleRegenerate(instruction?: string) {
    if (!letter || !resolvedId) return;
    try {
      const r = await genAi.mutateAsync({ closingId: resolvedId, letterId: letter.id, instruction });
      toast.success(`Narrativa v${r.version} gerada`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Erro ao regenerar");
    }
  }

  async function handleGeneratePdf() {
    if (!letter || !closing) return;
    if (!assetsReady) {
      toast.error(`Configure os assets antes: ${missingAssets.join(", ")}`);
      return;
    }
    setGeneratingPdf(true);
    try {
      const blob = await generateLetterPdf({
        letter,
        closing,
        hotel,
        hotelCoverUrl: hotelRow?.cover_url ?? null,
        brandLogoUrl: hotelRow?.brand_logo_url ?? null,
        falconLogoUrl: falconLogoUrl ?? null,
        highlights,
        indicators: indicatorMap,
        previousIndicators: prevIndicatorMap,
      });
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
      setGeneratingPdf(false);
    }
  }

  async function handleDownloadPdf() {
    if (!letter?.pdf_url) return;
    const filename = letter.pdf_url.split("/").pop() ?? "carta-investidor.pdf";
    try {
      const blob = await downloadLetterPdfBlob(letter.pdf_url);
      const blobUrl = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = blobUrl;
      a.download = filename;
      a.rel = "noopener";
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      setTimeout(() => URL.revokeObjectURL(blobUrl), 1000);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Não foi possível baixar o PDF");
    }
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
            <Card className="p-5 shadow-soft space-y-5">
              <div>
                <h3 className="text-sm font-semibold uppercase tracking-wider">Formulário da carta</h3>
                <p className="text-xs text-muted-foreground mt-1">
                  Preencha os campos abaixo. Ao salvar, a narrativa é gerada automaticamente pela IA.
                </p>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div className="space-y-1">
                  <Label className="text-xs">
                    Fundo de Reserva (R$) <span className="text-destructive">*</span>
                  </Label>
                  <Input
                    inputMode="decimal"
                    value={draft.reserve_fund}
                    disabled={!canEdit}
                    onChange={(e) => setDraft((d) => ({ ...d, reserve_fund: e.target.value }))}
                    placeholder="Ex.: 25000"
                  />
                </div>
                <div className="space-y-1">
                  <Label className="text-xs">
                    Nota RPS <span className="text-destructive">*</span>
                  </Label>
                  <Input
                    inputMode="decimal"
                    value={draft.rps_score}
                    disabled={!canEdit}
                    onChange={(e) => setDraft((d) => ({ ...d, rps_score: e.target.value }))}
                    placeholder="Ex.: 8.7"
                  />
                </div>
              </div>

              {letter && (
                <HighlightsEditor
                  letterId={letter.id}
                  closingId={closing.id}
                  userId={user!.id}
                  highlights={highlights}
                  canEdit={canEdit}
                />
              )}

              <div className="space-y-1">
                <Label className="text-xs">Comentário operacional / observações gerais (opcional)</Label>
                <Textarea
                  rows={3}
                  value={draft.operational_comment}
                  disabled={!canEdit}
                  onChange={(e) => setDraft((d) => ({ ...d, operational_comment: e.target.value }))}
                  placeholder="Observações gerais do mês…"
                />
              </div>

              <div className="flex flex-wrap gap-2 pt-2 border-t">
                <Button
                  size="sm"
                  onClick={handleSaveAndGenerate}
                  disabled={!canEdit || !letter || genAi.isPending || updateLetter.isPending}
                  className="gap-2"
                >
                  {genAi.isPending || updateLetter.isPending ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <Save className="h-4 w-4" />
                  )}
                  {genAi.isPending ? "Gerando narrativa…" : "Salvar e gerar narrativa"}
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={handleGeneratePdf}
                  disabled={!letter || generatingPdf || !letter?.ai_intro || !assetsReady}
                  className="gap-2"
                >
                  {generatingPdf ? <Loader2 className="h-4 w-4 animate-spin" /> : <FileDown className="h-4 w-4" />}
                  {generatingPdf ? "Gerando PDF…" : "Gerar PDF"}
                </Button>
                {letter?.pdf_url && (
                  <Button size="sm" variant="ghost" onClick={handleDownloadPdf} className="gap-2">
                    <FileDown className="h-4 w-4" /> Baixar PDF v{letter.pdf_version}
                  </Button>
                )}
              </div>
              {!assetsReady && hotelRow && (
                <div className="flex items-start gap-2 rounded-md border border-destructive/40 bg-destructive/10 p-3 text-destructive text-xs">
                  <AlertTriangle className="h-4 w-4 mt-0.5 shrink-0" />
                  <div className="space-y-1">
                    <p className="font-semibold">Geração de PDF bloqueada — assets faltando:</p>
                    <ul className="list-disc pl-4 space-y-0.5">
                      {missingAssets.map((m) => <li key={m}>{m}</li>)}
                    </ul>
                    <p>
                      Configure em{" "}
                      <button
                        type="button"
                        onClick={() => navigate("/configuracoes/hoteis")}
                        className="underline font-semibold hover:no-underline"
                      >
                        Hotéis
                      </button>.
                    </p>
                  </div>
                </div>
              )}
            </Card>

            <AiNarrativePanel
              versions={versions}
              isGenerating={genAi.isPending}
              canEdit={!!canEdit && !!letter}
              onRegenerate={handleRegenerate}
            />

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
