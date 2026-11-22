/**
 * Step-by-step guide for building the "Send to Pilot" Shortcut. Kept in sync
 * with docs/APPLE_HEALTH.md. One search per type (Shortcuts allows only one
 * type per search) collected into one list, one loop, one line template; the
 * server recognises Apple Health's own type names and ignores what it doesn't use.
 */

const TYPES = ['Sleep', 'Heart Rate Variability', 'Resting Heart Rate', 'Mindful Minutes', 'Exercise Minutes'];

export function ShortcutGuide() {
  return (
    <div className="guide small">
      <p className="muted">
        About 15 minutes, once. You’ll build one Shortcut called <strong>Send to Pilot</strong>: five searches feeding one list and one
        loop, then set it to run automatically. Names in <em>italics</em> are variables you insert by tapping; the <code>|</code> characters are typed as they are.
      </p>

      <h3 className="section-title">Build the Shortcut</h3>
      <ol className="guide-steps">
        <li>
          Open <strong>Shortcuts</strong> → <strong>+</strong> → name it <strong>Send to Pilot</strong>.
        </li>
        <li>
          Add <strong>Find Health Samples</strong>, where <strong>All</strong> of the following are true: <strong>Type is</strong>{' '}
          <em>Sleep</em> and <strong>Start Date is in the last 2 days</strong>. (Each search can only look for one type.)
        </li>
        <li>
          Right after it: <strong>Add to Variable</strong> → variable name <strong>Samples</strong>.
        </li>
        <li>
          Repeat steps 2–3 for each of the other types: one search plus <strong>Add to Variable → Samples</strong> each time:
          <ul className="guide-type-list">
            {TYPES.slice(1).map((t) => (
              <li key={t}>{t}</li>
            ))}
          </ul>
        </li>
        <li>
          Add <strong>Repeat with Each</strong> and tap its input to choose the <strong>Samples</strong> variable.
        </li>
        <li>
          Inside the repeat, add a <strong>Text</strong> action containing:
          <code className="guide-line">Type | Start Date | End Date | Value</code>
          Each word is a detail of the <em>Repeat Item</em>: insert <em>Repeat Item</em>, tap it and choose the detail (Type, Start Date…).
        </li>
        <li>
          <strong>Dates must be ISO 8601.</strong> Tap the inserted <em>Start Date</em> → <em>Date Format</em> → <strong>ISO 8601</strong> (turn
          on <em>Include ISO 8601 Time</em> if shown). Same for <em>End Date</em>.
        </li>
        <li>
          Still inside the repeat, after the Text: <strong>Add to Variable</strong> → variable name <strong>Lines</strong>.
        </li>
        <li>
          After the repeat: <strong>Combine Text</strong> → <em>Lines</em> → separator <strong>New Lines</strong>.
        </li>
        <li>
          <strong>Get Contents of URL</strong> → URL: the web address on this screen → <em>Show More</em> → Method <strong>POST</strong>.
        </li>
        <li>
          Headers → <strong>Add new header</strong> → key <code>Authorization</code> → value <code>Bearer </code> followed by your key (one space
          after Bearer).
        </li>
        <li>
          Request Body <strong>JSON</strong> → <strong>Add new field</strong> → Text → key <code>lines</code> → value: the{' '}
          <em>Combined Text</em>.
        </li>
        <li>
          Add <strong>Show Result</strong> at the end while testing, then tap ▶︎. You should see something like “Pilot received 2 workouts, 1
          sleep session, 6 HRV readings…”. If anything was skipped, it says which line and why.
        </li>
      </ol>
      <p className="faint">
        Workouts arrive as <strong>Exercise</strong> sessions built from Exercise Minutes. They catch every Apple Watch workout (and brisk
        activity), but Health doesn’t share the workout’s name this way. You can change an item’s kind in Check In. Adding other types to the
        search won’t break anything: Pilot ignores what it doesn’t use. Avoid very frequent ones like Heart Rate or Steps, which make the
        Shortcut slow.
      </p>

      <h3 className="section-title">Make it automatic</h3>
      <ol className="guide-steps">
        <li>
          Shortcuts → <strong>Automation</strong> → <strong>+</strong> → <strong>Apple Watch Workout</strong> → <em>Ends</em> → any workout →{' '}
          <strong>Run Immediately</strong> → <em>Send to Pilot</em>.
        </li>
        <li>
          <strong>Time of Day</strong> → e.g. <strong>9:30</strong>, Daily → Run Immediately → <em>Send to Pilot</em>. This brings in last
          night’s sleep for morning check-ins.
        </li>
        <li>
          <strong>Time of Day</strong> → e.g. <strong>21:30</strong>, Daily → Run Immediately → <em>Send to Pilot</em>. This catches mindful
          sessions and the rest of the day.
        </li>
        <li>Once it works, remove Show Result (or swap it for Show Notification).</li>
      </ol>
      <p className="faint">
        iPhone keeps Health data locked while the phone is locked, so a run at a locked moment may send nothing; the next run catches up.
        Re-sending the same readings is harmless.
      </p>
    </div>
  );
}
