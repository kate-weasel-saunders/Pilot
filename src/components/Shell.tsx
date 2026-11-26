import { NavLink, Outlet } from 'react-router';

const TABS = [
  { to: '/', label: 'Today', end: true },
  { to: '/history', label: 'History' },
  { to: '/patterns', label: 'Patterns' },
  { to: '/periods', label: 'Periods' },
];

const tabClass = (extra = '') => ({ isActive }: { isActive: boolean }) => [extra, isActive ? 'active' : ''].filter(Boolean).join(' ');

export function Shell() {
  return (
    <div className="shell">
      <Outlet />
      <footer className="tabbar">
        <nav aria-label="Main">
          {TABS.map((t) => (
            <NavLink key={t.to} to={t.to} end={t.end} className={tabClass()}>
              <span>{t.label}</span>
            </NavLink>
          ))}
          <NavLink to="/settings" className={tabClass('tab-icon')} aria-label="Settings" title="Settings">
            <GearIcon />
          </NavLink>
        </nav>
      </footer>
    </div>
  );
}

function GearIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.6 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.6-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z" />
    </svg>
  );
}
