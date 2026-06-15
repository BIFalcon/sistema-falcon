import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Plus, Paperclip, X, FileText, Download, Trash2, Pencil } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";

interface Attachment { name: string; path: string }
interface BrandAsset {
  id: string;
  title: string;
  description: string | null;
  attachments: Attachment[];
  created_by: string;
  created_at: string;
  updated_at: string;
}

function useBrandAssets() {
  return useQuery({
    queryKey: ["marketing", "brand-assets"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("marketing_brand_assets" as any)
        .select("*")
        .order("created_at", { ascending: false });
      if (error) throw error;
      return (data ?? []) as unknown as BrandAsset[];
    },
  });
}

async function downloadAttachment(att: Attachment) {
  const { data, error } = await supabase.storage.from("marketing-assets").createSignedUrl(att.path, 60 * 5, { download: att.name });
  if (error || !data?.signedUrl) { toast.error("Não foi possível baixar."); return; }
  window.open(data.signedUrl, "_blank");
}

export default function PadroesMarcaPage() {
  const qc = useQueryClient();
  const { isMaster, hasRole, user } = useAuth();
  const canEdit = isMaster || hasRole("marketing");
  const { data: assets = [], isLoading } = useBrandAssets();
  const [editing, setEditing] = useState<BrandAsset | null>(null);
  const [openNew, setOpenNew] = useState(false);

  const saveMutation = useMutation({
    mutationFn: async (payload: { id?: string; title: string; description: string; attachments: Attachment[] }) => {
      if (payload.id) {
        const { error } = await supabase.from("marketing_brand_assets" as any)
          .update({ title: payload.title, description: payload.description || null, attachments: payload.attachments as any })
          .eq("id", payload.id);
        if (error) throw error;
      } else {
        if (!user) throw new Error("Não autenticado");
        const { error } = await supabase.from("marketing_brand_assets" as any)
          .insert({ title: payload.title, description: payload.description || null, attachments: payload.attachments as any, created_by: user.id });
        if (error) throw error;
      }
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["marketing", "brand-assets"] });
      setEditing(null);
      setOpenNew(false);
      toast.success("Padrão salvo.");
    },
    onError: (e: any) => toast.error("Erro: " + (e?.message ?? "desconhecido")),
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("marketing_brand_assets" as any).delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["marketing", "brand-assets"] });
      toast.success("Removido.");
    },
    onError: (e: any) => toast.error("Erro: " + (e?.message ?? "desconhecido")),
  });

  return (
    <div className="space-y-6 max-w-[1400px]">
      <div className="flex items-start justify-between gap-4">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.16em] text-accent mb-1">Marketing</p>
          <h1 className="text-3xl font-semibold">Padronização da Marca</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Padrões de outdoor, apresentações, arquivos de identidade e mais. Disponível para download.
          </p>
        </div>
        {canEdit && (
          <Dialog open={openNew} onOpenChange={setOpenNew}>
            <DialogTrigger asChild>
              <Button><Plus className="h-4 w-4 mr-1" /> Novo padrão</Button>
            </DialogTrigger>
            <BrandAssetDialog
              key={openNew ? "new" : "closed"}
              onSubmit={(p) => saveMutation.mutate({ ...p })}
              isSaving={saveMutation.isPending}
            />
          </Dialog>
        )}
      </div>

      {isLoading ? (
        <p className="text-sm text-muted-foreground">Carregando…</p>
      ) : assets.length === 0 ? (
        <Card className="p-12 text-center text-sm text-muted-foreground">
          Nenhum padrão publicado ainda.
        </Card>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {assets.map((a) => (
            <Card key={a.id} className="p-4 shadow-soft flex flex-col">
              <div className="flex items-start justify-between gap-2">
                <h3 className="text-base font-semibold flex-1">{a.title}</h3>
                {canEdit && (
                  <div className="flex gap-1 shrink-0">
                    <Button size="icon" variant="ghost" className="h-7 w-7" onClick={() => setEditing(a)}>
                      <Pencil className="h-3.5 w-3.5" />
                    </Button>
                    <Button size="icon" variant="ghost" className="h-7 w-7 text-destructive" onClick={() => {
                      if (confirm("Excluir este padrão?")) deleteMutation.mutate(a.id);
                    }}>
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                )}
              </div>
              {a.description && (
                <p className="text-sm text-muted-foreground mt-2 whitespace-pre-wrap flex-1">{a.description}</p>
              )}
              {Array.isArray(a.attachments) && a.attachments.length > 0 && (
                <div className="mt-3 flex flex-col gap-1.5">
                  {a.attachments.map((att, i) => (
                    <button
                      key={i}
                      onClick={() => downloadAttachment(att)}
                      className="inline-flex items-center gap-2 text-xs px-2 py-1.5 rounded-md border border-border hover:bg-muted/50 text-left"
                    >
                      <FileText className="h-3.5 w-3.5 shrink-0" />
                      <span className="truncate flex-1">{att.name}</span>
                      <Download className="h-3 w-3 shrink-0 text-muted-foreground" />
                    </button>
                  ))}
                </div>
              )}
            </Card>
          ))}
        </div>
      )}

      <Dialog open={!!editing} onOpenChange={(o) => !o && setEditing(null)}>
        {editing && (
          <BrandAssetDialog
            initial={editing}
            onSubmit={(p) => saveMutation.mutate({ ...p, id: editing.id })}
            isSaving={saveMutation.isPending}
          />
        )}
      </Dialog>
    </div>
  );
}

