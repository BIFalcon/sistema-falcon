import { useRef, useState } from "react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { useAuth } from "@/contexts/AuthContext";
import { useAddComment, useComments } from "@/hooks/useComments";
import type { ClosingStage } from "@/lib/constants";
import { toast } from "sonner";
import { MessageSquare, Paperclip, X } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { getSignedPrivateUrl } from "@/lib/privateStorage";

interface Props {
  closingId: string;
  stage: ClosingStage;
}

export function CommentsThread({ closingId, stage }: Props) {
  const { user } = useAuth();
  const { data: comments = [], isLoading } = useComments(closingId, stage);
  const addComment = useAddComment();
  const [text, setText] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [uploading, setUploading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  async function submit() {
    if ((!text.trim() && !file) || !user) return;
    try {
      let attachmentUrl: string | null = null;
      let attachmentName: string | null = null;
      if (file) {
        setUploading(true);
        const safeName = file.name.replace(/[^\w.\-]+/g, "_");
        const path = `${closingId}/${stage}/${Date.now()}-${safeName}`;
        const { error: upErr } = await supabase.storage
          .from("comment-attachments")
          .upload(path, file, { upsert: false, contentType: file.type || undefined });
        if (upErr) throw upErr;
        attachmentUrl = path;
        attachmentName = file.name;
      }
      await addComment.mutateAsync({
        closingId,
        stage,
        content: text.trim() || (attachmentName ? `📎 ${attachmentName}` : ""),
        userId: user.id,
        attachmentUrl,
        attachmentName,
      });
      setText("");
      setFile(null);
      if (fileInputRef.current) fileInputRef.current.value = "";
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Erro ao publicar comentário";
      toast.error(msg);
    } finally {
      setUploading(false);
    }
  }

  async function openAttachment(path: string | null) {
    if (!path) return;
    const url = await getSignedPrivateUrl(path, "comment-attachments", 3600);
    if (url) window.open(url, "_blank", "noopener,noreferrer");
    else toast.error("Não foi possível abrir o anexo");
  }

  return (
    <Card className="p-5 shadow-soft">
      <div className="flex items-center gap-2 mb-4">
        <MessageSquare className="h-4 w-4 text-accent" />
        <h3 className="text-sm font-semibold uppercase tracking-wider">Comentários</h3>
        <span className="text-xs text-muted-foreground">({comments.length})</span>
      </div>

      <div className="space-y-3 max-h-[360px] overflow-y-auto pr-1">
        {isLoading && <p className="text-xs text-muted-foreground">Carregando…</p>}
        {!isLoading && comments.length === 0 && (
          <p className="text-xs text-muted-foreground italic">Nenhum comentário ainda.</p>
        )}
        {comments.map((c) => (
          <div key={c.id} className="border border-border rounded-md p-3 bg-secondary/40">
            <div className="flex items-center justify-between mb-1">
              <span className="text-xs font-semibold text-foreground">
                {c.author?.display_name ?? c.author?.email ?? "Usuário"}
              </span>
              <span className="text-[10px] text-muted-foreground">
                {new Date(c.created_at).toLocaleString("pt-BR")}
              </span>
            </div>
            <p className="text-sm text-foreground whitespace-pre-wrap">{c.content}</p>
            {c.attachment_url && (
              <button
                type="button"
                onClick={() => openAttachment(c.attachment_url)}
                className="mt-2 inline-flex items-center gap-1.5 text-xs text-primary hover:underline"
              >
                <Paperclip className="h-3 w-3" />
                {c.attachment_name ?? "Anexo"}
              </button>
            )}
          </div>
        ))}
      </div>

      <div className="mt-4 space-y-2">
        <Textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="Escreva um comentário…"
          rows={3}
          className="resize-none"
        />
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2 min-w-0">
            <input
              ref={fileInputRef}
              type="file"
              className="hidden"
              onChange={(e) => setFile(e.target.files?.[0] ?? null)}
            />
            <Button
              size="sm"
              variant="outline"
              type="button"
              onClick={() => fileInputRef.current?.click()}
              disabled={uploading || addComment.isPending}
            >
              <Paperclip className="h-3.5 w-3.5 mr-1" />
              Anexar
            </Button>
            {file && (
              <div className="flex items-center gap-1 min-w-0 text-xs text-muted-foreground">
                <span className="truncate max-w-[180px]">{file.name}</span>
                <button
                  type="button"
                  onClick={() => {
                    setFile(null);
                    if (fileInputRef.current) fileInputRef.current.value = "";
                  }}
                  className="text-muted-foreground hover:text-foreground"
                  aria-label="Remover anexo"
                >
                  <X className="h-3 w-3" />
                </button>
              </div>
            )}
          </div>
          <Button
            size="sm"
            onClick={submit}
            disabled={(!text.trim() && !file) || addComment.isPending || uploading}
          >
            {uploading ? "Enviando anexo…" : addComment.isPending ? "Publicando…" : "Publicar comentário"}
          </Button>
        </div>
      </div>
    </Card>
  );
}