import { getFromApi, postToApi } from './api.js';

export async function getSeasonInfo() {
  return getFromApi('/pass/season', (mockApi) => mockApi.getSeasonInfo?.() ?? { success: true, userProgress: { currentTier: 0 }, tiers: [] });
}

export async function claimFreeTier(tier) {
  if (tier === undefined || tier === null) {
    throw new Error('tier is required to claim a free pass reward.');
  }

  return postToApi(`/pass/season/claim-free/${encodeURIComponent(tier)}`, undefined, (mockApi) => mockApi.claimFreeTier?.(tier) ?? { success: true });
}

export async function claimPremiumTier(tier) {
  if (tier === undefined || tier === null) {
    throw new Error('tier is required to claim a premium pass reward.');
  }

  return postToApi(`/pass/season/claim-premium/${encodeURIComponent(tier)}`, undefined, (mockApi) => mockApi.claimPremiumTier?.(tier) ?? { success: true });
}

export async function upgradeToPremium() {
  return postToApi('/pass/season/upgrade', undefined, (mockApi) => mockApi.upgradeToPremium?.() ?? { success: true });
}