function BrandAssetDialog({
  initial,
  onSubmit,
  isSaving,
}: {
  initial?: BrandAsset;
  onSubmit: (p: { title: string; description: string; attachments: Attachment[] }) => void;
  isSaving: boolean;
}) {
  const [title, setTitle] = useState(initial?.title ?? "");
  const [description, setDescription] = useState(initial?.description ?? "");
  const [attachments, setAttachments] = useState<Attachment[]>(initial?.attachments ?? []);
  const [uploading, setUploading] = useState(false);

  const handleFiles = async (files: FileList | null) => {
    if (!files || files.length === 0) return;
    setUploading(true);
    try {
      const uploaded: Attachment[] = [];
      for (const file of Array.from(files)) {
        const ext = file.name.split(".").pop() ?? "bin";
        const path = `brand/${Date.now()}-${Math.random().toString(36).slice(2)}.${ext}`;
        const { error } = await supabase.storage.from("marketing-assets").upload(path, file, { upsert: false });
        if (error) { toast.error(`Erro ao enviar ${file.name}: ${error.message}`); continue; }
        uploaded.push({ name: file.name, path });
      }
      setAttachments((a) => [...a, ...uploaded]);
    } finally {
      setUploading(false);
    }
  };

  return (
    <DialogContent className="max-w-xl">
      <DialogHeader>
        <DialogTitle>{initial ? "Editar padrão" : "Novo padrão"}</DialogTitle>
      </DialogHeader>
      <div className="space-y-3">
        <div className="space-y-1.5">
          <Label className="text-xs">Título</Label>
          <Input placeholder="Ex: Padrão Outdoor, Padrão Apresentação…" value={title} onChange={(e) => setTitle(e.target.value)} />
        </div>
        <div className="space-y-1.5">
          <Label className="text-xs">Descrição / instruções (opcional)</Label>
          <Textarea rows={5} value={description} onChange={(e) => setDescription(e.target.value)} />
        </div>
        <div className="space-y-1.5">
          <Label className="text-xs flex items-center gap-1.5"><Paperclip className="h-3 w-3" /> Arquivos</Label>
          <Input type="file" multiple disabled={uploading} onChange={(e) => handleFiles(e.target.files)} />
          {attachments.length > 0 && (
            <div className="flex flex-wrap gap-1.5 pt-1">
              {attachments.map((att, i) => (
                <span key={i} className="inline-flex items-center gap-1 text-xs px-2 py-1 rounded-md bg-background border border-border">
                  <FileText className="h-3 w-3" />
                  <span className="truncate max-w-[160px]">{att.name}</span>
                  <button type="button" onClick={() => setAttachments((a) => a.filter((_, j) => j !== i))} className="text-muted-foreground hover:text-destructive">
                    <X className="h-3 w-3" />
                  </button>
                </span>
              ))}
            </div>
          )}
        </div>
        <div className="flex justify-end gap-2 pt-2">
          <Button
            onClick={() => {
              if (!title.trim()) { toast.error("Informe um título."); return; }
              onSubmit({ title: title.trim(), description: description.trim(), attachments });
            }}
            disabled={isSaving || uploading}
          >
            {isSaving ? "Salvando…" : "Salvar"}
          </Button>
        </div>
      </div>
    </DialogContent>
  );
}