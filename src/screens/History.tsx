import { useMemo, useState } from 'react';
import { useSearchParams } from 'react-router';
import { useCheckIns, usePendingIds, usePeriods } from '../data/hooks';
import { filterCheckIns, usedTags, type HistoryFilter } from '../lib/filter';
import { DayGroups } from '../components/DayGroups';

const PAGE = 150;

export function History() {
  const checkIns = useCheckIns();
  const periods = usePeriods();
  const pending = usePendingIds();
  const [params, setParams] = useSearchParams();
  const [limit, setLimit] = useState(PAGE);

  const filter: HistoryFilter = {
    q: params.get('q') ?? undefined,
    from: params.get('from') ?? undefined,
    to: params.get('to') ?? undefined,
    periodId: params.get('period') ?? undefined,
    tag: params.get('tag') ?? undefined,
  };
  const activeFilters = ['from', 'to', 'period', 'tag'].filter((k) => params.get(k)).length;
  const [showFilters, setShowFilters] = useState(activeFilters > 0);

  // Functional update: rapid changes (e.g. clear search, then pick a tag) must
  // build on the latest filters, not on the ones from the previous render.
  const setParam = (k: string, v: string) =>
    setParams(
      (prev) => {
        const next = new URLSearchParams(prev);
        if (v) next.set(k, v);
        else next.delete(k);
        return next;
      },
      { replace: true },
    );

  const results = useMemo(() => filterCheckIns(checkIns ?? [], filter, periods), [checkIns, periods, params]); // eslint-disable-line react-hooks/exhaustive-deps
  const tags = useMemo(() => usedTags(checkIns ?? []), [checkIns]);
  const filtered = Boolean(filter.q) || activeFilters > 0;

  return (
    <main className="page">
      <div className="page-head">
        <h1>History</h1>
      </div>

      <div className="row">
        <input
          className="search"
          type="search"
          placeholder="Search thoughts and tags"
          aria-label="Search"
          value={filter.q ?? ''}
          onChange={(e) => setParam('q', e.target.value)}
        />
        <button type="button" className="button" aria-expanded={showFilters} onClick={() => setShowFilters(!showFilters)}>
          Filter{activeFilters ? ` (${activeFilters})` : ''}
        </button>
      </div>

      {showFilters && (
        <div className="filters">
          <div className="field-row">
            <label className="field">
              <span>From</span>
              <input type="date" value={filter.from ?? ''} onChange={(e) => setParam('from', e.target.value)} />
            </label>
            <label className="field">
              <span>To</span>
              <input type="date" value={filter.to ?? ''} onChange={(e) => setParam('to', e.target.value)} />
            </label>
          </div>
          <div className="field-row">
            <label className="field">
              <span>Period</span>
              <select value={filter.periodId ?? ''} onChange={(e) => setParam('period', e.target.value)}>
                <option value="">Any</option>
                {periods.map((p) => (
                  <option key={p.id} value={p.id}>{p.title}</option>
                ))}
              </select>
            </label>
            <label className="field">
              <span>Tag</span>
              <select value={filter.tag ?? ''} onChange={(e) => setParam('tag', e.target.value)}>
                <option value="">Any</option>
                {tags.map((t) => (
                  <option key={t} value={t}>{t}</option>
                ))}
              </select>
            </label>
          </div>
          {activeFilters > 0 && (
            <button type="button" className="button quiet" onClick={() => setParams(filter.q ? { q: filter.q } : {}, { replace: true })}>
              Clear filters
            </button>
          )}
        </div>
      )}

      {checkIns === undefined ? null : checkIns.length === 0 ? (
        <p className="empty">Your check-ins will appear here.</p>
      ) : (
        <>
          {filtered && (
            <p className="faint small" style={{ marginTop: 'var(--s-3)' }} role="status">
              {results.length === 1 ? '1 check-in' : `${results.length} check-ins`}
            </p>
          )}
          {filtered && results.length === 0 && <p className="empty">Nothing matches.</p>}
          <DayGroups checkIns={results.slice(0, limit)} periods={periods} pending={pending} />
          {results.length > limit && (
            <div className="section">
              <button type="button" className="button wide" onClick={() => setLimit(limit + PAGE)}>Show earlier</button>
            </div>
          )}
        </>
      )}
    </main>
  );
}
