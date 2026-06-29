import { getAuthToken, getBackendUrl, isMockApiEnabled } from './api.js';
import { normalizeGameState } from './gameNormalizers.js';

const DEFAULT_SOCKET_URL = getBackendUrl();
const SOCKET_URL = (import.meta.env.VITE_SOCKET_URL || import.meta.env.VITE_API_BASE_URL || DEFAULT_SOCKET_URL).replace(/\/+$/, '');
const SOCKET_DEBUG = String(import.meta.env.VITE_GAME_SOCKET_DEBUG || '').toLowerCase() === 'true';

function debugSocket(message, payload) {
  if (!SOCKET_DEBUG) return;
  if (payload !== undefined) {
    console.info(`[game-socket] ${message}`, payload);
  } else {
    console.info(`[game-socket] ${message}`);
  }
}

function getErrorMessage(error, fallback = 'Gameplay socket error.') {
  if (!error) return fallback;
  if (typeof error === 'string') return error;
  return error.message || error.error || error.reason || fallback;
}

export const GAME_SOCKET_EVENTS = {
  queueJoined: 'queue_joined',
  privateJoined: 'private_joined',
  roomStateUpdate: 'room:state_update',
  gameStart: 'game:start',
  turnStart: 'game:turn_start',
  drawnTile: 'player:drawn_tile',
  claimWindow: 'game:claim_window',
  actionBroadcast: 'game:action_broadcast',
  syncState: 'game:sync_state',
  gameOver: 'game:over',
  error: 'error',
  gameError: 'game:error',
  roomError: 'room:error',
  actionRejected: 'player:action_rejected',
};

const SERVER_EVENTS_TO_LISTEN = [
  GAME_SOCKET_EVENTS.queueJoined,
  GAME_SOCKET_EVENTS.privateJoined,
  GAME_SOCKET_EVENTS.roomStateUpdate,
  GAME_SOCKET_EVENTS.gameStart,
  GAME_SOCKET_EVENTS.turnStart,
  GAME_SOCKET_EVENTS.drawnTile,
  GAME_SOCKET_EVENTS.claimWindow,
  GAME_SOCKET_EVENTS.actionBroadcast,
  GAME_SOCKET_EVENTS.syncState,
  GAME_SOCKET_EVENTS.gameOver,
  GAME_SOCKET_EVENTS.error,
  GAME_SOCKET_EVENTS.gameError,
  GAME_SOCKET_EVENTS.roomError,
  GAME_SOCKET_EVENTS.actionRejected,
  'action:rejected',
  'player:error',
  // Legacy / fallback names kept so older backend builds do not silently break.
  'game_state',
  'gameState',
  'state:update',
  'game_state_updated',
  'gameStateUpdated',
  'turn_changed',
  'turnChanged',
  'tile_discarded',
  'tileDiscarded',
  'game_finished',
  'gameFinished',
];

let activeSocket = null;
let socketFactoryLoadPromise = null;
const RECENT_GAME_MESSAGE_TTL_MS = 30000;
const RECENT_GAME_MESSAGE_LIMIT = 60;
const recentGameMessages = [];

function rememberGameSocketMessage(message) {
  if (!message?.type) return;
  const gameplayTypes = new Set([
    'game_start',
    'game_state',
    'turn_changed',
    'drawn_tile',
    'claim_window',
    'action_broadcast',
    'tile_discarded',
    'game_finished',
    'error',
  ]);

  if (!gameplayTypes.has(message.type)) return;

  const now = Date.now();
  recentGameMessages.push({ ...message, receivedAt: now });

  while (recentGameMessages.length > RECENT_GAME_MESSAGE_LIMIT) {
    recentGameMessages.shift();
  }

  const cutoff = now - RECENT_GAME_MESSAGE_TTL_MS;
  while (recentGameMessages.length && recentGameMessages[0].receivedAt < cutoff) {
    recentGameMessages.shift();
  }
}

export function getBufferedGameSocketMessages() {
  const cutoff = Date.now() - RECENT_GAME_MESSAGE_TTL_MS;
  return recentGameMessages.filter((message) => message.receivedAt >= cutoff);
}

function addListener(listeners, eventName, callback) {
  if (!listeners.has(eventName)) listeners.set(eventName, new Set());
  listeners.get(eventName).add(callback);
}

