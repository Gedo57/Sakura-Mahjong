import { apiRequest, isMockApiEnabled } from './api.js';

function unwrapPayload(response) {
  return response?.data && typeof response.data === 'object' ? response.data : (response || {});
}

function firstArray(...values) {
  return values.find((value) => Array.isArray(value)) || [];
}

function extractAchievements(payload) {
  if (Array.isArray(payload)) {
    return payload;
  }

  return firstArray(
    payload?.achievements,
    payload?.data?.achievements,
    payload?.user?.achievements,
    payload?.profile?.achievements,
    payload?.data?.user?.achievements,
    payload?.data?.profile?.achievements,
    payload?.items,
    payload?.data?.items,
    payload?.results,
    payload?.data?.results,
  );
}

function assertRealAchievementsApi() {
  if (isMockApiEnabled()) {
    throw new Error('Achievements are unavailable right now. Please try again later.');
  }
}

export async function getAchievements() {
  assertRealAchievementsApi();
  const response = await apiRequest('/achievements/');
  return extractAchievements(unwrapPayload(response));
}

export async function claimAchievement(achievementId) {
  const safeAchievementId = String(achievementId || '').trim();

  if (!safeAchievementId) {
    throw new Error('achievementId is required to claim an achievement.');
  }

  assertRealAchievementsApi();
  return apiRequest(`/achievements/claim/${encodeURIComponent(safeAchievementId)}`, {
    method: 'POST',
  });
}
