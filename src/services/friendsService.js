import { apiRequest } from './api.js';

function unwrapPayload(response) {
  if (response?.data && typeof response.data === 'object') {
    return response.data;
  }
  return response && typeof response === 'object' ? response : {};
}

function nestedData(payload) {
  return payload?.data && typeof payload.data === 'object' ? payload.data : {};
}

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function firstArray(...values) {
  return values.find(Array.isArray) || [];
}

function buildQueryPath(basePath, params = {}) {
  const query = new URLSearchParams();

  Object.entries(params).forEach(([key, value]) => {
    if (value !== undefined && value !== null && String(value).trim() !== '') {
      query.set(key, String(value).trim());
    }
  });

  const queryString = query.toString();
  return queryString ? `${basePath}?${queryString}` : basePath;
}

async function get(path) {
  return apiRequest(path);
}

async function post(path, body) {
  return apiRequest(path, {
    method: 'POST',
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

export function getApiErrorMessage(error, fallback = 'API request failed') {
  if (!error) return fallback;
  if (typeof error === 'string') return error;

  const data = error.response?.data || error.data;

  if (typeof data === 'string' && data.trim()) return data;
  if (data && typeof data === 'object') {
    return data.message || data.error || data.detail || JSON.stringify(data);
  }

  return error.message || fallback;
}

export async function searchFriendUsers(query) {
  const searchQuery = String(query || '').trim();

  if (!searchQuery) {
    return [];
  }

  const payload = unwrapPayload(await get(buildQueryPath('/friends/search', { q: searchQuery })));
  const data = nestedData(payload);
  return firstArray(
    payload.results,
    payload.users,
    payload.friends,
    payload.items,
    data.results,
    data.users,
    data.friends,
    data.items,
  );
}

export async function sendFriendRequest(targetUserId) {
  if (!targetUserId) {
    throw new Error('targetUserId is required to send a friend request.');
  }

  return post('/friends/request', { targetUserId });
}

export async function acceptFriendRequest(requestId) {
  if (!requestId) {
    throw new Error('requestId is required to accept a friend request.');
  }

  // The API document says /friends/accept expects { requestId },
  // but one live backend build returned "friendshipId is required".
  // Sending both keeps the frontend compatible with both contracts.
  return post('/friends/accept', { requestId, friendshipId: requestId });
}

export async function declineFriendRequest(requestId) {
  if (!requestId) {
    throw new Error('requestId is required to decline a friend request.');
  }

  return post('/friends/decline', { requestId, friendshipId: requestId });
}

export async function getFriends() {
  const payload = unwrapPayload(await get('/friends'));
  const data = nestedData(payload);
  return firstArray(payload.friends, payload.items, payload.users, data.friends, data.items, data.users);
}

export async function getIncomingFriendRequests() {
  const payload = unwrapPayload(await get('/friends/requests'));
  const data = nestedData(payload);
  return firstArray(
    payload.requests,
    payload.items,
    payload.friendRequests,
    payload.incomingRequests,
    payload.receivedRequests,
    payload.pendingRequests,
    data.requests,
    data.items,
    data.friendRequests,
    data.incomingRequests,
    data.receivedRequests,
    data.pendingRequests,
  );
}

export async function getSentFriendRequests() {
  const payload = unwrapPayload(await get('/friends/requests/sent'));
  const data = nestedData(payload);
  return firstArray(payload.requests, payload.items, payload.sentRequests, data.requests, data.items, data.sentRequests);
}

export async function removeFriend(friendId) {
  if (!friendId) {
    throw new Error('friendId is required to remove a friend.');
  }

  return post('/friends/remove', { friendId });
}

export async function blockUser(targetUserId) {
  if (!targetUserId) {
    throw new Error('targetUserId is required to block a user.');
  }

  return post('/friends/block', { targetUserId });
}

export async function unblockUser(targetUserId) {
  if (!targetUserId) {
    throw new Error('targetUserId is required to unblock a user.');
  }

  return post('/friends/unblock', { targetUserId });
}

export async function getBulkFriendStatus(userIds = []) {
  const cleanUserIds = asArray(userIds).map((id) => String(id || '').trim()).filter(Boolean);

  if (!cleanUserIds.length) {
    return {};
  }

  const payload = unwrapPayload(await post('/friends/status', { userIds: cleanUserIds }));
  const data = nestedData(payload);
  return payload.statuses || data.statuses || {};
}

export async function getOnlineUsers() {
  const payload = unwrapPayload(await get('/friends/online/users'));
  const data = nestedData(payload);
  return firstArray(payload.users, payload.friends, payload.items, data.users, data.friends, data.items);
}

export async function getOnlineCount() {
  const payload = unwrapPayload(await get('/friends/online/count'));
  const data = nestedData(payload);
  return Number(payload.count ?? payload.onlineCount ?? data.count ?? data.onlineCount ?? 0) || 0;
}

export async function getFriendSuggestions() {
  const payload = unwrapPayload(await get('/friends/suggestions'));
  const data = nestedData(payload);
  return firstArray(payload.suggestions, payload.users, payload.items, data.suggestions, data.users, data.items);
}

export async function createInviteCode() {
  return post('/friends/invite-codes/create');
}

export async function getInviteCodes() {
  const payload = unwrapPayload(await get('/friends/invite-codes'));
  const data = nestedData(payload);
  return firstArray(payload.codes, payload.inviteCodes, payload.items, data.codes, data.inviteCodes, data.items);
}

export async function redeemInviteCode(code) {
  if (!code) {
    throw new Error('code is required to redeem an invite code.');
  }

  return post('/friends/invite-codes/redeem', { code });
}

export async function validateInviteCode(code) {
  if (!code) {
    throw new Error('code is required to validate an invite code.');
  }

  const payload = unwrapPayload(await post('/friends/invite-codes/validate', { code }));
  const data = nestedData(payload);
  return Boolean(payload.isValid ?? payload.valid ?? data.isValid ?? data.valid ?? payload.success);
}

export async function getReferralStats() {
  const payload = unwrapPayload(await get('/friends/invite-codes/stats'));
  const data = nestedData(payload);
  return {
    totalReferred: Number(payload.totalReferred ?? data.totalReferred ?? 0) || 0,
    rewardsEarned: Number(payload.rewardsEarned ?? data.rewardsEarned ?? 0) || 0,
    raw: payload,
  };
}

export async function disableInviteCode(codeId) {
  if (!codeId) {
    throw new Error('codeId is required to disable an invite code.');
  }

  return post('/friends/invite-codes/disable', { codeId });
}