function removeListener(listeners, eventName, callback) {
  if (!listeners.has(eventName)) return;
  if (callback) {
    listeners.get(eventName).delete(callback);
    if (!listeners.get(eventName).size) listeners.delete(eventName);
    return;
  }
  listeners.delete(eventName);
}

function forEachListener(listeners, handler) {
  listeners.forEach((callbacks, eventName) => {
    callbacks.forEach((callback) => handler(callback, eventName));
  });
}

function getSocketUrl() {
  return SOCKET_URL;
}

async function loadSocketFactory() {
  if (!socketFactoryLoadPromise) {
    socketFactoryLoadPromise = import('socket.io-client').then((module) => module.io || module.default?.io || module.default);
  }

  return socketFactoryLoadPromise;
}

function getBackendPlayerName(player = {}) {
  const value = player.username
    || player.name
    || player.displayName
    || player.nickname
    || player.email
    || player.userId
    || player.id
    || player._id
    || '';
  const normalized = String(value || '').trim();
  return /^slot[_\s-]*\d+$/i.test(normalized) || /^player\s*\d+$/i.test(normalized) ? '' : normalized;
}

function normalizeRoomPlayers(players) {
  if (!Array.isArray(players)) return players;

  return players
    .filter(Boolean)
    .map((player, index) => {
      if (typeof player === 'string') {
        return {
          id: player,
          userId: player,
          name: `Player ${index + 1}`,
          username: `Player ${index + 1}`,
          avatar: null,
          ready: true,
        };
      }

      return {
        ...player,
        id: player.id || player.userId || player._id || player.playerId || player.socketId || '',
        userId: player.userId || player.id || player._id || player.playerId || '',
        name: getBackendPlayerName(player),
        username: player.username || getBackendPlayerName(player),
        avatar: player.avatar || player.avatarUrl || player.avatarId || player.imageUrl || null,
        title: player.title || player.rankTitle || player.profileTitle || '',
        ready: player.ready ?? player.isReady ?? true,
        seat: player.seat,
        seatLabel: player.seatLabel || player.seatName || '',
        score: player.score,
        isHost: Boolean(player.isHost || player.host),
      };
    });
}

export function normalizeSocketMessage(message) {
  if (!message || typeof message !== 'object') {
    return { type: 'message', payload: message, originalEvent: 'message' };
  }

  const originalEvent = message.type || message.event || message.eventName || 'message';
  const payload = message.payload ?? message.data ?? message;

  if (
    originalEvent === GAME_SOCKET_EVENTS.syncState
    || originalEvent === 'game_state'
    || originalEvent === 'gameState'
    || originalEvent === 'state:update'
    || originalEvent === 'game_state_updated'
    || originalEvent === 'gameStateUpdated'
  ) {
    return { type: 'game_state', payload: normalizeGameState(payload), originalEvent };
  }

  if (originalEvent === GAME_SOCKET_EVENTS.gameStart) {
    return { type: 'game_start', payload: normalizeGameState(payload), originalEvent };
  }

  if (originalEvent === GAME_SOCKET_EVENTS.turnStart || originalEvent === 'turn_changed' || originalEvent === 'turnChanged') {
    return { type: 'turn_changed', payload, originalEvent };
  }

  if (originalEvent === GAME_SOCKET_EVENTS.drawnTile) {
    return { type: 'drawn_tile', payload, originalEvent };
  }

  if (originalEvent === GAME_SOCKET_EVENTS.claimWindow) {
    return { type: 'claim_window', payload, originalEvent };
  }

  if (originalEvent === GAME_SOCKET_EVENTS.actionBroadcast) {
    return { type: 'action_broadcast', payload, originalEvent };
  }

  if (originalEvent === 'tile_discarded' || originalEvent === 'tileDiscarded') {
    return { type: 'tile_discarded', payload, originalEvent };
  }

  if (originalEvent === GAME_SOCKET_EVENTS.gameOver || originalEvent === 'game_finished' || originalEvent === 'gameFinished') {
    return { type: 'game_finished', payload, originalEvent };
  }

  if (
    originalEvent === GAME_SOCKET_EVENTS.error
    || originalEvent === GAME_SOCKET_EVENTS.gameError
    || originalEvent === GAME_SOCKET_EVENTS.roomError
    || originalEvent === GAME_SOCKET_EVENTS.actionRejected
    || originalEvent === 'action:rejected'
    || originalEvent === 'player:error'
  ) {
    return { type: 'error', payload, originalEvent };
  }

  if (originalEvent === GAME_SOCKET_EVENTS.queueJoined) {
    return { type: 'queue_joined', payload, originalEvent };
  }

  if (originalEvent === GAME_SOCKET_EVENTS.privateJoined) {
    return { type: 'private_joined', payload, originalEvent };
  }

  if (originalEvent === GAME_SOCKET_EVENTS.roomStateUpdate) {
    return {
      type: 'room_state_update',
      payload: { ...payload, players: normalizeRoomPlayers(payload?.players) },
      originalEvent,
    };
  }

  return { type: originalEvent, payload, originalEvent };
}

