import { createRoot } from "react-dom/client";
import App from "./App.tsx";
import "./index.css";

// Alguns usuários (proxies corporativos / antivírus / cache heurístico do
// navegador) recebiam respostas antigas da API mesmo após F5, fazendo a tela
// mostrar versões/fotos desatualizadas. As respostas do backend não trazem
// Cache-Control, então forçamos "no-store" em todas as chamadas de API.
if (typeof window !== "undefined" && !(window as any).__noStoreFetchPatched) {
  (window as any).__noStoreFetchPatched = true;
  const originalFetch = window.fetch.bind(window);
  window.fetch = ((input: RequestInfo | URL, init?: RequestInit) => {
    let url = "";
    try {
      url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    } catch {
      url = "";
    }
    if (url.includes(".supabase.co/") || url.includes("/rest/v1/") || url.includes("/functions/v1/")) {
      return originalFetch(input, { ...(init ?? {}), cache: "no-store" });
    }
    return originalFetch(input, init);
  }) as typeof window.fetch;
}

createRoot(document.getElementById("root")!).render(<App />);
