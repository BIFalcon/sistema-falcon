import { useState } from "react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { useAuth } from "@/contexts/AuthContext";
import { useAddComment, useComments } from "@/hooks/useComments";
import type { ClosingStage } from "@/lib/constants";
import { toast } from "sonner";
import { MessageSquare } from "lucide-react";

interface Props {
  closingId: string;
  stage: ClosingStage;
}

export function CommentsThread({ closingId, stage }: Props) {
  const { user } = useAuth();
  const { data: comments = [], isLoading } = useComments(closingId, stage);
  const addComment = useAddComment();
  const [text, setText] = useState("");

  async function submit() {
    if (!text.trim() || !user) return;
    try {
      await addComment.mutateAsync({
        closingId,
        stage,
        content: text.trim(),
        userId: user.id,
      });
      setText("");
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Erro ao publicar comentário";
      toast.error(msg);
    }
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
        <div className="flex justify-end">
          <Button
            size="sm"
            onClick={submit}
            disabled={!text.trim() || addComment.isPending}
          >
            {addComment.isPending ? "Publicando…" : "Publicar comentário"}
          </Button>
        </div>
      </div>
    </Card>
  );
}