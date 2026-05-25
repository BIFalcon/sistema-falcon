import { useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import { Pencil, Loader2, Building2, Users } from "lucide-react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useOrgNodes, type RhOrgNode } from "@/hooks/useRh";
import { useAuth } from "@/contexts/AuthContext";

interface NodeWithChildren extends RhOrgNode {
  children: NodeWithChildren[];
}

function buildTree(nodes: RhOrgNode[]): NodeWithChildren[] {
  const map = new Map<string, NodeWithChildren>();
  nodes.forEach((n) => map.set(n.id, { ...n, children: [] }));
  const roots: NodeWithChildren[] = [];
  map.forEach((n) => {
    if (n.parent_id && map.has(n.parent_id)) map.get(n.parent_id)!.children.push(n);
    else roots.push(n);
  });
  return roots;
}

function useResponsibilities(nodeId: string | null) {
  return useQuery({
    queryKey: ["rh", "responsibilities", nodeId],
    queryFn: async () => {
      if (!nodeId) return [];
      const { data, error } = await supabase
        .from("rh_org_responsibilities")
        .select("*")
        .eq("node_id", nodeId)
        .order("sort_order");
      if (error) throw error;
      return data ?? [];
    },
    enabled: !!nodeId,
  });
}

function OrgNode({
  node,
  canEdit,
  onEdit,
}: {
  node: NodeWithChildren;
  canEdit: boolean;
  onEdit: (n: NodeWithChildren) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const hasChildren = node.children.length > 0;
  const isVacant = node.is_open_position;

  return (
    <div className="flex flex-row items-center">
      <div className="relative group">
        <div
          className={`w-36 rounded-xl border bg-card p-3 shadow-sm select-none transition-shadow
            ${hasChildren ? "cursor-pointer hover:shadow-md" : ""}
            ${isVacant ? "border-dashed opacity-60" : ""}`}
          onClick={() => hasChildren && setExpanded((x) => !x)}
        >
          <div className="w-14 h-14 rounded-full overflow-hidden mx-auto mb-2 bg-muted border-2 border-primary/20 flex items-center justify-center">
            {node.photo_url ? (
              <img src={node.photo_url} alt={node.name} className="w-full h-full object-cover" />
            ) : (
              <span className="text-xl font-bold text-muted-foreground">
                {isVacant ? "?" : (node.name?.charAt(0).toUpperCase() ?? "?")}
              </span>
            )}
          </div>
          <p className="text-xs font-semibold text-center leading-tight truncate">
            {isVacant ? "Vaga em Aberto" : node.name}
          </p>
          {node.position && (
            <p className="text-[10px] text-muted-foreground text-center truncate mt-0.5">
              {node.position}
            </p>
          )}
          {node.department && (
            <Badge variant="outline" className="text-[9px] mt-1 w-full justify-center truncate">
              {node.department}
            </Badge>
          )}
          {canEdit && (
            <Button
              variant="ghost"
              size="icon"
              className="absolute top-1 right-1 h-5 w-5 opacity-0 group-hover:opacity-100 transition-opacity"
              onClick={(e) => { e.stopPropagation(); onEdit(node); }}
            >
              <Pencil className="h-3 w-3" />
            </Button>
          )}
          {hasChildren && (
            <div className="absolute -right-2.5 top-1/2 -translate-y-1/2 w-5 h-5 rounded-full bg-primary text-primary-foreground flex items-center justify-center text-[10px] shadow-sm z-10">
              {expanded ? "−" : "+"}
            </div>
          )}
        </div>
      </div>

      {expanded && hasChildren && (
        <div className="flex flex-row items-center ml-5">
          <div className="w-5 border-t border-border" />
          <div className="flex flex-col gap-3">
            {node.children.map((child, idx) => (
              <div key={child.id} className="flex flex-row items-center">
                {node.children.length > 1 && (
                  <div
                    className={`w-4 border-t border-border border-l
                      ${idx === 0 ? "rounded-tl" : ""}
                      ${idx === node.children.length - 1 ? "rounded-bl" : ""}`}
                  />
                )}
                <OrgNode node={child} canEdit={canEdit} onEdit={onEdit} />
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

export default function OrganogramaPage() {
  const { data: nodes = [] } = useOrgNodes();
  const { hasRole, isMaster } = useAuth();
  const canEdit = isMaster || hasRole("rh");
  const qc = useQueryClient();

  const [editing, setEditing] = useState<NodeWithChildren | null>(null);
  const [form, setForm] = useState({ name: "", position: "", photo_url: "", responsibilities: "" });
  const [uploadingPhoto, setUploadingPhoto] = useState(false);
  const resps = useResponsibilities(editing?.id ?? null);

  const matriz = useMemo(() => buildTree(nodes.filter((n) => !n.hotel_id)), [nodes]);

  // GOPs com seus hotéis (aba Hotéis)
  const { data: gopHotels = [] } = useQuery({
    queryKey: ["rh-org-gop-hotels"],
    queryFn: async () => {
      const { data: gopRoles } = await supabase
        .from("user_roles")
        .select("user_id")
        .eq("role", "gop");
      if (!gopRoles?.length) return [] as Array<{ id: string; name: string; hotels: Array<{ id: string; name: string }> }>;
      const gopIds = Array.from(new Set(gopRoles.map((r) => r.user_id)));

      const [{ data: profiles }, { data: userHotels }] = await Promise.all([
        supabase.from("profiles").select("user_id, display_name, email").in("user_id", gopIds),
        supabase
          .from("user_hotels")
          .select("user_id, hotel_id, hotels(id, name)")
          .in("user_id", gopIds),
      ]);

      return (profiles ?? []).map((p) => ({
        id: p.user_id,
        name: p.display_name ?? p.email ?? "GOP",
        hotels: (userHotels ?? [])
          .filter((uh) => uh.user_id === p.user_id)
          .map((uh) => uh.hotels as unknown as { id: string; name: string })
          .filter(Boolean),
      }));
    },
  });

  const hoteisTree: NodeWithChildren[] = useMemo(() => {
    if (!gopHotels.length) return [];
    const ceo: NodeWithChildren = {
      id: "synthetic-ceo",
      parent_id: null,
      name: "CEO",
      position: "CEO",
      department: null,
      hotel_id: null,
      photo_url: null,
      is_open_position: false,
      sort_order: 0,
      children: gopHotels.map((g) => ({
        id: `gop-${g.id}`,
        parent_id: "synthetic-ceo",
        name: g.name,
        position: "GOP",
        department: null,
        hotel_id: null,
        photo_url: null,
        is_open_position: false,
        sort_order: 0,
        children: g.hotels.map((h) => ({
          id: `hotel-${h.id}`,
          parent_id: `gop-${g.id}`,
          name: h.name,
          position: "Hotel",
          department: null,
          hotel_id: h.id,
          photo_url: null,
          is_open_position: false,
          sort_order: 0,
          children: [],
        })),
      })),
    };
    return [ceo];
  }, [gopHotels]);

  const openEdit = (n: NodeWithChildren) => {
    setEditing(n);
    setForm({
      name: n.name,
      position: n.position ?? "",
      photo_url: n.photo_url ?? "",
      responsibilities: "",
    });
  };

  useEffect(() => {
    if (resps.data && editing) {
      setForm((f) => ({ ...f, responsibilities: resps.data!.map((r: any) => r.description).join("\n") }));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [resps.data, editing?.id]);

  const save = useMutation({
    mutationFn: async () => {
      if (!editing) return;
      const { error } = await supabase.from("rh_org_nodes").update({
        name: form.name,
        position: form.position || null,
        photo_url: form.photo_url || null,
      }).eq("id", editing.id);
      if (error) throw error;

      await supabase.from("rh_org_responsibilities").delete().eq("node_id", editing.id);
      const lines = form.responsibilities.split("\n").map((l) => l.trim()).filter(Boolean);
      if (lines.length) {
        await supabase.from("rh_org_responsibilities").insert(
          lines.map((description, i) => ({ node_id: editing.id, description, sort_order: i })),
        );
      }
    },
    onSuccess: () => {
      toast.success("Atualizado.");
      qc.invalidateQueries({ queryKey: ["rh", "org-nodes"] });
      qc.invalidateQueries({ queryKey: ["rh", "responsibilities"] });
      setEditing(null);
    },
    onError: (e: any) => toast.error("Erro: " + (e?.message ?? "desconhecido")),
  });

  const handleEdit = (n: NodeWithChildren) => {
    if (n.id.startsWith("synthetic-") || n.id.startsWith("gop-") || n.id.startsWith("hotel-")) return;
    openEdit(n);
  };

  return (
    <div className="space-y-6 max-w-[1400px]">
      <div>
        <p className="text-xs font-semibold uppercase tracking-[0.16em] text-accent mb-1">RH & People</p>
        <h1 className="text-3xl font-semibold">Organograma</h1>
        <p className="text-sm text-muted-foreground mt-1">Estrutura organizacional da Falcon.</p>
      </div>

      <Tabs defaultValue="matriz">
        <TabsList>
          <TabsTrigger value="matriz"><Users className="h-3.5 w-3.5 mr-2" /> Matriz</TabsTrigger>
          <TabsTrigger value="hoteis"><Building2 className="h-3.5 w-3.5 mr-2" /> Hotéis</TabsTrigger>
        </TabsList>
        <TabsContent value="matriz" className="mt-4">
          <div className="overflow-x-auto overflow-y-auto min-h-[400px] p-6 border rounded-lg bg-muted/20">
            <div className="flex flex-row items-start gap-6 w-max">
              {matriz.map((root) => (
                <OrgNode key={root.id} node={root} canEdit={canEdit} onEdit={handleEdit} />
              ))}
              {matriz.length === 0 && (
                <p className="text-sm text-muted-foreground">Nenhum nó cadastrado.</p>
              )}
            </div>
          </div>
        </TabsContent>
        <TabsContent value="hoteis" className="mt-4">
          <div className="overflow-x-auto overflow-y-auto min-h-[400px] p-6 border rounded-lg bg-muted/20">
            <div className="flex flex-row items-start gap-6 w-max">
              {hoteisTree.map((root) => (
                <OrgNode key={root.id} node={root} canEdit={false} onEdit={handleEdit} />
              ))}
              {hoteisTree.length === 0 && (
                <p className="text-sm text-muted-foreground">Nenhum GOP com hotéis associados.</p>
              )}
            </div>
          </div>
        </TabsContent>
      </Tabs>

      <Dialog open={!!editing} onOpenChange={(o) => !o && setEditing(null)}>
        <DialogContent className="max-w-md">
          <DialogHeader><DialogTitle>Editar nó</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <div><Label>Nome</Label><Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></div>
            <div><Label>Cargo</Label><Input value={form.position} onChange={(e) => setForm({ ...form, position: e.target.value })} /></div>
            <div className="space-y-2">
              <Label>Foto</Label>
              {form.photo_url && (
                <img src={form.photo_url} alt="" className="w-16 h-16 rounded-full object-cover border" />
              )}
              <Input
                type="file"
                accept="image/*"
                disabled={uploadingPhoto}
                onChange={async (e) => {
                  const file = e.target.files?.[0];
                  if (!file) return;
                  setUploadingPhoto(true);
                  try {
                    const ext = file.name.split(".").pop() ?? "jpg";
                    const path = `org/${Date.now()}-${Math.random().toString(36).slice(2)}.${ext}`;
                    const { error } = await supabase.storage
                      .from("rh-photos")
                      .upload(path, file, { upsert: true });
                    if (error) {
                      toast.error("Erro ao enviar foto.");
                      return;
                    }
                    const { data: urlData } = supabase.storage.from("rh-photos").getPublicUrl(path);
                    setForm((f) => ({ ...f, photo_url: urlData.publicUrl }));
                  } finally {
                    setUploadingPhoto(false);
                  }
                }}
              />
              {form.photo_url && (
                <Button variant="ghost" size="sm" onClick={() => setForm((f) => ({ ...f, photo_url: "" }))}>
                  Remover foto
                </Button>
              )}
            </div>
            <div>
              <Label>Responsabilidades (uma por linha)</Label>
              <Textarea rows={5} value={form.responsibilities} onChange={(e) => setForm({ ...form, responsibilities: e.target.value })} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditing(null)}>Cancelar</Button>
            <Button onClick={() => save.mutate()} disabled={save.isPending}>
              {save.isPending && <Loader2 className="h-3.5 w-3.5 mr-2 animate-spin" />}
              Salvar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
