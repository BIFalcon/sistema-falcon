import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Card } from "@/components/ui/card";
import {
  type LetterHighlight,
  useCreateHighlight,
  useUpdateHighlight,
  useDeleteHighlight,
  uploadHighlightPhoto,
  getHighlightPhotoUrl,
} from "@/hooks/useLetter";
import { Plus, Trash2, Image as ImageIcon, Loader2 } from "lucide-react";
import { toast } from "sonner";

interface Props {
  letterId: string;
  closingId: string;
  userId: string;
  highlights: LetterHighlight[];
  canEdit: boolean;
}

export function HighlightsEditor({ letterId, closingId, userId, highlights, canEdit }: Props) {
  const create = useCreateHighlight();
  const update = useUpdateHighlight();
  const remove = useDeleteHighlight();

  async function addNew() {
    if (highlights.length >= 8) {
      toast.error("Máximo de 8 destaques por carta");
      return;
    }
    const next = (highlights[highlights.length - 1]?.sort_order ?? -1) + 1;
    try {
      await create.mutateAsync({
        letterId,
        closingId,
        userId,
        title: "",
        sort_order: next,
      });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Erro ao adicionar destaque");
    }
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <h4 className="text-sm font-semibold">Destaques do mês</h4>
        <Button
          size="sm"
          variant="outline"
          onClick={addNew}
          disabled={!canEdit || create.isPending || highlights.length >= 8}
          className="gap-2"
        >
          <Plus className="h-4 w-4" /> Adicionar destaque {highlights.length > 0 ? `(${highlights.length}/8)` : ""}
        </Button>
      </div>
      {highlights.length === 0 && (
        <p className="text-xs text-muted-foreground">Nenhum destaque ainda. Adicione pelo menos um.</p>
      )}
      <div className="space-y-3">
        {highlights.map((h, idx) => (
          <HighlightRow
            key={h.id}
            index={idx}
            highlight={h}
            closingId={closingId}
            canEdit={canEdit}
            onUpdate={(patch) => update.mutate({ id: h.id, letterId, patch })}
            onDelete={() => remove.mutate({ id: h.id, letterId, photo_url: h.photo_url })}
          />
        ))}
      </div>
    </div>
  );
}

function HighlightRow({
  index,
  highlight,
  closingId,
  canEdit,
  onUpdate,
  onDelete,
}: {
  index: number;
  highlight: LetterHighlight;
  closingId: string;
  canEdit: boolean;
  onUpdate: (patch: Partial<LetterHighlight>) => void;
  onDelete: () => void;
}) {
  const [title, setTitle] = useState(highlight.title);
  const [note, setNote] = useState(highlight.note ?? "");
  const [photoSignedUrl, setPhotoSignedUrl] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const fileRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    setTitle(highlight.title);
    setNote(highlight.note ?? "");
  }, [highlight.id]); // eslint-disable-line

  useEffect(() => {
    let cancelled = false;
    if (highlight.photo_url) {
      getHighlightPhotoUrl(highlight.photo_url).then((u) => {
        if (!cancelled) setPhotoSignedUrl(u);
      });
    } else {
      setPhotoSignedUrl(null);
    }
    return () => {
      cancelled = true;
    };
  }, [highlight.photo_url]);

  async function handleFile(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0];
    if (!f) return;
    setUploading(true);
    try {
      const path = await uploadHighlightPhoto(closingId, f);
      onUpdate({ photo_url: path });
      toast.success("Foto enviada");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Erro ao enviar foto");
    } finally {
      setUploading(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  }

  return (
    <Card className="p-4 space-y-3 bg-muted/30">
      <div className="flex items-start gap-3">
        <span className="text-xs font-semibold text-muted-foreground mt-2 w-5">{index + 1}.</span>
        <div className="flex-1 space-y-3">
          <div className="space-y-1">
            <Label className="text-xs">Título <span className="text-destructive">*</span></Label>
            <Input
              value={title}
              disabled={!canEdit}
              onChange={(e) => setTitle(e.target.value)}
              onBlur={() => title !== highlight.title && onUpdate({ title })}
              placeholder="Ex.: Renovação do lobby"
            />
          </div>
          <div className="space-y-1">
            <Label className="text-xs">Observação (opcional)</Label>
            <Textarea
              rows={2}
              value={note}
              disabled={!canEdit}
              onChange={(e) => setNote(e.target.value)}
              onBlur={() => note !== (highlight.note ?? "") && onUpdate({ note: note || null })}
              placeholder="Detalhes adicionais…"
            />
          </div>
          <div className="flex items-center gap-3">
            {photoSignedUrl ? (
              <img src={photoSignedUrl} alt={title} className="h-16 w-16 rounded object-cover border" />
            ) : (
              <div className="h-16 w-16 rounded border border-dashed flex items-center justify-center text-muted-foreground">
                <ImageIcon className="h-5 w-5" />
              </div>
            )}
            <input
              ref={fileRef}
              type="file"
              accept="image/*"
              className="hidden"
              onChange={handleFile}
              disabled={!canEdit || uploading}
            />
            <Button
              type="button"
              size="sm"
              variant="outline"
              disabled={!canEdit || uploading}
              onClick={() => fileRef.current?.click()}
              className="gap-2"
            >
              {uploading ? <Loader2 className="h-4 w-4 animate-spin" /> : <ImageIcon className="h-4 w-4" />}
              {highlight.photo_url ? "Trocar foto" : "Adicionar foto"}
            </Button>
            {highlight.photo_url && canEdit && (
              <Button
                type="button"
                size="sm"
                variant="ghost"
                onClick={() => onUpdate({ photo_url: null })}
              >
                Remover foto
              </Button>
            )}
          </div>
        </div>
        {canEdit && (
          <Button type="button" size="icon" variant="ghost" onClick={onDelete} title="Remover destaque">
            <Trash2 className="h-4 w-4 text-destructive" />
          </Button>
        )}
      </div>
    </Card>
  );
}
