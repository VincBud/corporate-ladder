import { describe, expect, it } from "vitest";
import { onLaunchIntent, requestLaunchIntent, takeLaunchIntent } from "./launch-intent";

const tick = () => new Promise((resolve) => setTimeout(resolve, 0));

describe("launch intents", () => {
  it("delivers an intent requested before the app mounted, once", async () => {
    requestLaunchIntent("spreadsheet-wars", "briefing");
    const seen: string[] = [];
    const stop = onLaunchIntent("spreadsheet-wars", (intent) => {
      seen.push(intent);
      takeLaunchIntent("spreadsheet-wars");
    });
    await tick();
    expect(seen).toEqual(["briefing"]);
    expect(takeLaunchIntent("spreadsheet-wars")).toBeNull();
    stop();
  });

  it("delivers intents requested while the app is open, and only to that app", async () => {
    const rush: string[] = [];
    const sales: string[] = [];
    const stopRush = onLaunchIntent("spreadsheet-wars", (i) => {
      rush.push(i);
      takeLaunchIntent("spreadsheet-wars");
    });
    const stopSales = onLaunchIntent("pipeline-panic", (i) => sales.push(i));
    await tick();
    requestLaunchIntent("spreadsheet-wars", "briefing");
    expect(rush).toEqual(["briefing"]);
    expect(sales).toEqual([]);
    stopRush();
    stopSales();
  });

  it("keeps the intent for later when no app takes it", async () => {
    requestLaunchIntent("spreadsheet-wars", "briefing");
    const stop = onLaunchIntent("spreadsheet-wars", () => {
      // e.g. auth still loading: not taken
    });
    await tick();
    stop();
    expect(takeLaunchIntent("spreadsheet-wars")).toBe("briefing");
  });
});
