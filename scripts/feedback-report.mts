/**
 * Developer-only feedback report. Reads with the service role key from
 * .env.local (that key is the access control; never ship it to a browser).
 *
 *   npm run feedback:report            # summary + comments
 *   npm run feedback:report -- --json  # raw JSON export (no respondent ids)
 */
import { readFileSync } from "node:fs";
import { formatReport, summarizeFeedback, type ReportResponse } from "../src/feedback/analysis.ts";

const env = Object.fromEntries(
  readFileSync(new URL("../.env.local", import.meta.url), "utf8")
    .split("\n")
    .map((line) => /^([A-Z0-9_]+)=(.*)$/.exec(line))
    .filter((m): m is RegExpExecArray => m !== null)
    .map((m) => [m[1], m[2]]),
);
const url = env.NEXT_PUBLIC_SUPABASE_URL;
const key = env.SUPABASE_SECRET_KEY ?? env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) throw new Error("NEXT_PUBLIC_SUPABASE_URL and a service role key are required in .env.local.");

const response = await fetch(`${url}/rest/v1/rpc/get_feedback_report`, {
  method: "POST",
  headers: { apikey: key, Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
  body: JSON.stringify({ p_survey_version: "alpha-1" }),
});
if (!response.ok) throw new Error(`Report failed (${response.status}): ${await response.text()}`);
const report = (await response.json()) as { total_submissions: number; responses: ReportResponse[] };

if (process.argv.includes("--json")) {
  console.log(JSON.stringify(report, null, 2));
} else {
  console.log(formatReport(summarizeFeedback(report.responses, report.total_submissions), report.responses));
}
