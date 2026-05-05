import { ArrowUp } from "lucide-react";

interface EmptyHotelStateProps {
  icon: React.ReactNode;
  title: string;
  description?: string;
}

export function EmptyHotelState({ icon, title, description }: EmptyHotelStateProps) {
  return (
    <div className="flex flex-col items-center justify-center py-20 gap-4 text-center text-muted-foreground">
      <div className="flex flex-col items-center gap-2 animate-bounce">
        <ArrowUp className="h-5 w-5 text-accent" />
        <span className="text-xs font-semibold uppercase tracking-wider text-accent">
          Selecione um hotel no filtro acima
        </span>
      </div>
      <div className="opacity-30 mt-2">{icon}</div>
      <p className="text-sm font-medium text-foreground/60">{title}</p>
      {description && <p className="text-xs max-w-xs">{description}</p>}
    </div>
  );
}