function createMockGameSocket({ matchId, onMessage, onOpen } = {}) {
  const listeners = new Map();

  window.setTimeout(() => {
    if (onOpen) onOpen();
  }, 0);

  return {
    connected: true,
    mode: 'mock',
    matchId,
    on(eventName, callback) {
      addListener(listeners, eventName, callback);
      return this;
    },
    off(eventName) {
      removeListener(listeners, eventName);
      return this;
    },
    emit(eventName, payload = {}) {
      const message = normalizeSocketMessage({ eventName, payload, mock: true });
      const callbacks = listeners.get(eventName);

      if (callbacks?.size) {
        callbacks.forEach((callback) => window.setTimeout(() => callback(payload), 80));
      }

      if (onMessage) {
        window.setTimeout(() => onMessage(message), 80);
      }

      return true;
    },
    send(payload) {
      const message = normalizeSocketMessage(payload);
      if (onMessage) {
        window.setTimeout(() => onMessage(message), 80);
      }
    },
    disconnect() {
      listeners.clear();
    },
    raw: null,
  };
}

function emitOnActiveSocket(eventName, payload = {}) {
  if (activeSocket?.raw?.connected) {
    activeSocket.raw.emit(eventName, payload);
    return true;
  }

  if (activeSocket?.mode === 'mock' && typeof activeSocket.emit === 'function') {
    return activeSocket.emit(eventName, payload);
  }

  console.warn(`[game-socket] Cannot emit ${eventName}: socket is not connected.`);
  return false;
}

