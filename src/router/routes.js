export const ROUTES = {
  start: '/',
  login: '/login',
  loading: '/loading',
  mainMenu: '/main-menu',
  leaderboard: '/leaderboard',
  missions: '/missions',
  matchHistory: '/profile/history',
  achievements: '/achievements',
  profile: '/profile',
  rooms: '/rooms',
  createRoom: '/create-room',
  joinRoom: '/join-room',
  privateLobby: '/private-lobby',
  matchmaking: '/matchmaking',
  game: '/game/:matchId',
  gameFallback: '/game',
  mockGame: '/mock-game',
  gameplayMock: '/gameplay-mock',
  mockGameCompact: '/mockgame',
  result: '/result',
};

export function buildGameRoute(matchId) {
  const safeMatchId = matchId || 'mock_match_001';
  return `/game/${encodeURIComponent(safeMatchId)}`;
}
