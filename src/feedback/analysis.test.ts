import { describe, expect, it } from "vitest";
import { formatReport, summarizeFeedback, type ReportResponse } from "./analysis";

const response = (ratings: [number, number, number, number], extra: Partial<ReportResponse> = {}): ReportResponse => ({
  ref: "abcd1234",
  revision: 1,
  session_kind: "guest",
  device_category: "desktop",
  games_played: ["reconciliation-rush"],
  completed_rounds: 3,
  ratings: { gameplay_fun: ratings[0], ease_of_understanding: ratings[1], playability: ratings[2], replay_appeal: ratings[3] },
  enjoyed: null,
  improve: null,
  submitted_at: "2026-11-01T10:00:00Z",
  ...extra,
});

describe("feedback analysis", () => {
  it("computes means, medians and distributions per question", () => {
    const summary = summarizeFeedback([response([8, 4, 6, 10]), response([6, 6, 6, 2]), response([7, 5, 9, 6], { session_kind: "authenticated", games_played: ["pipeline-panic", "reconciliation-rush"] })], 4);
    const fun = summary.questions[0];
    expect(fun).toMatchObject({ key: "gameplay_fun", mean: 7, median: 7 });
    expect(fun.distribution).toEqual([0, 0, 0, 0, 0, 1, 1, 1, 0, 0]);
    expect(summary).toMatchObject({ respondents: 3, totalSubmissions: 4, reliability: "anecdotal", sessions: { guest: 2, authenticated: 1 } });
    expect(summary.games).toEqual({ "reconciliation-rush": 3, "pipeline-panic": 1 });
  });

  it("labels sample sizes honestly", () => {
    expect(summarizeFeedback(Array.from({ length: 12 }, () => response([5, 5, 5, 5]))).reliability).toBe("indicative");
    expect(summarizeFeedback(Array.from({ length: 30 }, () => response([5, 5, 5, 5]))).reliability).toBe("usable");
    expect(summarizeFeedback([])).toMatchObject({ respondents: 0, questions: [{ mean: null, median: null }, {}, {}, {}] });
  });

  it("prints comments with their context and a small-sample warning", () => {
    const text = formatReport(summarizeFeedback([response([9, 9, 9, 9], { enjoyed: "The\nsatire", improve: "More games" })]), [
      response([9, 9, 9, 9], { enjoyed: "The\nsatire", improve: "More games" }),
    ]);
    expect(text).toContain("Fewer than 10 respondents");
    expect(text).toContain("Enjoyed: The satire");
    expect(text).toContain("Improve: More games");
  });
});
