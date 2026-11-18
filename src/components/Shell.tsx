import { NavLink, Outlet } from 'react-router';

const TABS = [
  { to: '/', label: 'Today', end: true },
  { to: '/history', label: 'History' },
  { to: '/patterns', label: 'Patterns' },
  { to: '/periods', label: 'Periods' },
];

export function Shell() {
  return (
    <div className="shell">
      <Outlet />
      <footer className="tabbar">
        <nav aria-label="Main">
          {TABS.map((t) => (
            <NavLink key={t.to} to={t.to} end={t.end} className={({ isActive }) => (isActive ? 'active' : '')}>
              <span>{t.label}</span>
            </NavLink>
          ))}
        </nav>
      </footer>
    </div>
  );
}
