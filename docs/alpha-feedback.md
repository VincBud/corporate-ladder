# Closed Alpha Feedback v0.1

The **Employee Experience Survey**: optional, about a minute, private product research for the closed alpha (5–10 testers).

Code: `src/feedback/` (survey definitions, validation, prompt rules, browser state, report aggregation), `src/server/feedback/service.ts`, `src/app/api/feedback/`, `src/desktop/components/feedback-survey.tsx`, `scripts/feedback-report.mts`, migration `20261101160000_alpha_feedback.sql`.

## The survey

"Your opinion has been requested by management. Voluntarily, of course."

**Four 1–10 ratings:**

| Rating | Asks |
|---|---|
| Gameplay Fun | was it actually fun |
| Ease of Understanding | did you know what to do |
| Playability | did controls, speed or layout get in the way |
| Replay Appeal | would you play another round |

**Optional comments:** "What did you enjoy most?" and "What should we improve?", up to 1,000 characters each.

**Design:**
- **No biased default:** sliders start *unrated*. The thumb rests dimmed at the midpoint, the value reads "–", and screen readers hear "Not rated yet". Submit stays disabled until all four are rated.
- **Controls:** keyboard (arrows, Home, End, Tab; Escape = Not now) and touch.
- **Modal:** Tab stays inside, and the dialog scrolls on small screens.
- **Reduced motion:** no entrance animation.
- **Buttons:** Submit feedback, Not now, and a close button.

## When it appears

**Trigger:** after the **third completed round**, with both games counted together.
- Submitted and timed-out rounds count; abandoned rounds are never recorded, so they don't.
- The count comes from the active career's records: distinct session ids, either guest practice or verified history.
- Players who already have more than three rounds are asked once.

**Never on top of:**
- a running round, a briefing, the results or the review (game apps report these via `setInFlow`)
- the Employee Orientation
- itself, in another tab

It waits for the next safe moment: back in the lobby, or with the game window closed. While it's open, toasts and the department prompt wait.

**Prompt rules:**

| Situation | What happens |
|---|---|
| First time eligible | Opens automatically. Counts as shown the moment it opens, so a refresh or a second tab doesn't prompt again |
| Dismissed (Not now, close, Escape) | One gentle reminder after **2 more** completed rounds |
| Dismissed a second time | Never automatically again |
| Submitted | Never automatically again (accounts: on any device, checked with the server) |
| Any time | Launcher → People & Culture → **Employee Experience Survey** (disabled during a round) |

**Correcting answers:**
- Reopening after a submission says that submitting again replaces the earlier answers.
- The server stores it as a new revision; reports use each respondent's latest.

## Submission

`POST /api/feedback` (8 KB body limit) with `{ requestId, ratings, enjoyed?, improve?, context, guestToken? }`.

- **One response per opened survey:** the client generates one `requestId`. Retries, double clicks and concurrent duplicates return the same response (`status: "duplicate"`).
- **Validated twice:**
  - in TypeScript (whole numbers 1–10, text ≤ 1,000 characters with control characters removed, known games and device categories only)
  - again by database constraints
- **Failures are honest:** the dialog says "Not saved", keeps the answers and offers **Try again** with the same request id. It never claims success without the server's receipt.
- **No rewards:** no XP, achievements or contribution, and nothing appears in company data or rankings.

### Guests and accounts

| | Accounts | Guests |
|---|---|---|
| Respondent | `user:<id>` | `guest:<sha256(random browser token)>`. The token is created on first submission and is never stored on the server |
| Games and rounds | Computed from verified results in the database (client values ignored) | Reported by the browser (untrusted, validated ranges) |
| "Already answered" | Server-backed (`GET /api/feedback/status`) | This browser only |
| Limits | 10 requests/min, 20 revisions | 5 requests per 10 min per network address (hashed in memory, never stored), 5 revisions per token, 60 guest submissions per hour in total |

**Guest deduplication is weak by nature:** clearing storage creates a new token. Client-side suppression only reduces repeat prompts; it is not strong deduplication.

### Stored data (and nothing else)

- **Stored:** the ratings and comments; games played; completed rounds; guest or account; survey version; time; broad device category.
- **Device category:** derived only from screen width and pointer type (`mobile` under 640 px; `tablet` for touch under 1,200 px; otherwise `desktop`). No user agent and no fingerprint.
- **Never stored:** email, IP address, location, puzzle answers.

## Database and security

`feedback_responses`:

| Property | Detail |
|---|---|
| Access | No grants and no policies. No API role can read or write it, **including the service role** |
| Integrity | Append-only (trigger, also for the owner) |
| Constraints | Check constraints on every field; `request_id` unique; `(respondent, version, revision)` unique |
| Deletion | Removed with the account (cascade) |

**Service-role functions:** `submit_feedback`, `get_feedback_status`, `get_feedback_report`, `delete_feedback_responses` (erasure of one respondent, on request; also used for test cleanup).

The privilege allowlist test includes them.

## Reading the feedback

```sh
npm run feedback:report            # summary, distributions, comments
npm run feedback:report -- --json  # raw export
```

- **Access:** the script uses the service role key in `.env.local`, which is the access control. There is no public dashboard.
- **What it shows:**
  - respondents and total submissions
  - mean, median and distribution for each question
  - session types, devices, games played, median rounds
  - every comment with its context
  - a short anonymous reference per respondent (no user ids or keys)
- **Sample size:** the report prints a reliability label.

| Respondents | Label | Meaning |
|---|---|---|
| < 10 | anecdotal | Read the comments; don't compare averages |
| 10–29 | indicative | Differences under ~1.5 points are noise |
| 30+ | usable | Large differences are meaningful; small ones may still be noise |

With 5–10 testers, the comments and the extremes (1–3 and 9–10) are the actionable part. Averages are not.

## Limitations

- **Guest counts are trusted:** guest round counts and games come from the browser. Account counts are verified.
- **Rate limits:** the per-address limit is in memory, per server instance. The database cap is global but coarse.
- **Dismissals and multiple tabs:** dismissals are remembered per browser. A prompt opened in two tabs at the same instant could appear twice. Neither creates duplicate responses.
- **Guests on other devices:** a guest who answered, then plays on another device as a guest, may be asked again.
