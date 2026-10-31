import { describe, expect, it } from "vitest";
import { CONTRIBUTION_RULES } from "../contribution";
import { DEMO_QUARTERS, DEMO_SCENARIO_IDS, generateDemoCompany, runDemoSimulation, type DemoScenarioId } from "./scenarios";

const runs = Object.fromEntries(DEMO_SCENARIO_IDS.map((id) => [id, runDemoSimulation(id)])) as Record<DemoScenarioId, ReturnType<typeof runDemoSimulation>>;
const last = (id: DemoScenarioId) => runs[id].quarters.at(-1)!;
const department = (id: DemoScenarioId, departmentId: string) => last(id).departments.find((d) => d.departmentId === departmentId)!;

describe("demo scenarios", () => {
  it("are reproducible from scenario and seed", () => {
    expect(generateDemoCompany("baseline", "A")).toEqual(generateDemoCompany("baseline", "A"));
    expect(generateDemoCompany("baseline", "A").events).not.toEqual(generateDemoCompany("baseline", "B").events);
  });

  it.each(DEMO_SCENARIO_IDS)("%s: only demo events, clearly labeled", (id) => {
    const { company, reports } = runs[id];
    expect(company.events.length).toBeGreaterThan(0);
    expect(company.events.every((e) => e.provenance === "demo" && e.eventId.startsWith("demo:") && e.playerId.startsWith("demo-"))).toBe(true);
    expect(reports).toHaveLength(DEMO_QUARTERS);
    expect(reports.every((r) => r.source === "demo")).toBe(true);
  });

  it.each(DEMO_SCENARIO_IDS)("%s: no player exceeds the per-period cap", (id) => {
    for (const period of runs[id].contributions) {
      const perPlayer = new Map<string, number>();
      for (const c of period.accepted) perPlayer.set(c.playerId, (perPlayer.get(c.playerId) ?? 0) + c.creditedPoints);
      expect(Math.max(0, ...perPlayer.values())).toBeLessThanOrEqual(CONTRIBUTION_RULES.playerHardCap);
    }
  });

  it("shows the anti-farming rules at work", () => {
    const reasons = new Set(runs.baseline.contributions.flatMap((c) => c.rejected.map((r) => r.reason)));
    expect(reasons).toEqual(new Set(["seedReplay", "duplicate"]));
  });

  it("orders outcomes as the scenarios describe", () => {
    expect(last("strong").operatingProfit).toBeGreaterThan(last("baseline").operatingProfit);
    expect(last("baseline").operatingProfit).toBeGreaterThan(last("weak").operatingProfit);
    expect(last("weak").operatingProfit).toBeLessThan(0);
    expect(last("high-participation").operatingEfficiency).toBeGreaterThan(last("low-participation").operatingEfficiency);
    expect(last("high-participation").participationRate).toBeGreaterThan(0.8);
    expect(last("low-participation").participationRate).toBeLessThan(0.15);
  });

  it("rapid growth grows headcount and revenue", () => {
    const { quarters, milestones } = runs["rapid-growth"];
    expect(quarters.at(-1)!.employeeCount).toBeGreaterThan(quarters[0].employeeCount * 1.4);
    expect(quarters.at(-1)!.revenue).toBeGreaterThan(quarters[0].revenue * 1.3);
    expect(milestones.find((m) => m.id === "headcount-600")!.reachedIn).not.toBeNull();
  });

  it("department imbalance saturates Controlling and starves Sales", () => {
    expect(department("imbalance", "controlling").status).toBe("exceeding");
    expect(department("imbalance", "sales").status).toBe("critical");
    expect(last("imbalance").balanceScore!).toBeLessThan(last("baseline").balanceScore! / 2);
    expect(last("imbalance").operatingEfficiency).toBeLessThan(last("baseline").operatingEfficiency);
  });

  it("grinders can't carry the company: few players with many rounds stay below broad participation", () => {
    const low = runs["low-participation"].contributions.at(-1)!;
    const high = runs["high-participation"].contributions.at(-1)!;
    const roundsPerActive = (c: typeof low) => c.accepted.length / Math.max(1, c.activeContributors);
    expect(roundsPerActive(low)).toBeGreaterThan(roundsPerActive(high) * 3);
    expect(high.totalCredited).toBeGreaterThan(low.totalCredited * 3);
  });
});
