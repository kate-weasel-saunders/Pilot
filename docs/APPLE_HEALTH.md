# Apple Health → Pilot

Web apps can't read Apple Health, so a Shortcut on the iPhone reads it and sends a summary to Pilot's `health` Edge Function. The same guide is in the app under **Settings → Apple Health**.

## What's sent
- **Sleep**, **Heart Rate Variability**, **Resting Heart Rate**, **Mindful Minutes** and **Exercise Minutes** readings for roughly the last 2 days.
- **Sleep:** condensed by the server into one summary per session (minutes asleep / deep / REM / core / awake / in bed), counting overlaps from several devices once. A stage-less reading counts as plain sleep.
- **Exercise Minutes:** condensed into exercise sessions (readings under 15 min apart join up). This catches every Apple Watch workout. Shortcuts' Find Health Samples has no generic "Workout" type, so workout *names* aren't available this way.
- **Other types are ignored** and mentioned in the reply, so a broader search won't break anything.
- **What's never sent:** GPS routes and second-by-second heart rate.
- **Re-sends are harmless:** duplicates collapse, and a partial session never replaces a fuller one already stored.

## Line format
One reading per line, `|`-separated: `type | start | end | value | unit`. `type` may be Apple Health's own name (`Heart Rate Variability`) or Pilot's short one (`hrv`). Dates must be ISO 8601 with a time zone.

```
Sleep                  | 2026-11-20T23:10:00Z | 2026-11-21T00:40:00Z | Core |
Heart Rate Variability | 2026-11-21T03:00:00Z | 2026-11-21T03:01:00Z | 48.2 | ms
Resting Heart Rate     | 2026-11-21T00:00:00Z | 2026-11-21T23:59:00Z | 58   | count/min
Mindful Minutes        | 2026-11-21T08:00:00Z | 2026-11-21T08:10:00Z | 10   | min
Exercise Minutes       | 2026-11-21T07:10:00Z | 2026-11-21T07:20:00Z | 10   | min
```

A `workout | start | end | | | Running` line (with a name) is also accepted, should a future Shortcuts version expose workouts.

The body can be plain text or JSON `{"lines": "…"}`, sent with `Authorization: Bearer pilot_hk_…`. The reply is a plain-text summary.

## Building the Shortcut ("Send to Pilot")
1. Shortcuts → **+** → name it **Send to Pilot**.
2. **Find Health Samples**:
   - set it to **Any** of the following are true
   - add one **Type is** row each for: Sleep, Heart Rate Variability, Resting Heart Rate, Mindful Minutes, Exercise Minutes (picked from the list, not a variable)
   - don't add a Start Date row
   - Sort by Start Date, **Newest First**, **Limit 500**
3. **Repeat with Each** → inside:
   - a **Text** action: `Type | Start Date | End Date | Value | Unit`, where each word is the Repeat Item's detail and both dates use Date Format **ISO 8601**
   - then **Add to Variable** `Lines`
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
