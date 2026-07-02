import { apiRequest } from './api.js';
import { normalizeMatchmakingSession } from './gameNormalizers.js';

export const MISSING_MATCHMAKING_API_MESSAGE = 'Matchmaking is controlled by the live Socket.io backend. Use room:join for live queue updates.';

export function isMatchmakingApiAvailable() {
  return true;
}

export async function startMatchmaking(payload = {}) {
  const tierId = payload.tierId || payload.roomId;

  if (!tierId) {
    throw new Error('tierId is required to join matchmaking.');
  }

  // Backend route: POST /api/rooms/join { tierId }
  // Socket.io still owns live updates and match start events.
  const response = await apiRequest('/rooms/join', {
    method: 'POST',
    body: JSON.stringify({ tierId }),
  });

  return normalizeMatchmakingSession({
    ...response,
    tierId,
    status: response?.status || 'searching',
    socketMode: true,
  });
}

export async function getMatchmakingStatus(sessionId) {
  if (!sessionId) {
    throw new Error('getMatchmakingStatus requires a sessionId.');
  }

  // The current backend has no polling status endpoint. A queued session is
  // updated through Socket.io events: queue_joined, match_found, game:start.
  return normalizeMatchmakingSession({
    sessionId,
    id: sessionId,
    status: 'searching',
    socketMode: true,
  });
}

export async function cancelMatchmaking(sessionIdOrTierId) {
  const tierId = sessionIdOrTierId || undefined;

  // Backend route: POST /api/rooms/leave { tierId? }
  return apiRequest('/rooms/leave', {
    method: 'POST',
    body: JSON.stringify(tierId ? { tierId } : {}),
  });
}
