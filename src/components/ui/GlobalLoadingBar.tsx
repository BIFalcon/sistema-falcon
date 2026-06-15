import { useEffect, useRef, useState } from "react";
import { useIsFetching, useIsMutating } from "@tanstack/react-query";

/**
 * Barra de progresso indeterminada que aparece no topo da tela sempre que
 * há qualquer atividade de carga (queries ou mutations) em andamento.
 * Some suavemente após o término da última atividade.
 */
export function GlobalLoadingBar() {
  const fetching = useIsFetching();
  const mutating = useIsMutating();
  const busy = fetching + mutating > 0;
  const [visible, setVisible] = useState(false);
  const hideTimer = useRef<number | null>(null);

  useEffect(() => {
    if (busy) {
      if (hideTimer.current) {
        window.clearTimeout(hideTimer.current);
        hideTimer.current = null;
      }
      setVisible(true);
    } else if (visible) {
      // pequeno delay para evitar piscar em cargas rápidas
      hideTimer.current = window.setTimeout(() => setVisible(false), 250);
    }
    return () => {
      if (hideTimer.current) window.clearTimeout(hideTimer.current);
    };
  }, [busy, visible]);

  if (!visible) return null;

  return (
    <div
      className="pointer-events-none fixed inset-x-0 top-0 z-[100] h-0.5 overflow-hidden"
      role="progressbar"
      aria-label="Carregando"
    >
      <div className="h-full w-1/3 animate-[loadingbar_1.2s_ease-in-out_infinite] bg-accent" />
      <style>{`
        @keyframes loadingbar {
          0%   { transform: translateX(-100%); }
          50%  { transform: translateX(150%); }
          100% { transform: translateX(350%); }
        }
      `}</style>
    </div>
  );
}