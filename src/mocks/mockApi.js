import { mockFeaturedRooms, mockRoomList, mockRoomTiers } from './mockRooms.js';

const delay = (ms = 220) => new Promise((resolve) => {
  window.setTimeout(resolve, ms);
});

const createId = (prefix) => `${prefix}_${Date.now()}`;

export const mockApi = {
  async registerUser(payload = {}) {
    await delay();
    return {
      message: 'User registered successfully',
      userId: createId('user'),
      user: {
        id: createId('user'),
        username: payload.username || payload.email || 'Player',
        name: payload.username || payload.email || 'Player',
        email: payload.email || 'player1@example.com',
      },
    };
  },

  async login(credentials = {}) {
    await delay();
    return {
      message: 'Login successful',
      accessToken: 'mock_access_token',
      refreshToken: 'mock_refresh_token',
      user: {
        id: 'mock_user',
        username: credentials.username || credentials.email || 'Player',
        name: credentials.username || credentials.email || 'Player',
        email: credentials.email || 'player1@example.com',
      },
    };
  },

  async refreshToken() {
    await delay();
    return {
      accessToken: 'mock_refreshed_access_token',
      refreshToken: 'mock_refresh_token_2',
    };
  },

  async continueAsGuest() {
    await delay();
    return {
      accessToken: 'mock_guest_access_token',
      refreshToken: 'mock_guest_refresh_token',
      user: {
        id: 'guest_player',
        username: 'Guest',
        name: 'Guest',
      },
    };
  },

  async getProfile() {
    await delay();
    throw new Error('Profile is unavailable right now. Please try again later.');
  },

  async updateProfile() {
    await delay();
    throw new Error('Profile update is unavailable right now. Please try again later.');
  },

  async getPublicProfile() {
    await delay();
    throw new Error('Public profile is unavailable right now. Please try again later.');
  },

  async getBalances() {
    await delay();
    return {
      success: true,
      balances: {
        coins: 125600,
        diamonds: 2450,
      },
    };
  },

  async getTransactionHistory() {
    await delay();
    return {
      success: true,
      transactions: [
        { id: 'txn_reward_001', type: 'reward', amount: 300, currency: 'coins', createdAt: new Date().toISOString() },
        { id: 'txn_entry_001', type: 'entry_fee', amount: -500, currency: 'coins', createdAt: new Date().toISOString() },
        { id: 'txn_chest_001', type: 'chest_reward', amount: 5, currency: 'diamonds', createdAt: new Date().toISOString() },
      ],
    };
  },

  async validateTransaction(payload = {}) {
    await delay();
    const balances = { coins: 125600, diamonds: 2450 };
    const currency = payload.currencyType || payload.currency || 'coins';
    const amount = Number(payload.amount) || 0;

    return {
      success: true,
      canAfford: (balances[currency] || 0) >= amount,
      balances,
    };
  },

  async getDailyRewardStatus() {
    await delay();
    return {
      success: true,
      currentStreak: 3,
      canClaimToday: true,
      nextReward: {
        coins: 500,
        diamonds: 0,
        chest: null,
      },
      claimableDay: 3,
      rewardSchedule: [
        { day: 1, coins: 300, diamonds: 0, chest: null },
        { day: 2, coins: 0, diamonds: 5, chest: null },
        { day: 3, coins: 500, diamonds: 0, chest: null },
        { day: 4, coins: 500, diamonds: 0, chest: null },
        { day: 5, coins: 0, diamonds: 10, chest: null },
        { day: 6, coins: 0, diamonds: 0, chest: 'chest_bronze' },
        { day: 7, coins: 1000, diamonds: 0, chest: null },
      ],
    };
  },

  async claimDailyReward() {
    await delay();
    return {
      success: true,
      streak: {
        current: 4,
      },
      claimableDay: 4,
      rewards: {
        day: 4,
        coinsAdded: 500,
        diamondsAdded: 0,
        chestGiven: null,
        chestResult: null,
      },
      balances: {
        coins: 126100,
        diamonds: 2450,
      },
    };
  },

  async getStreakInfo() {
    await delay();
    return {
      success: true,
      streakDays: [
        { date: '2026-06-13', claimed: true },
        { date: '2026-06-14', claimed: true },
        { date: '2026-06-15', claimed: true },
        { date: '2026-06-16', claimed: false },
      ],
    };
  },

  async getAllChests() {
    await delay();
    return {
      success: true,
      chests: [
        { chestId: 'basic_chest', name: 'Basic Chest', cost: 500, currencyType: 'coins' },
        { chestId: 'premium_chest', name: 'Premium Chest', cost: 50, currencyType: 'diamonds' },
      ],
    };
  },

  async openChest(payload = {}) {
    await delay();
    return {
      success: true,
      chestId: payload.chestId,
      rewards: [
        { type: 'avatar', itemName: 'Fox' },
        { type: 'currency', amount: 100, currency: 'coins' },
      ],
    };
  },



  async getMissions() {
    await delay();
    return {
      success: true,
      missions: [
        { id: 'daily_play_7_games', title: 'Play 7 Games', progress: 3, target: 7, type: 'daily', reward: { type: 'season_xp', amount: 120 } },
        { id: 'daily_win_3_games', title: 'Win 3 Games', progress: 1, target: 3, type: 'daily', reward: { type: 'season_xp', amount: 160 } },
        { id: 'daily_spend_200_coins', title: 'Spend 200 Coins', progress: 200, target: 200, type: 'daily', reward: { type: 'season_xp', amount: 100 } },
        { id: 'daily_earn_500_prize', title: 'Earn 500 Prize', progress: 260, target: 500, type: 'daily', reward: { type: 'season_xp', amount: 140 } },
        { id: 'daily_claim_daily_reward', title: 'Claim Daily Reward', progress: 1, target: 1, type: 'daily', reward: { type: 'season_xp', amount: 80 } },
        { id: 'weekly_play_35_games', title: 'Play 35 Games', progress: 12, target: 35, type: 'weekly', reward: { type: 'season_xp', amount: 600 } },
        { id: 'weekly_win_15_games', title: 'Win 15 Games', progress: 4, target: 15, type: 'weekly', reward: { type: 'season_xp', amount: 750 } },
        { id: 'weekly_spend_1500_coins', title: 'Spend 1,500 Coins', progress: 600, target: 1500, type: 'weekly', reward: { type: 'season_xp', amount: 500 } },
        { id: 'weekly_earn_5000_prize', title: 'Earn 5,000 Prize', progress: 1900, target: 5000, type: 'weekly', reward: { type: 'season_xp', amount: 650 } },
        { id: 'weekly_claim_5_daily_rewards', title: 'Claim 5 Daily Rewards', progress: 2, target: 5, type: 'weekly', reward: { type: 'season_xp', amount: 450 } },
      ],
    };
  },

  async claimMission(missionId) {
    await delay();
    return {
      success: true,
      missionId,
      reward: { type: 'season_xp', amount: 100 },
    };
  },

  async getGlobalLeaderboard() {
    await delay();
    return {
      success: true,
      leaderboard: [
        { rank: 1, username: 'SakuraKing', trophies: 5000, avatar: 'avatar-panda.png' },
        { rank: 2, username: 'BambooFox', trophies: 4620, avatar: 'avatar-kiki.png' },
        { rank: 3, username: 'DragonBun', trophies: 4310, avatar: 'avatar-bunbun.png' },
        { rank: 4, username: 'TileMaster', trophies: 3890, avatar: 'avatar-stevie.png' },
        { rank: 5, username: 'LuckyPanda', trophies: 3580, avatar: 'avatar-panda.png' },
        { rank: 6, username: 'GoldenWind', trophies: 3260, avatar: 'avatar-kiki.png' },
        { rank: 7, username: 'MoonTable', trophies: 2980, avatar: 'avatar-bunbun.png' },
        { rank: 8, username: 'RedFlower', trophies: 2640, avatar: 'avatar-stevie.png' },
      ],
    };
  },

  async getMyRank() {
    await delay();
    return {
      success: true,
      rank: 521,
      trophies: 1200,
    };
  },

  async getRoomTiers() {
    await delay();
    return { success: true, tiers: mockRoomTiers };
  },

  async getFeaturedRooms() {
    await delay();
    return mockFeaturedRooms;
  },

  async getRooms() {
    await delay();
    return mockRoomList;
  },

  async createPrivateRoom(payload) {
    await delay();
    return {
      success: true,
      roomCode: String(Math.floor(1000 + Math.random() * 9000)),
      roomId: createId('private_room'),
      ...payload,
    };
  },

  async createRoom(payload) {
    await delay();
    return {
      id: createId('room'),
      status: 'created',
      ...payload,
    };
  },

  async joinRoom(roomId) {
    await delay();
    return {
      id: roomId,
      status: 'joined',
    };
  },


};
