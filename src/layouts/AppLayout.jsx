import { Outlet, useLocation } from 'react-router-dom';
import { ROUTES } from '../router/routes.js';
import { useResolutionScale } from '../hooks/useResolutionScale.js';

const routeBackgrounds = {
  [ROUTES.start]: '/assets/start-screen/bg.png',
  [ROUTES.login]: '/assets/mock-login/BG.png',
  [ROUTES.loading]: '/assets/loading-screen/BG.png',
  [ROUTES.mainMenu]: '/assets/main-menu/bg.png',
  [ROUTES.leaderboard]: '/assets/main-menu/bg.png',
  [ROUTES.profile]: '/assets/profile/BG.png',
  [ROUTES.achievements]: '/assets/profile/BG.png',
  [ROUTES.matchmaking]: '/assets/matchmaking/BG.png',
  [ROUTES.game]: '/assets/gameplay/BG.png',
  [ROUTES.result]: '/assets/win-screen/BG.png',
};

function getBackgroundForPath(pathname) {
  if (pathname.startsWith('/game/') || pathname === ROUTES.mockGame || pathname === ROUTES.gameplayMock || pathname === ROUTES.mockGameCompact) {
    return routeBackgrounds[ROUTES.game];
  }

  return routeBackgrounds[pathname] || routeBackgrounds[ROUTES.mainMenu];
}

export default function AppLayout() {
  const location = useLocation();
  const {
    scale,
    width,
    height,
    device,
    physicalDevice,
    orientation,
    viewport,
    keyboardOpen,
  } = useResolutionScale();
  const backgroundImage = getBackgroundForPath(location.pathname);

  return (
    <main
      className="app-shell fixed-resolution-shell"
      data-device={device}
      data-physical-device={physicalDevice}
      data-orientation={orientation}
      data-keyboard-open={keyboardOpen ? 'true' : 'false'}
      style={{
        '--frame-scale': scale,
        '--ui-scale': scale,
        '--design-width': `${width}px`,
        '--design-height': `${height}px`,
        '--scaled-width': `${width * scale}px`,
        '--scaled-height': `${height * scale}px`,
        '--app-viewport-width': `${viewport.width}px`,
        '--app-viewport-height': `${viewport.height}px`,
      }}
    >
      <div
        className="app-background"
        style={{ backgroundImage: `url(${backgroundImage})` }}
        aria-hidden="true"
      />
      <section className="rotate-device-overlay" aria-hidden="true">
        <div className="rotate-device-card">
          <div className="rotate-device-icon" aria-hidden="true">
            <span className="rotate-device-phone" />
            <span className="rotate-device-arrow">↻</span>
          </div>
          <h1 className="rotate-device-title">Rotate your device</h1>
          <p className="rotate-device-copy">This game supports portrait and landscape mode.</p>
        </div>
      </section>
      <div className="game-frame">
        <div className="game-stage">
          <Outlet />
        </div>
      </div>
    </main>
  );
}
