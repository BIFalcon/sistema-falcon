import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CartaPdfViewerDialog } from "@/components/closings/CartaPdfViewerDialog";

const { signedUrl } = vi.hoisted(() => ({ signedUrl: vi.fn() }));
vi.mock("@/hooks/useLetter", () => ({ getLetterPdfSignedUrl: signedUrl }));

afterEach(() => { cleanup(); vi.clearAllMocks(); });

describe("visualização sem substituição silenciosa", () => {
  it("não busca o PDF salvo quando a geração falha", async () => {
    const buildBlob = vi.fn().mockRejectedValue(new Error("Falha nos gráficos"));
    render(<CartaPdfViewerDialog open onOpenChange={() => {}} pdfPath="closing/v6.pdf" buildBlob={buildBlob} />);
    await screen.findByRole("alert");
    expect(buildBlob).toHaveBeenCalledTimes(1);
    expect(signedUrl).not.toHaveBeenCalled();
    expect(document.querySelector("iframe")).toBeNull();
  });

  it("não busca o PDF salvo quando a geração não produz arquivo", async () => {
    render(<CartaPdfViewerDialog open onOpenChange={() => {}} pdfPath="closing/v6.pdf" buildBlob={async () => null} />);
    await screen.findByRole("alert");
    expect(signedUrl).not.toHaveBeenCalled();
    expect(document.querySelector("iframe")).toBeNull();
  });

  it("mantém a visualização salva quando não há gerador configurado", async () => {
    signedUrl.mockResolvedValue("https://example.test/letter.pdf");
    render(<CartaPdfViewerDialog open onOpenChange={() => {}} pdfPath="closing/v6.pdf" />);
    await waitFor(() => expect(document.querySelector("iframe")?.src).toBe("https://example.test/letter.pdf"));
    expect(signedUrl).toHaveBeenCalledWith("closing/v6.pdf");
  });
});