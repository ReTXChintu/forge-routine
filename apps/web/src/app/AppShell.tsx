import { NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';

import { CommandPalette } from '~/components/CommandPalette';
import { DownloadApkButton } from '~/components/DownloadApk';
import { Icon } from '~/components/Icon';
import { tokenStore } from '~/lib/api';
import { useOverview } from '~/lib/queries';

/**
 * Application chrome: sidebar, topbar, full-width content.
 *
 * The content area is `flex:1` with padding and **no max width**. Screens
 * fill the viewport and get their density from grids and side-by-side
 * panels, not from a narrow centred column with empty gutters — which is
 * what this replaced, and what was wrong on every screen.
 */

const NAV = [
  { to: '/', label: 'Dashboard', icon: 'home', end: true },
  { to: '/today', label: 'My Routine', icon: 'routine' },
  { to: '/roadmap', label: 'Learn', icon: 'learn' },
  { to: '/engineering', label: 'Practice', icon: 'practice' },
  { to: '/interview', label: 'Interviews', icon: 'interview' },
  { to: '/technologies', label: 'Technologies', icon: 'tech' },
  { to: '/progress', label: 'Progress', icon: 'progress' },
  { to: '/settings', label: 'Settings', icon: 'settings' },
];

/**
 * Routes that own their whole viewport.
 *
 * An editor, a terminal or a live interview is a full-height layout with its
 * own internal panels and scrolling. Wrapping one in the content area's
 * padding gives it a border of dead space and breaks `height: 100%`, so
 * those routes render flush.
 */
const FULL_BLEED = [/^\/exercise\//, /^\/project\//, /^\/challenge\//, /^\/interview\/[^/]+$/];

export function AppShell() {
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const { data: overview } = useOverview();

  const fullBleed = FULL_BLEED.some((pattern) => pattern.test(pathname));

  const signOut = () => {
    tokenStore.clear();
    navigate('/login', { replace: true });
  };

  return (
    <div className="app-shell">
      <CommandPalette />

      <aside className="app-sidebar">
        <div className="app-brand">
          <div className="mark">F</div>
          <span style={{ fontWeight: 800, fontSize: 14 }}>ForgeRoutine</span>
        </div>

        <div className="col g1">
          {NAV.map((item) => (
            <NavLink key={item.to} to={item.to} end={item.end}>
              {({ isActive }) => (
                <div className={`app-nav-item ${isActive ? 'active' : ''}`}>
                  <Icon name={item.icon} size={17} />
                  <span>{item.label}</span>
                </div>
              )}
            </NavLink>
          ))}
        </div>

        <div style={{ flex: 1 }} />

        <div className="app-nav-item" role="button" tabIndex={0} onClick={signOut}>
          <Icon name="logout" size={17} />
          <span>Sign out</span>
        </div>
      </aside>

      <div className="app-main">
        <Topbar overview={overview} />
        <div className={`app-content ${fullBleed ? 'no-pad' : ''}`}>
          <Outlet />
        </div>
      </div>
    </div>
  );
}

function Topbar({
  overview,
}: {
  overview:
    { greeting?: string; todayMinutesDone?: number; todayMinutesTarget?: number } | undefined;
}) {
  const initial = (overview?.greeting ?? '').replace(/[^A-Za-z]/g, '').charAt(0) || 'F';

  return (
    <header className="app-topbar">
      <button
        type="button"
        className="searchbar-trigger"
        onClick={() => window.dispatchEvent(new CustomEvent('forge:open-command-palette'))}
      >
        <Icon name="search" size={14} />
        <span style={{ flex: 1, textAlign: 'left' }}>Search or jump to…</span>
        <span className="kbd">⌘K</span>
      </button>

      <div className="row items-center g3">
        {overview && (overview.todayMinutesTarget ?? 0) > 0 && (
          <div className="streak-pill">
            <Icon name="clock" size={13} />
            {overview.todayMinutesDone ?? 0}/{overview.todayMinutesTarget} min
          </div>
        )}

        <DownloadApkButton />

        <div className="avatar">{initial.toUpperCase()}</div>
      </div>
    </header>
  );
}
