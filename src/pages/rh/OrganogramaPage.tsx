import { useMemo, useState } from "react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import {
  ChevronDown, ChevronRight, ImageIcon, Pencil, Loader2, Building2, Users,
} from "lucide-react";
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

function NodeCard({
  node, canEdit, onEdit, depth = 0,
}: {
  node: NodeWithChildren; canEdit: boolean; onEdit: (n: NodeWithChildren) => void; depth?: number;
}) {
  const [open, setOpen] = useState(depth < 1);
  const hasChildren = node.children.length > 0;
  return (
    <div className="space-y-2">
      <Card className="p-3 shadow-soft flex items-center gap-3">
        {hasChildren ? (
          <button onClick={() => setOpen((o) => !o)} className="p-1 hover:bg-muted rounded">
            {open ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
          </button>
        ) : (
          <div className="w-6" />
        )}
        <div className="h-10 w-10 rounded-full bg-muted flex items-center justify-center overflow-hidden shrink-0">
          {node.is_open_position ? (
            <ImageIcon className="h-5 w-5 text-muted-foreground" />
          ) : node.photo_url ? (
            <img src={node.photo_url} alt={node.name} className="h-full w-full object-cover" />
          ) : (
            <span className="text-xs font-semibold">{node.name[0]}</span>
          )}
        </div>
        <div className="flex-1 min-w-0">
          {node.is_open_position ? (
            <Badge variant="outline" className="border-amber-500/40 text-amber-700 dark:text-amber-400">VAGA ABERTA</Badge>
          ) : (
            <p className="text-sm font-medium truncate">{node.name}</p>
          )}
          <p className="text-xs text-muted-foreground truncate">
            {node.position}{node.hotel_id ? ` · ${node.hotel_id}` : node.department ? ` · ${node.department}` : ""}
          </p>
        </div>
        {canEdit && (
          <Button size="sm" variant="ghost" onClick={() => onEdit(node)}>
            <Pencil className="h-3.5 w-3.5" />
          </Button>
        )}
      </Card>
      {open && hasChildren && (
        <div className="pl-8 border-l border-border ml-3 space-y-2">
          {node.children.map((c) => (
            <NodeCard key={c.id} node={c} canEdit={canEdit} onEdit={onEdit} depth={depth + 1} />
          ))}
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
  const resps = useResponsibilities(editing?.id ?? null);

  const { matriz, hoteis } = useMemo(() => {
    const matrizNodes = nodes.filter((n) => !n.hotel_id);
    const hotelNodes = nodes.filter((n) => !!n.hotel_id);
    return { matriz: buildTree(matrizNodes), hoteis: buildTree(hotelNodes) };
  }, [nodes]);

  const openEdit = (n: NodeWithChildren) => {
    setEditing(n);
    setForm({
      name: n.name,
      position: n.position ?? "",
      photo_url: n.photo_url ?? "",
      responsibilities: "",
    });
  };

  // sync responsibilities textarea after fetch
  useMemo(() => {
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

      // replace responsibilities
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

  return (
    <div className="space-y-6 max-w-[1200px]">
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
        <TabsContent value="matriz" className="space-y-2 mt-4">
          {matriz.map((n) => <NodeCard key={n.id} node={n} canEdit={canEdit} onEdit={openEdit} />)}
        </TabsContent>
        <TabsContent value="hoteis" className="space-y-2 mt-4">
          {hoteis.map((n) => <NodeCard key={n.id} node={n} canEdit={canEdit} onEdit={openEdit} />)}
        </TabsContent>
      </Tabs>

      <Dialog open={!!editing} onOpenChange={(o) => !o && setEditing(null)}>
        <DialogContent className="max-w-md">
          <DialogHeader><DialogTitle>Editar nó</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <div><Label>Nome</Label><Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></div>
            <div><Label>Cargo</Label><Input value={form.position} onChange={(e) => setForm({ ...form, position: e.target.value })} /></div>
            <div><Label>URL da foto</Label><Input value={form.photo_url} onChange={(e) => setForm({ ...form, photo_url: e.target.value })} placeholder="https://..." /></div>
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