import { describe, it, expect } from "vitest";
import { canActOnStage } from "@/lib/closingStageAccess";

describe("canActOnStage", () => {
  it("Fernando não aprova DRE em Aguardando Controladoria", () => {
    expect(canActOnStage("dre", "aguardando_controladoria", ["fernando"])).toBe(false);
  });
  it("Fernando não aprova DRE em Aguardando GOP", () => {
    expect(canActOnStage("dre", "aguardando_gop", ["fernando"])).toBe(false);
  });
  it("Fernando aprova DRE em Aguardando Fernando", () => {
    expect(canActOnStage("dre", "aguardando_fernando", ["fernando"])).toBe(true);
  });
  it("Fernando não aprova Carta em Aguardando GG", () => {
    expect(canActOnStage("carta", "aguardando_gg", ["fernando"])).toBe(false);
  });
  it("Fernando aprova Carta em Aguardando Fernando", () => {
    expect(canActOnStage("carta", "aguardando_fernando", ["fernando"])).toBe(true);
  });
  it("Master (processos) sem papel fernando aprova qualquer etapa", () => {
    expect(canActOnStage("dre", "aguardando_gop", ["processos"])).toBe(true);
  });
  it("Master com papel fernando segue a regra do Fernando", () => {
    expect(canActOnStage("dre", "aguardando_gop", ["processos", "fernando"])).toBe(false);
  });
});
