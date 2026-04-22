import { useMemo, useRef, useState } from "react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { useAuth } from "@/contexts/AuthContext";
import {
  useAllHotels,
  useHotel,
  useUpdateHotelAsset,
  uploadHotelAsset,
  useFalconLogo,
  useUpdateFalconLogo,
  uploadFalconLogo,
  type HotelRow,
} from "@/hooks/useHotelAssets";
import { Building2, Image as ImageIcon, Search, Upload, Loader2, AlertTriangle, CheckCircle2 } from "lucide-react";
import { toast } from "sonner";

export default function HoteisPage() {
  const { hasRole, user } = useAuth();
  const canEdit = hasRole("processos");
  const { data: hotels = [], isLoading } = useAllHotels();
  const { data: falconLogo } = useFalconLogo();
  const updateFalcon = useUpdateFalconLogo();
  const falconRef = useRef<HTMLInputElement | null>(null);
  const [uploadingFalcon, setUploadingFalcon] = useState(false);

  const [search, setSearch] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return hotels;
    return hotels.filter(
      (h) => h.name.toLowerCase().includes(q) || h.brand.toLowerCase().includes(q),
    );
  }, [hotels, search]);

  async function handleFalconUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0];
    if (!f || !user) return;
    setUploadingFalcon(true);
    try {
      const url = await uploadFalconLogo(f);
      await updateFalcon.mutateAsync({ url, userId: user.id });
      toast.success("Logo Falcon atualizada");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Erro ao enviar logo");
    } finally {
      setUploadingFalcon(false);
      if (falconRef.current) falconRef.current.value = "";
    }
  }

  return (
    <div className="space-y-6 max-w-[1400px]">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.16em] text-accent">Sistema</p>
          <h1 className="text-2xl font-semibold">Hotéis</h1>
          <p className="text-sm text-muted-foreground">
            Gerencie os assets visuais usados na Carta ao Investidor.
          </p>
        </div>
      </div>

      {/* Falcon institucional */}
      <Card className="p-5 shadow-soft">
        <div className="flex items-start gap-4 flex-wrap">
          <div className="flex-1 min-w-[200px]">
            <h3 className="text-sm font-semibold uppercase tracking-wider mb-1">Logo Falcon institucional</h3>
            <p className="text-xs text-muted-foreground">
              Usada em todos os documentos gerados pelo sistema.
            </p>
            {!falconLogo && (
              <div className="flex items-center gap-1 mt-2 text-xs text-amber-600">
                <AlertTriangle className="h-3.5 w-3.5" /> Logo não configurada
              </div>
            )}
          </div>
          <div className="flex items-center gap-3">
            {falconLogo ? (
              <div className="h-20 w-32 rounded border bg-muted/30 flex items-center justify-center p-2">
                <img src={falconLogo} alt="Falcon" className="max-h-full max-w-full object-contain" />
              </div>
            ) : (
              <div className="h-20 w-32 rounded border border-dashed flex items-center justify-center text-muted-foreground">
                <ImageIcon className="h-5 w-5" />
              </div>
            )}
            <input
              ref={falconRef}
              type="file"
              accept="image/*"
              className="hidden"
              onChange={handleFalconUpload}
              disabled={!canEdit || uploadingFalcon}
            />
            <Button
              variant="outline"
              size="sm"
              disabled={!canEdit || uploadingFalcon}
              onClick={() => falconRef.current?.click()}
              className="gap-2"
            >
              {uploadingFalcon ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />}
              {falconLogo ? "Trocar logo" : "Enviar logo"}
            </Button>
          </div>
        </div>
        {!canEdit && (
          <p className="text-[11px] text-muted-foreground mt-3">
            Apenas usuários com perfil <strong>Processos</strong> podem editar assets.
          </p>
        )}
      </Card>

      {/* Lista de hotéis */}
      <Card className="p-5 shadow-soft space-y-4">
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <div>
            <h3 className="text-sm font-semibold uppercase tracking-wider">Hotéis cadastrados</h3>
            <p className="text-xs text-muted-foreground">{hotels.length} hotéis · clique para gerenciar assets</p>
          </div>
          <div className="relative w-64 max-w-full">
            <Search className="h-4 w-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Buscar hotel ou bandeira…"
              className="pl-9"
            />
          </div>
        </div>

        {isLoading ? (
          <div className="text-sm text-muted-foreground">Carregando…</div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {filtered.map((h) => (
              <HotelCard key={h.id} hotel={h} onSelect={() => setSelectedId(h.id)} />
            ))}
            {filtered.length === 0 && (
              <p className="text-sm text-muted-foreground col-span-full">Nenhum hotel encontrado.</p>
            )}
          </div>
        )}
      </Card>

      <HotelAssetSheet
        hotelId={selectedId}
        open={!!selectedId}
        canEdit={canEdit}
        onClose={() => setSelectedId(null)}
      />
    </div>
  );
}

