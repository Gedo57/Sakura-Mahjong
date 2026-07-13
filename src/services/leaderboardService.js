import { getFromApi } from './api.js';

function unwrapPayload(response) {
  return response?.data && typeof response.data === 'object' ? response.data : (response || {});
}

export async function getGlobalLeaderboard() {
  const response = await getFromApi('/leaderboards/global', (mockApi) => mockApi.getGlobalLeaderboard?.() ?? { success: true, leaderboard: [] });
  const payload = unwrapPayload(response);
  return Array.isArray(payload.leaderboard) ? payload.leaderboard : [];
}

export async function getMyRank() {
  const response = await getFromApi('/leaderboards/me', (mockApi) => mockApi.getMyRank?.() ?? { success: true, rank: null, trophies: 0 });
  return unwrapPayload(response);
}
