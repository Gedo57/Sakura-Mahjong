import { mockApi } from '../mocks/mockApi.js';
import { getFromApi, postToApi } from './api.js';
import { isMockApiEnabled } from './api.js';

const ECONOMY_BASE = '/economy';

export const DEFAULT_DAILY_REWARD_SCHEDULE = [
  { day: 1, coins: 300, diamonds: 0, chest: null },
  { day: 2, coins: 0, diamonds: 5, chest: null },
  { day: 3, coins: 500, diamonds: 0, chest: null },
  { day: 4, coins: 500, diamonds: 0, chest: null },
  { day: 5, coins: 0, diamonds: 10, chest: null },
  { day: 6, coins: 0, diamonds: 0, chest: 'chest_bronze' },
  { day: 7, coins: 1000, diamonds: 0, chest: null },
];

function asObject(value) {
  return value && typeof value === 'object' ? value : {};
}

function unwrapPayload(response) {
  const safeResponse = asObject(response);

  if (safeResponse.data && typeof safeResponse.data === 'object') {
    return safeResponse.data;
  }

  return safeResponse;
}

function normalizeNumber(value, fallback = 0) {
  const numericValue = Number(value);
  return Number.isFinite(numericValue) ? numericValue : fallback;
}

function unwrapBalances(response) {
  const payload = unwrapPayload(response);
  const balances = asObject(
    payload.balance
      || payload.balances
      || payload.wallet
      || payload.currency
      || payload,
  );

  return {
    coins: normalizeNumber(balances.coins),
    diamonds: normalizeNumber(balances.diamonds ?? balances.gems),
  };
}

function unwrapTransactions(response) {
  const payload = unwrapPayload(response);
  const transactions = payload.transactions || payload.ledger || payload.history || [];
  return Array.isArray(transactions) ? transactions : [];
}

function unwrapValidateTransaction(response) {
  const payload = unwrapPayload(response);
  const validation = asObject(payload.validation || payload.result || payload);
  const isValid = validation.valid ?? validation.canAfford ?? validation.allowed ?? validation.isValid;

  return {
    ...payload,
    validation,
    success: Boolean(payload.success ?? true),
    canAfford: Boolean(isValid),
    valid: Boolean(isValid),
    current: normalizeNumber(validation.current ?? validation.balance ?? payload.current, 0),
    required: normalizeNumber(validation.required ?? validation.requiredAmount ?? payload.required, 0),
    message: validation.message || payload.message || null,
    balances: payload.balances ? unwrapBalances(payload) : null,
  };
}

function normalizeReward(reward = {}) {
  const safeReward = asObject(reward);

  return {
    ...safeReward,
    coins: normalizeNumber(safeReward.coins ?? safeReward.coinsAdded, 0),
    diamonds: normalizeNumber(safeReward.diamonds ?? safeReward.gems ?? safeReward.diamondsAdded, 0),
    chest: safeReward.chest ?? safeReward.chestGiven ?? safeReward.chestId ?? null,
  };
}

function normalizeDailyRewardSchedule(payload = {}) {
  const safePayload = asObject(payload);
  const schedule = safePayload.rewardSchedule
    || safePayload.schedule
    || safePayload.dailyRewards
    || safePayload.rewardsSchedule
    || safePayload.rewards
    || DEFAULT_DAILY_REWARD_SCHEDULE;

  if (!Array.isArray(schedule)) {
    return DEFAULT_DAILY_REWARD_SCHEDULE;
  }

  return schedule.map((reward, index) => ({
    day: normalizeNumber(reward?.day ?? index + 1, index + 1),
    ...normalizeReward(reward),
  }));
}

function unwrapDailyRewardStatus(response) {
  const payload = unwrapPayload(response);
  const eligibility = asObject(payload.eligibility || payload.dailyRewardEligibility);
  const streakInfo = asObject(payload.streakInfo || payload.streak);
  const currentStreak = normalizeNumber(
    streakInfo.current
      ?? streakInfo.currentStreak
      ?? payload.currentStreak
      ?? payload.streak
      ?? eligibility.currentStreak,
    1,
  );
  const claimableDay = normalizeNumber(
    eligibility.claimableDay
      ?? streakInfo.claimableDay
      ?? payload.claimableDay
      ?? currentStreak,
    currentStreak,
  );
  const nextReward = normalizeReward(
    eligibility.todayReward
      || streakInfo.todayReward
      || payload.todayReward
      || payload.nextReward
      || {},
  );

  return {
    ...payload,
    currentStreak,
    claimableDay,
    longestStreak: normalizeNumber(streakInfo.longest ?? streakInfo.longestStreak ?? payload.longestStreak, 0),
    totalLoginDays: normalizeNumber(streakInfo.totalLoginDays ?? payload.totalLoginDays, 0),
    canClaimToday: Boolean(eligibility.canClaim ?? payload.canClaimToday ?? payload.canClaim),
    todayReward: nextReward,
    nextReward,
    rewardSchedule: normalizeDailyRewardSchedule({ ...payload, ...streakInfo, ...eligibility }),
    lastClaimedDate: eligibility.lastClaimedDate || streakInfo.lastClaimedDate || payload.lastClaimedDate || null,
    nextClaimTime: eligibility.nextClaimTime || payload.nextClaimTime || null,
    recentClaims: payload.recentClaims || streakInfo.recentClaims || [],
  };
}

