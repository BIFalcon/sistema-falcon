import { beforeEach, describe, expect, it, vi } from "vitest";
import { fetchSystemAlerts, resolveSystemAlert } from "@/hooks/useSystemAlerts";

const db = vi.hoisted(() => ({
  from: vi.fn(), select: vi.fn(), eq: vi.fn(), order: vi.fn(), limit: vi.fn(),
  update: vi.fn(), single: vi.fn(),
}));
vi.mock("@/integrations/supabase/client", () => ({ supabase: db }));

beforeEach(() => {
  vi.resetAllMocks();
  for (const method of [db.from, db.select, db.eq, db.order, db.update]) method.mockReturnValue(db);
});

describe("system alert persistence", () => {
  it("returns the full pending count even when only five alerts are visible", async () => {
    const alerts = Array.from({ length: 5 }, (_, i) => ({ id: `alert-${i}` }));
    db.limit.mockResolvedValue({ data: alerts, count: 51, error: null });
    expect(await fetchSystemAlerts()).toEqual({ alerts, total: 51 });
    expect(db.select).toHaveBeenCalledWith("id, type, message, created_at", { count: "exact" });
    expect(db.eq).toHaveBeenCalledWith("resolved", false);
  });
  it("confirms that the selected alert was saved as resolved", async () => {
    db.single.mockResolvedValue({ data: { id: "selected-alert" }, error: null });
    expect(await resolveSystemAlert("selected-alert")).toBe("selected-alert");
    expect(db.update).toHaveBeenCalledWith({ resolved: true });
    expect(db.eq).toHaveBeenCalledWith("id", "selected-alert");
  });
  it("does not report success when an update fails", async () => {
    const error = new Error("permission denied");
    db.single.mockResolvedValue({ data: null, error });
    await expect(resolveSystemAlert("selected-alert")).rejects.toThrow("permission denied");
  });
  it("does not report success when no row was updated", async () => {
    db.single.mockResolvedValue({ data: null, error: null });
    await expect(resolveSystemAlert("selected-alert")).rejects.toThrow("O alerta não foi atualizado.");
  });
  it("does not hide read failures as an empty alert list", async () => {
    db.limit.mockResolvedValue({ data: null, count: null, error: new Error("read failed") });
    await expect(fetchSystemAlerts()).rejects.toThrow("read failed");
  });
});