export function connectGameSocket({ matchId = null, onMessage, onOpen, onClose, onError, autoConnect = true } = {}) {
  if (isMockApiEnabled()) {
    activeSocket = createMockGameSocket({ matchId, onMessage, onOpen });
    return activeSocket;
  }

  const listeners = new Map();

  const controller = {
    connected: false,
    mode: 'socket.io',
    matchId,
    raw: null,
    closed: false,
    on(eventName, callback) {
      if (!eventName || typeof callback !== 'function') return this;

      addListener(listeners, eventName, callback);
      if (this.raw) {
        this.raw.on(eventName, callback);
      }
      return this;
    },
    off(eventName, callback) {
      if (this.raw && callback) {
        this.raw.off(eventName, callback);
      } else if (this.raw && listeners.has(eventName)) {
        listeners.get(eventName).forEach((registeredCallback) => this.raw.off(eventName, registeredCallback));
      }

      removeListener(listeners, eventName, callback);
      return this;
    },
    emit(eventName, payload = {}, ack) {
      if (!this.raw?.connected) {
        console.warn(`[game-socket] Cannot emit ${eventName}: socket is not connected.`);
        return false;
      }

      if (typeof ack === 'function') {
        this.raw.emit(eventName, payload, ack);
      } else {
        this.raw.emit(eventName, payload);
      }

      return true;
    },
    send(payload = {}) {
      const eventName = payload.eventName || payload.event || payload.type || 'message';
      const eventPayload = payload.payload ?? payload.data ?? payload;
      return this.emit(eventName, eventPayload);
    },
    connect() {
      if (this.raw && !this.raw.connected) {
        this.raw.connect();
      }
      return this;
    },
    disconnect() {
      this.closed = true;
      if (this.raw) {
        SERVER_EVENTS_TO_LISTEN.forEach((eventName) => this.raw.off(eventName));
        forEachListener(listeners, (callback, eventName) => this.raw.off(eventName, callback));
        this.raw.off('connect');
        this.raw.off('disconnect');
        this.raw.off('connect_error');
        this.raw.disconnect();
      }
      this.connected = false;
      if (activeSocket === this) {
        activeSocket = null;
      }
    },
  };

  activeSocket = controller;

  loadSocketFactory()
    .then((io) => {
      if (!io) {
        throw new Error('socket.io-client did not expose an io() factory.');
      }

      if (controller.closed) {
        return;
      }

      const token = getAuthToken();
      const socket = io(getSocketUrl(), {
        auth: token ? { token } : {},
        autoConnect: false,
        withCredentials: true,
        reconnection: true,
        reconnectionAttempts: 5,
        reconnectionDelay: 800,
        reconnectionDelayMax: 4000,
        timeout: 12000,
      });

      if (controller.closed) {
        socket.disconnect();
        return;
      }

      controller.raw = socket;

      socket.on('connect', () => {
        if (controller.closed) {
          socket.disconnect();
          return;
        }
        controller.connected = true;
        debugSocket('connected', { id: socket.id });
        if (onOpen) onOpen(socket);
      });

      socket.on('disconnect', (reason) => {
        if (controller.closed) return;
        controller.connected = false;
        debugSocket('disconnected', { reason });
        if (onClose) onClose({ reason });
      });

      socket.on('connect_error', (error) => {
        if (controller.closed) return;
        controller.connected = false;
        console.warn('[game-socket] connect_error:', getErrorMessage(error, 'Unable to connect to gameplay server.'));
        if (onError) onError(error);
      });

      socket.io?.on?.('reconnect_attempt', (attempt) => debugSocket('reconnect attempt', { attempt }));
      socket.io?.on?.('reconnect', (attempt) => debugSocket('reconnected', { attempt }));
      socket.io?.on?.('reconnect_failed', () => {
        console.warn('[game-socket] reconnect failed.');
        if (onError) onError(new Error('Unable to reconnect to gameplay server.'));
      });

      SERVER_EVENTS_TO_LISTEN.forEach((eventName) => {
        socket.on(eventName, (payload) => {
          const normalizedMessage = normalizeSocketMessage({ eventName, payload });
          rememberGameSocketMessage(normalizedMessage);
          debugSocket(`event ${eventName}`, payload);
          if (onMessage) onMessage(normalizedMessage);
        });
      });

      forEachListener(listeners, (callback, eventName) => {
        socket.on(eventName, callback);
      });

      if (autoConnect && !controller.closed) {
        socket.connect();
      }
    })
    .catch((error) => {
      console.error('[game-socket] Failed to initialize Socket.io client:', error);
      if (onError) onError(error);
    });

  return controller;
}

export function getActiveGameSocket() {
  return activeSocket;
}

export function disconnectGameSocket() {
  recentGameMessages.length = 0;

  if (activeSocket) {
    activeSocket.disconnect();
  }
}

export function joinPublicRoom(tierId) {
  if (!tierId) {
    console.warn('[game-socket] joinPublicRoom called without tierId.');
    return false;
  }

  return emitOnActiveSocket('room:join', { tierId });
}

export function joinPrivateRoom(roomCode) {
  if (!roomCode) {
    console.warn('[game-socket] joinPrivateRoom called without roomCode.');
    return false;
  }

  return emitOnActiveSocket('room:join', { roomCode });
}

export function startPrivateGame(roomId) {
  if (!roomId) {
    console.warn('[game-socket] startPrivateGame called without roomId.');
    return false;
  }

  return emitOnActiveSocket('start_private_game', { roomId });
}

export function discardTile(tileId) {
  if (!tileId) {
    console.warn('[game-socket] discardTile called without tileId.');
    return false;
  }

  return emitOnActiveSocket('player:discard', { tileId });
}

export function claimDiscard(action) {
  if (!action) {
    console.warn('[game-socket] claimDiscard called without action.');
    return false;
  }

  return emitOnActiveSocket('player:claim', { action });
}

export function passClaimWindow() {
  return emitOnActiveSocket('player:pass', {});
}

export function declareWin(type = 'tsumo') {
  return emitOnActiveSocket('player:declare_win', { type });
}

export function declareRiichi(tileId) {
  if (!tileId) {
    console.warn('[game-socket] declareRiichi called without tileId.');
    return false;
  }

  return emitOnActiveSocket('player:declare_riichi', { tileId });
}

export function leaveLobby(roomId) {
  if (!roomId) {
    console.warn('[game-socket] leaveLobby called without roomId.');
    return false;
  }

  return emitOnActiveSocket('lobby:leave', { roomId });
}
