# Apple Health → Pilot

Web apps can't read Apple Health, so a Shortcut on the iPhone reads it and sends a summary to Pilot's `health` Edge Function. The same guide is in the app under **Settings → Apple Health**.

## What's sent
- **Workouts:** type, start, end (duration derived).
- **Mindful sessions:** start, end.
- **Sleep stages:** condensed by the server into one summary per sleep session. That's minutes asleep / deep / REM / core / awake / in bed, counting overlaps from several devices once.
- **HRV (SDNN, ms)** and **resting heart rate (bpm)** readings.

There are no GPS routes and no second-by-second heart rate. Each run sends the last 2 days, so re-sends are harmless (deduplicated, and a fuller night replaces a partial one).

## Line format
One reading per line, `|`-separated: `metric | start | end | value | unit | label`. Dates must be ISO 8601 with a time zone.

```
workout    | 2026-11-21T07:10:00Z | 2026-11-21T07:45:00Z |      |     | Running
mindful    | 2026-11-21T08:00:00Z | 2026-11-21T08:10:00Z
sleep      | 2026-11-20T23:10:00Z | 2026-11-21T00:40:00Z | Core
hrv        | 2026-11-21T03:00:00Z | 2026-11-21T03:01:00Z | 48.2 | ms
resting_hr | 2026-11-21T00:00:00Z | 2026-11-21T23:59:00Z | 58   | bpm
```

The body can be plain text or JSON `{"lines": "…"}`, sent with `Authorization: Bearer pilot_hk_…`. The reply is a plain-text summary, including why any line was skipped.

## Building the Shortcut ("Send to Pilot")
1. Shortcuts → **+** → name it **Send to Pilot**.
2. For each type: **Find Health Samples** (Type; *Start Date is in the last 2 days*; sort by Start Date) → **Repeat with Each** → inside: **Text** with the line below → **Add to Variable** `Lines`.
   - Heart Rate Variability: `hrv | Start Date | End Date | Value | ms`
   - Resting Heart Rate: `resting_hr | Start Date | End Date | Value | bpm`
   - Sleep Analysis: `sleep | Start Date | End Date | Value` (Value is the stage)
   - Mindful Minutes: `mindful | Start Date | End Date`
   - Workouts: `workout | Start Date | End Date | | | Type`. Use **Find Workouts** if your Shortcuts has it.
3. In every Text action, set *Start Date* and *End Date* → Date Format → **ISO 8601** (with time).
4. **Combine Text** (`Lines`, separator New Lines).
5. **Get Contents of URL**:
   - the URL from Settings → Apple Health
   - Method **POST**
   - header `Authorization: Bearer <key>`
   - Request Body **JSON** with Text field `lines` = Combined Text
6. **Show Result** while testing.

## Automations
- **Apple Watch Workout → Ends** → Run Immediately → Send to Pilot.
- **Time of Day 9:30** daily: brings in last night's sleep for morning check-ins.
- **Time of Day 21:30** daily: picks up mindful sessions and the rest of the day.

Health data is locked while the iPhone is locked. A run then may send nothing; the next run catches up.

## Keys
- **Creating and revoking:** keys are created and revoked in Settings → Apple Health. Only a SHA-256 hash is stored, the key is shown once, and each user can have up to 5.
- **Deleting data:** "Delete all imported health data" removes everything received. Check-ins keep the items already attached to them.

## Not verified
This setup hasn't been checked against a live iPhone. The guide is written from knowledge of the Shortcuts app; action names can differ between iOS versions. If the Shortcut's result says lines were skipped, the reason tells you what to fix.
