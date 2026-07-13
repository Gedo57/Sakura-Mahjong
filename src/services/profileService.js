import { apiRequest, isMockApiEnabled } from './api.js';

function normalizeProfileResponse(response) {
  return response?.profile || response?.user || response?.data?.profile || response?.data?.user || response;
}

function assertRealProfileApi() {
  if (isMockApiEnabled()) {
    throw new Error('Profile is unavailable right now. Please try again later.');
  }
}

export async function getProfile() {
  assertRealProfileApi();
  const response = await apiRequest('/auth/profile');
  return normalizeProfileResponse(response);
}

export async function updateProfile(payload) {
  assertRealProfileApi();
  const response = await apiRequest('/auth/profile', {
    method: 'PATCH',
    body: JSON.stringify(payload ?? {}),
  });
  return normalizeProfileResponse(response);
}

export async function getPublicProfile(userId) {
  assertRealProfileApi();
  const response = await apiRequest(`/auth/profile/${encodeURIComponent(userId)}`);
  return normalizeProfileResponse(response);
}

function formatPercent(value) {
  if (typeof value === 'string') {
    return value.includes('%') ? value : `${value}%`;
  }

  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return '';
  }

  const percent = value <= 1 ? value * 100 : value;
  return `${Number(percent.toFixed(1))}%`;
}

export function normalizeProfileStats(profile) {
  if (Array.isArray(profile?.stats)) {
    return profile.stats.filter((stat) => stat && stat.label !== undefined && stat.value !== undefined);
  }

  if (Array.isArray(profile?.statistics)) {
    return profile.statistics.filter((stat) => stat && stat.label !== undefined && stat.value !== undefined);
  }

  const source = profile?.stats || profile?.statistics || profile?.lifetimeStats || profile?.lifetime || {};

  if (source && typeof source === 'object') {
    const totalGames = source.totalGames ?? source.gamesPlayed ?? source.matchesPlayed ?? source.total_matches;
    const winRate = source.winRate ?? source.win_rate ?? source.winPercentage ?? source.win_percentage;
    const mvp = source.mvp ?? source.mvpCount ?? source.totalMvp ?? source.mvp_count;
    const stats = [];

    if (totalGames !== undefined && totalGames !== null) {
      stats.push({ label: 'Total Games', value: totalGames });
    }

    if (winRate !== undefined && winRate !== null) {
      stats.push({ label: 'Win Rate', value: formatPercent(winRate) });
    }

    if (mvp !== undefined && mvp !== null) {
      stats.push({ label: 'MVP', value: mvp });
    }

    return stats;
  }

  return [];
}