function unwrapClaimDailyReward(response) {
  const payload = unwrapPayload(response);
  const streak = asObject(payload.streak);
  const rewards = asObject(payload.rewards || payload.reward);

  return {
    ...payload,
    success: Boolean(payload.success ?? true),
    claimableDay: normalizeNumber(payload.claimableDay ?? rewards.day ?? streak.current, 1),
    streak: {
      ...streak,
      current: normalizeNumber(streak.current ?? payload.currentStreak ?? payload.newStreak, 1),
    },
    rewards: {
      ...rewards,
      day: normalizeNumber(rewards.day ?? payload.claimableDay, 1),
      coinsAdded: normalizeNumber(rewards.coinsAdded ?? rewards.coins, 0),
      diamondsAdded: normalizeNumber(rewards.diamondsAdded ?? rewards.diamonds ?? rewards.gems, 0),
      chestGiven: rewards.chestGiven ?? rewards.chest ?? rewards.chestId ?? null,
      chestResult: rewards.chestResult ?? null,
    },
    rewardSchedule: normalizeDailyRewardSchedule(payload),
    balances: payload.balances || null,
  };
}

function unwrapStreakInfo(response) {
  const payload = unwrapPayload(response);
  const streakDays = payload.streakDays || payload.days || payload.history || [];

  return {
    ...payload,
    streakDays: Array.isArray(streakDays) ? streakDays : [],
  };
}

function unwrapChests(response) {
  const payload = unwrapPayload(response);
  const chests = payload.chests || payload.items || [];
  return Array.isArray(chests) ? chests : [];
}

function unwrapOpenChest(response) {
  const payload = unwrapPayload(response);
  const rewards = payload.rewards || payload.items || [];

  return {
    ...payload,
    success: Boolean(payload.success ?? true),
    rewards: Array.isArray(rewards) ? rewards : [],
  };
}

export async function getBalances() {
  if (isMockApiEnabled()) {
    const response = await mockApi.getBalances();
    return unwrapBalances(response);
  }

  const response = await getFromApi(`${ECONOMY_BASE}/balance`);
  return unwrapBalances(response);
}

export async function getTransactionHistory() {
  if (isMockApiEnabled()) {
    const response = await mockApi.getTransactionHistory();
    return unwrapTransactions(response);
  }

  const response = await getFromApi(`${ECONOMY_BASE}/transactions`);
  return unwrapTransactions(response);
}

export async function validateTransaction({ amount, requiredAmount, currencyType } = {}) {
  const normalizedAmount = normalizeNumber(requiredAmount ?? amount, 0);
  const payload = {
    requiredAmount: normalizedAmount,
    amount: normalizedAmount,
    currencyType: currencyType || 'coins',
  };

  if (isMockApiEnabled()) {
    const response = await mockApi.validateTransaction(payload);
    return unwrapValidateTransaction(response);
  }

  const response = await postToApi(`${ECONOMY_BASE}/validate-transaction`, payload);
  return unwrapValidateTransaction(response);
}

export async function getDailyRewardStatus() {
  if (isMockApiEnabled()) {
    const response = await mockApi.getDailyRewardStatus();
    return unwrapDailyRewardStatus(response);
  }

  const response = await getFromApi(`${ECONOMY_BASE}/daily-rewards`);
  return unwrapDailyRewardStatus(response);
}

export async function claimDailyReward() {
  if (isMockApiEnabled()) {
    const response = await mockApi.claimDailyReward();
    return unwrapClaimDailyReward(response);
  }

  const response = await postToApi(`${ECONOMY_BASE}/daily-rewards/claim`);
  return unwrapClaimDailyReward(response);
}

export async function getStreakInfo() {
  if (isMockApiEnabled()) {
    const response = await mockApi.getStreakInfo();
    return unwrapStreakInfo(response);
  }

  const response = await getFromApi(`${ECONOMY_BASE}/streak`);
  return unwrapStreakInfo(response);
}

export async function getAllChests() {
  if (isMockApiEnabled()) {
    const response = await mockApi.getAllChests();
    return unwrapChests(response);
  }

  const response = await getFromApi(`${ECONOMY_BASE}/chests`);
  return unwrapChests(response);
}

export async function openChest(chestId) {
  if (!chestId) {
    throw new Error('chestId is required to open a chest.');
  }

  const payload = { chestId };

  if (isMockApiEnabled()) {
    const response = await mockApi.openChest(payload);
    return unwrapOpenChest(response);
  }

  const response = await postToApi(`${ECONOMY_BASE}/chests/open`, payload);
  return unwrapOpenChest(response);
}
