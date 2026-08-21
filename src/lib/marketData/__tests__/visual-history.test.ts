import { afterEach, describe, expect, it, vi } from "vitest";
import { fetchTwelveDataHistory } from "../twelvedata.server";

const MIN = 60;

function page(oldestUnix: number, count: number) {
  // Twelve Data returns newest-first.
  return {
    values: Array.from({ length: count }, (_, i) => {
      const t = (oldestUnix + (count - 1 - i) * 60 * MIN) * 1000;
      return {
        datetime: new Date(t).toISOString().slice(0, 19).replace("T", " "),
        open: "1",
        high: "2",
        low: "0.5",
        close: "1.5",
      };
    }),
  };
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe("fetchTwelveDataHistory (visual-only paging)", () => {
  it("pages backwards with end_date and returns a deduped ascending series", async () => {
    vi.stubEnv("TWELVEDATA_API_KEY", "test-key");
    const urls: string[] = [];
    const base = Math.floor(Date.UTC(2026, 0, 1) / 1000);
    let call = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        urls.push(url);
        const body = call++ === 0 ? page(base + 100 * 60 * MIN, 100) : page(base, 100);
        return { headers: new Headers(), json: async () => body } as unknown as Response;
      }),
    );

    const res = await fetchTwelveDataHistory({
      symbol: "XAU/USD",
      interval: "1h",
      target: 200,
    });

    expect(res.pages).toBe(2);
    expect(res.candles).toHaveLength(200);
    expect(res.candles.every((c, i, a) => i === 0 || a[i - 1].time < c.time)).toBe(true);
    expect(urls[0]).not.toContain("end_date");
    expect(urls[1]).toContain("end_date");
  });

  it("stops as soon as a page adds nothing new", async () => {
    vi.stubEnv("TWELVEDATA_API_KEY", "test-key");
    const base = Math.floor(Date.UTC(2026, 0, 1) / 1000);
    const fetchMock = vi.fn(
      async () => ({ headers: new Headers(), json: async () => page(base, 50) }) as unknown as Response,
    );
    vi.stubGlobal("fetch", fetchMock);

    const res = await fetchTwelveDataHistory({ symbol: "XAU/USD", interval: "1h", target: 5000 });
    expect(res.candles).toHaveLength(50);
    expect(fetchMock.mock.calls.length).toBeLessThanOrEqual(2);
  });
});
