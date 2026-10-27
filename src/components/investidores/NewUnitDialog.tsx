import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "sonner";
import { useAuth } from "@/contexts/AuthContext";
import { useInvestorMutations } from "@/hooks/useInvestors";

export function NewUnitDialog({ open, onOpenChange, defaultHotelId }: { open: boolean; onOpenChange: (o: boolean) => void; defaultHotelId: string | null }) {
  const { allowedHotels } = useAuth();
  const navigate = useNavigate();
  const { createUnit } = useInvestorMutations();
  const [f, setF] = useState({ hotelId: "", codigo: "", modalidade: "pool", matricula: "" });

  useEffect(() => {
    if (open) setF({ hotelId: defaultHotelId ?? (allowedHotels.length === 1 ? allowedHotels[0].id : ""), codigo: "", modalidade: "pool", matricula: "" });
  }, [open, defaultHotelId, allowedHotels]);

  const save = async () => {
    try {
      const id = await createUnit.mutateAsync({ hotelId: f.hotelId, codigo: f.codigo, modalidade: f.modalidade, matricula: f.matricula });
      toast.success(`UH ${f.codigo.trim().toUpperCase()} cadastrada — agora vincule o investidor.`);
      onOpenChange(false);
      navigate(`/investidores/uh/${id}`);
    } catch (e) { toast.error(e instanceof Error ? e.message : "Erro ao cadastrar"); }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Nova UH</DialogTitle>
          <DialogDescription>A UH é a base do cadastro. Depois de criada, vincule o investidor e os favorecidos.</DialogDescription>
        </DialogHeader>
        <div className="grid grid-cols-2 gap-3">
          <div className="col-span-2 space-y-1">
            <Label>Hotel</Label>
            <Select value={f.hotelId} onValueChange={(v) => setF((s) => ({ ...s, hotelId: v }))}>
              <SelectTrigger><SelectValue placeholder="Escolha o hotel" /></SelectTrigger>
              <SelectContent>{allowedHotels.map((h) => <SelectItem key={h.id} value={h.id}>{h.name}</SelectItem>)}</SelectContent>
            </Select>
          </div>
          <div className="space-y-1"><Label>Código da UH</Label><Input value={f.codigo} onChange={(e) => setF((s) => ({ ...s, codigo: e.target.value }))} placeholder="Ex.: 302" /></div>
          <div className="space-y-1">
            <Label>Modalidade</Label>
            <Select value={f.modalidade} onValueChange={(v) => setF((s) => ({ ...s, modalidade: v }))}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent><SelectItem value="pool">Pool</SelectItem><SelectItem value="condo">Condo</SelectItem></SelectContent>
            </Select>
          </div>
          <div className="col-span-2 space-y-1"><Label>Matrícula do imóvel (opcional)</Label><Input value={f.matricula} onChange={(e) => setF((s) => ({ ...s, matricula: e.target.value }))} /></div>
        </div>
        <DialogFooter><Button disabled={!f.hotelId || !f.codigo.trim() || createUnit.isPending} onClick={save}>Cadastrar UH</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
