import { apiRequest } from './api.js';
import { normalizeGameResult, normalizeGameState } from './gameNormalizers.js';
import { getActiveGameSocket } from './socket.js';

export const MISSING_GAME_API_MESSAGE = 'Gameplay is controlled by the live socket backend. No mock gameplay data is used.';

export function isGameApiAvailable() {
  // Gameplay must not use the frontend mock API. The board is driven by Socket.io events:
  // game:start, game:turn_start, player:drawn_tile, game:claim_window,
  // game:action_broadcast, game:sync_state, game:over.
  return false;
}

export async function getGameState(matchId) {
  if (!matchId) {
    throw new Error('getGameState requires a matchId.');
  }

  const response = await apiRequest(`/games/${encodeURIComponent(matchId)}`);
  return normalizeGameState(response);
}

export async function getGameResult(matchId) {
  if (!matchId) {
    throw new Error('getGameResult requires a matchId.');
  }

  const response = await apiRequest(`/games/${encodeURIComponent(matchId)}/result`);
  return normalizeGameResult(response);
}

export function sendGameAction(matchId, action) {
  if (!matchId) {
    throw new Error('sendGameAction requires a matchId.');
  }

  return apiRequest(`/games/${encodeURIComponent(matchId)}/actions`, {
    method: 'POST',
    body: JSON.stringify(action ?? {}),
  });
}

function normalizeLeavePayload(session) {
  if (!session) return {};
  if (typeof session === 'string') return { matchId: session, roomId: session };

  const matchId = session.matchId || session.gameId || session.roomId || session.id || null;
  const roomId = session.roomId || session.matchId || session.gameId || session.id || null;

  return {
    ...session,
    ...(matchId ? { matchId } : {}),
    ...(roomId ? { roomId } : {}),
  };
}

export function leaveGame(session) {
  const payload = normalizeLeavePayload(session);
  const socket = getActiveGameSocket();

  if (!(socket?.connected || socket?.raw?.connected)) {
    return Promise.resolve({ success: false, skipped: true, reason: 'No active gameplay socket.' });
  }

  // Tell the backend first, then the page will disconnect the socket and clear the local session.
  // Keep a few fallback event names so older backend builds can still clean up the player from
  // an active room / queue without the frontend having to make gameplay decisions locally.
  socket.emit?.('player:leave', payload);

  if (payload.roomId || payload.roomCode) {
    socket.emit?.('room:leave', payload);
  }

  if (payload.tierId || payload.queueId || payload.sessionId) {
    socket.emit?.('room:leave_queue', payload);
    socket.emit?.('matchmaking:cancel', payload);
  }

  return new Promise((resolve) => {
    window.setTimeout(() => resolve({ success: true, socket: true }), 150);
  });
}

export function finishGame(matchId, payload) {
  if (!matchId) {
    throw new Error('finishGame requires a matchId.');
  }

  return apiRequest(`/games/${encodeURIComponent(matchId)}/finish`, {
    method: 'POST',
    body: JSON.stringify(payload ?? {}),
  });
}
