/**
 * Step-by-step guide for building the "Send to Pilot" Shortcut. Kept in sync
 * with docs/APPLE_HEALTH.md (same steps, same line format).
 */

const TYPES: { health: string; line: string; note?: string }[] = [
  { health: 'Heart Rate Variability', line: 'hrv | Start Date | End Date | Value | ms' },
  { health: 'Resting Heart Rate', line: 'resting_hr | Start Date | End Date | Value | bpm' },
  { health: 'Sleep Analysis', line: 'sleep | Start Date | End Date | Value', note: 'Value is the sleep stage (Core, Deep, REM, Awake…).' },
  { health: 'Mindful Minutes', line: 'mindful | Start Date | End Date' },
  {
    health: 'Workouts',
    line: 'workout | Start Date | End Date | | | Type',
    note: 'If your Shortcuts app has a separate “Find Workouts” action, use that instead. “Type” is the workout type (Running, Strength…).',
  },
];

export function ShortcutGuide() {
  return (
    <div className="guide small">
      <p className="muted">
        About 15 minutes, once. You’ll build one Shortcut called <strong>Send to Pilot</strong>, then set it to run automatically. In the
        lines below, words like <em>Start Date</em> mean “insert that variable”; the <code>|</code> characters are typed as they are.
      </p>

      <h3 className="section-title">Build the Shortcut</h3>
      <ol className="guide-steps">
        <li>
          Open <strong>Shortcuts</strong> → <strong>+</strong> → name it <strong>Send to Pilot</strong>.
        </li>
        <li>
          For <strong>each</strong> health type below, add these three actions:
          <ol type="a">
            <li>
              <strong>Find Health Samples</strong> → Type: the type listed → add the filter <em>Start Date is in the last 2 days</em> → Sort by
              Start Date.
            </li>
            <li>
              <strong>Repeat with Each</strong> (it uses the samples from the step above).
            </li>
            <li>
              Inside the repeat: a <strong>Text</strong> action with the line shown, then <strong>Add to Variable</strong> → variable name{' '}
              <strong>Lines</strong>.
            </li>
          </ol>
        </li>
      </ol>
      <ul className="guide-types">
        {TYPES.map((t) => (
          <li key={t.health}>
            <strong>{t.health}</strong>
            <code className="guide-line">{t.line}</code>
            {t.note && <span className="faint">{t.note}</span>}
          </li>
        ))}
      </ul>
      <ol className="guide-steps" start={3}>
        <li>
          <strong>Dates must be ISO 8601.</strong> In each Text action, tap the inserted <em>Start Date</em> → <em>Date Format</em> → choose{' '}
          <strong>ISO 8601</strong> (and turn on <em>Include ISO 8601 Time</em> if shown). Do the same for <em>End Date</em>. Pilot can’t place
          dates like “21 Nov at 07:10”.
        </li>
        <li>
          Inside the repeat, the variables are the <em>Repeat Item</em>’s details: tap the variable and choose <em>Start Date</em>,{' '}
          <em>End Date</em>, <em>Value</em> or <em>Type</em>.
        </li>
        <li>
          After the last repeat: <strong>Combine Text</strong> → text: <em>Lines</em> → separator: <strong>New Lines</strong>.
        </li>
        <li>
          <strong>Get Contents of URL</strong> → URL: the web address from this screen → tap <em>Show More</em> → Method: <strong>POST</strong>.
        </li>
        <li>
          Headers → <strong>Add new header</strong> → key: <code>Authorization</code> → value: <code>Bearer </code> followed by your key (one
          space after Bearer).
        </li>
        <li>
          Request Body: <strong>JSON</strong> → <strong>Add new field</strong> → Text → key: <code>lines</code> → value: the{' '}
          <em>Combined Text</em>.
        </li>
        <li>
          Add <strong>Show Result</strong> at the end while testing. Tap ▶︎ to run: you should see something like “Pilot received 1 workout, 1
          sleep session, 6 HRV readings”. If lines were skipped, it says why.
        </li>
      </ol>

      <h3 className="section-title">Make it automatic</h3>
      <ol className="guide-steps">
        <li>
          Shortcuts → <strong>Automation</strong> → <strong>+</strong> → <strong>Apple Watch Workout</strong> → <em>Ends</em> → any workout →{' '}
          <strong>Run Immediately</strong> → choose <em>Send to Pilot</em>.
        </li>
        <li>
          Another automation: <strong>Time of Day</strong> → e.g. <strong>9:30</strong>, Daily → Run Immediately → <em>Send to Pilot</em>. This
          brings in last night’s sleep for your morning check-ins.
        </li>
        <li>
          One more: <strong>Time of Day</strong> → e.g. <strong>21:30</strong>, Daily → Run Immediately → <em>Send to Pilot</em>. This catches
          mindful sessions and anything else from the day.
        </li>
        <li>Once it works, you can remove the Show Result action (or swap it for Show Notification).</li>
      </ol>
      <p className="faint">
        iPhone keeps Health data locked while the phone is locked, so a run at a locked moment may send nothing. That’s fine: every run sends
        the last two days, so the next one catches up, and duplicates are ignored.
      </p>
    </div>
  );
}
