import { describe, expect, it } from "vitest";
import { providerSupports } from "../provider-choice";
import { resolveProviderPlan } from "../providers.server";

const ENV = {
  POLYGON_API_KEY: "x",
  TWELVEDATA_API_KEY: "x",
  ALPHA_VANTAGE_API_KEY: "x",
  METALPRICE_API_KEY: "x",
};

describe("provider preference", () => {
  it("auto keeps the corrected cascade", () => {
    const auto = resolveProviderPlan("XAU/USD", "4h", "auto", ENV);
    expect(auto.forced).toBe(false);
    expect(auto.cascade[0]).toBe("polygon");
    expect(resolveProviderPlan("XAU/USD", "1day", "auto", ENV).cascade[0]).toBe("twelvedata");
  });

  it("pins one provider with no silent fallback", () => {
    const plan = resolveProviderPlan("XAU/USD", "4h", "twelvedata", ENV);
    expect(plan).toMatchObject({ cascade: ["twelvedata"], forced: true });
    expect(plan.error).toBeUndefined();
  });

  it("rejects MetalPrice for intraday", () => {
    expect(providerSupports("metalpriceapi", "XAU/USD", "15min").ok).toBe(false);
    const plan = resolveProviderPlan("XAU/USD", "15min", "metalpriceapi", ENV);
    expect(plan.cascade).toEqual([]);
    expect(plan.error).toBeTruthy();
  });

  it("errors when the pinned provider is not configured", () => {
    const plan = resolveProviderPlan("XAU/USD", "4h", "polygon", {});
    expect(plan.cascade).toEqual([]);
    expect(plan.error).toContain("no está configurado");
  });
});