function HotelCard({ hotel, onSelect }: { hotel: HotelRow; onSelect: () => void }) {
  const ready = !!hotel.cover_url && !!hotel.brand_logo_url;
  return (
    <button
      type="button"
      onClick={onSelect}
      className="group text-left rounded-lg border bg-card hover:border-accent hover:shadow-soft transition-all overflow-hidden"
    >
      <div className="aspect-[16/9] bg-muted relative">
        {hotel.cover_url ? (
          <img src={hotel.cover_url} alt={hotel.name} className="h-full w-full object-cover" />
        ) : (
          <div className="h-full w-full flex items-center justify-center text-muted-foreground">
            <Building2 className="h-8 w-8" />
          </div>
        )}
        {hotel.brand_logo_url && (
          <div className="absolute top-2 right-2 h-9 w-9 rounded bg-white/90 p-1 flex items-center justify-center shadow">
            <img src={hotel.brand_logo_url} alt={hotel.brand} className="max-h-full max-w-full object-contain" />
          </div>
        )}
      </div>
      <div className="p-3 space-y-1">
        <p className="text-sm font-semibold leading-tight">{hotel.name}</p>
        <div className="flex items-center justify-between gap-2">
          <Badge variant="outline" className="text-[10px] uppercase">{hotel.brand}</Badge>
          {ready ? (
            <span className="flex items-center gap-1 text-[10px] text-emerald-600">
              <CheckCircle2 className="h-3 w-3" /> Completo
            </span>
          ) : (
            <span className="flex items-center gap-1 text-[10px] text-amber-600">
              <AlertTriangle className="h-3 w-3" /> Incompleto
            </span>
          )}
        </div>
      </div>
    </button>
  );
}

function HotelAssetSheet({
  hotelId,
  open,
  canEdit,
  onClose,
}: {
  hotelId: string | null;
  open: boolean;
  canEdit: boolean;
  onClose: () => void;
}) {
  const { data: hotel } = useHotel(hotelId);
  const update = useUpdateHotelAsset();
  const coverRef = useRef<HTMLInputElement | null>(null);
  const logoRef = useRef<HTMLInputElement | null>(null);
  const [uploading, setUploading] = useState<"cover" | "brand-logo" | null>(null);

  async function handleFile(kind: "cover" | "brand-logo", e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0];
    if (!f || !hotel) return;
    setUploading(kind);
    try {
      const url = await uploadHotelAsset(hotel.id, kind, f);
      await update.mutateAsync({
        id: hotel.id,
        patch: kind === "cover" ? { cover_url: url } : { brand_logo_url: url },
      });
      toast.success(kind === "cover" ? "Capa atualizada" : "Logo da bandeira atualizada");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Erro ao enviar arquivo");
    } finally {
      setUploading(null);
      if (kind === "cover" && coverRef.current) coverRef.current.value = "";
      if (kind === "brand-logo" && logoRef.current) logoRef.current.value = "";
    }
  }

  return (
    <Sheet open={open} onOpenChange={(o) => !o && onClose()}>
      <SheetContent className="w-full sm:max-w-lg overflow-y-auto">
        {hotel && (
          <>
            <SheetHeader>
              <SheetTitle>{hotel.name}</SheetTitle>
              <SheetDescription>
                Bandeira: <span className="uppercase">{hotel.brand}</span>
              </SheetDescription>
            </SheetHeader>

            <div className="mt-6 space-y-6">
              {/* Capa */}
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <h4 className="text-sm font-semibold">Foto de capa do hotel</h4>
                  {!hotel.cover_url && (
                    <span className="text-[10px] flex items-center gap-1 text-amber-600">
                      <AlertTriangle className="h-3 w-3" /> Faltando
                    </span>
                  )}
                </div>
                <div className="aspect-[16/9] rounded border bg-muted/30 overflow-hidden">
                  {hotel.cover_url ? (
                    <img src={hotel.cover_url} alt="capa" className="h-full w-full object-cover" />
                  ) : (
                    <div className="h-full w-full flex items-center justify-center text-muted-foreground">
                      <ImageIcon className="h-8 w-8" />
                    </div>
                  )}
                </div>
                <input
                  ref={coverRef}
                  type="file"
                  accept="image/*"
                  className="hidden"
                  onChange={(e) => handleFile("cover", e)}
                  disabled={!canEdit}
                />
                <Button
                  variant="outline"
                  size="sm"
                  className="w-full gap-2"
                  disabled={!canEdit || uploading === "cover"}
                  onClick={() => coverRef.current?.click()}
                >
                  {uploading === "cover" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />}
                  {hotel.cover_url ? "Trocar foto de capa" : "Enviar foto de capa"}
                </Button>
                <p className="text-[11px] text-muted-foreground">
                  Usada como capa da Carta ao Investidor. Recomendado 16:9.
                </p>
              </div>

              {/* Logo da bandeira */}
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <h4 className="text-sm font-semibold">Logo da bandeira</h4>
                  {!hotel.brand_logo_url && (
                    <span className="text-[10px] flex items-center gap-1 text-amber-600">
                      <AlertTriangle className="h-3 w-3" /> Faltando
                    </span>
                  )}
                </div>
                <div className="h-32 rounded border bg-muted/30 flex items-center justify-center p-4">
                  {hotel.brand_logo_url ? (
                    <img src={hotel.brand_logo_url} alt="logo" className="max-h-full max-w-full object-contain" />
                  ) : (
                    <ImageIcon className="h-8 w-8 text-muted-foreground" />
                  )}
                </div>
                <input
                  ref={logoRef}
                  type="file"
                  accept="image/*"
                  className="hidden"
                  onChange={(e) => handleFile("brand-logo", e)}
                  disabled={!canEdit}
                />
                <Button
                  variant="outline"
                  size="sm"
                  className="w-full gap-2"
                  disabled={!canEdit || uploading === "brand-logo"}
                  onClick={() => logoRef.current?.click()}
                >
                  {uploading === "brand-logo" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />}
                  {hotel.brand_logo_url ? "Trocar logo da bandeira" : "Enviar logo da bandeira"}
                </Button>
                <p className="text-[11px] text-muted-foreground">
                  Logo oficial da bandeira ({hotel.brand}). Preferir PNG com fundo transparente.
                </p>
              </div>

              {!canEdit && (
                <p className="text-xs text-muted-foreground border-t pt-3">
                  Apenas usuários com perfil <strong>Processos</strong> podem editar assets.
                </p>
              )}
            </div>
          </>
        )}
      </SheetContent>
    </Sheet>
  );
}
