/**
 * Aggregates the developer feedback report (latest revision per respondent).
 * Self-contained (no path aliases) so scripts/feedback-report.ts can run it with Node directly.
 */

export const RATING_KEYS = ["gameplay_fun", "ease_of_understanding", "playability", "replay_appeal"] as const;
export type ReportRatingKey = (typeof RATING_KEYS)[number];

export interface ReportResponse {
  ref: string;
  revision: number;
  session_kind: "guest" | "authenticated";
  device_category: string;
  games_played: string[];
  completed_rounds: number;
  ratings: Record<ReportRatingKey, number>;
  enjoyed: string | null;
  improve: string | null;
  submitted_at: string;
}

export interface QuestionSummary {
  key: ReportRatingKey;
  mean: number | null;
  median: number | null;
  /** Count per rating 1..10 (index 0 = rating 1). */
  distribution: number[];
}

export interface FeedbackSummary {
  respondents: number;
  totalSubmissions: number;
  /** Below this many respondents, numbers are anecdotes, not findings. */
  reliability: "anecdotal" | "indicative" | "usable";
  questions: QuestionSummary[];
  sessions: Record<string, number>;
  devices: Record<string, number>;
  games: Record<string, number>;
  roundsMedian: number | null;
}

const median = (values: number[]): number | null => {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
};

const tally = (values: string[]) => values.reduce<Record<string, number>>((acc, v) => ((acc[v] = (acc[v] ?? 0) + 1), acc), {});

export function summarizeFeedback(responses: readonly ReportResponse[], totalSubmissions = responses.length): FeedbackSummary {
  const n = responses.length;
  return {
    respondents: n,
    totalSubmissions,
    reliability: n < 10 ? "anecdotal" : n < 30 ? "indicative" : "usable",
    questions: RATING_KEYS.map((key) => {
      const values = responses.map((r) => r.ratings[key]);
      const distribution = Array.from({ length: 10 }, (_, i) => values.filter((v) => v === i + 1).length);
      return {
        key,
        mean: n ? Math.round((values.reduce((a, b) => a + b, 0) / n) * 10) / 10 : null,
        median: median(values),
        distribution,
      };
    }),
    sessions: tally(responses.map((r) => r.session_kind)),
    devices: tally(responses.map((r) => r.device_category)),
    games: tally(responses.flatMap((r) => (r.games_played.length ? r.games_played : ["(none)"]))),
    roundsMedian: median(responses.map((r) => r.completed_rounds)),
  };
}

const LABELS: Record<ReportRatingKey, string> = {
  gameplay_fun: "Gameplay Fun",
  ease_of_understanding: "Ease of Understanding",
  playability: "Playability",
  replay_appeal: "Replay Appeal",
};

/** Plain-text report for the terminal. */
export function formatReport(summary: FeedbackSummary, responses: readonly ReportResponse[]): string {
  const lines: string[] = [];
  lines.push(`Employee Experience Survey — ${summary.respondents} respondents (${summary.totalSubmissions} submissions incl. revisions)`);
  lines.push(
    summary.reliability === "anecdotal"
      ? "⚠ Fewer than 10 respondents: treat every number as an anecdote. Read the comments; don't compare averages."
      : summary.reliability === "indicative"
        ? "⚠ 10–29 respondents: indicative only. Differences under ~1.5 points are noise."
        : "30+ respondents: large differences are meaningful; small ones may still be noise.",
  );
  lines.push("");
  for (const q of summary.questions) {
    const bars = q.distribution.map((c, i) => `${i + 1}:${"█".repeat(c)}${c ? ` ${c}` : ""}`).filter((s) => !s.endsWith(":")).join("  ");
    lines.push(`${LABELS[q.key].padEnd(22)} mean ${q.mean ?? "–"}  median ${q.median ?? "–"}   ${bars || "(no answers)"}`);
  }
  lines.push("");
  lines.push(`Sessions: ${JSON.stringify(summary.sessions)}   Devices: ${JSON.stringify(summary.devices)}`);
  lines.push(`Games played: ${JSON.stringify(summary.games)}   Median completed rounds: ${summary.roundsMedian ?? "–"}`);
  lines.push("");
  lines.push("Comments");
  for (const r of responses) {
    if (!r.enjoyed && !r.improve) continue;
    lines.push(`— [${r.ref}] ${r.session_kind}, ${r.completed_rounds} rounds, ${r.games_played.join(" + ") || "no games"}, ${r.device_category}`);
    if (r.enjoyed) lines.push(`  Enjoyed: ${r.enjoyed.replace(/\s+/g, " ")}`);
    if (r.improve) lines.push(`  Improve: ${r.improve.replace(/\s+/g, " ")}`);
  }
  return lines.join("\n");
}
