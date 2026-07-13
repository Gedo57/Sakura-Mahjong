import { apiRequest } from './api.js';
import { normalizeRoomList, normalizeRoom, normalizeRoomTierList, normalizePrivateRoom } from './gameNormalizers.js';

export async function getRoomTiers() {
  // Room tiers must always come from the real backend. Do not fall back to mock room cards.
  const response = await apiRequest('/rooms/tiers');
  return normalizeRoomTierList(response);
}

export async function getFeaturedRooms() {
  // The current API reference only exposes GET /rooms/tiers.
  // Main menu cards are tier cards, so this must use the real backend endpoint.
  return getRoomTiers();
}

export async function getRooms() {
  return getPublicRooms();
}

function normalizePublicRoom(room = {}) {
  const entryFee = room.entryFee || { amount: room.entryFeeAmount || 0, currency: room.currency || 'coins' };
  const roomCode = room.roomCode || room.code || '';
  const roomId = room.roomId || room.id || roomCode;

  return {
    ...room,
    id: roomId,
    roomId,
    code: roomCode,
    roomCode,
    name: room.roomName || room.name || room.tierName || 'Sakura Room',
    roomName: room.roomName || room.name || room.tierName || 'Sakura Room',
    tierName: room.tierName || room.name || room.tierId || '',
    players: room.players || [],
    playerCount: Number(room.playerCount ?? room.playersCount ?? room.players?.length ?? 0) || 0,
    playersCount: Number(room.playersCount ?? room.playerCount ?? room.players?.length ?? 0) || 0,
    maxPlayers: Number(room.maxPlayers || 3) || 3,
    status: room.status || 'waiting',
    visibility: room.visibility || 'public',
    entryFee,
    entryFeeAmount: entryFee.amount ?? room.entryFeeAmount ?? 0,
    currency: entryFee.currency || room.currency || 'coins',
    prizePool: room.prizePool ?? 0,
  };
}

export async function getPublicRooms() {
  const response = await apiRequest('/rooms/public');
  const rawRooms = response?.rooms || response?.data?.rooms || response || [];
  return Array.isArray(rawRooms) ? rawRooms.map(normalizePublicRoom) : [];
}

export async function createPrivateRoom(payload = {}) {
  const tierId = payload.tierId || payload.roomId;
  if (!tierId) {
    throw new Error('tierId is required to create a private room.');
  }

  const enableBots = Boolean(
    payload.enableBots
    || payload.botsEnabled
    || payload.mode === 'solo'
    || payload.type === 'solo'
  );

  const visibility = String(payload.visibility || payload.roomVisibility || payload.type || payload.mode || 'private').toLowerCase() === 'public'
    ? 'public'
    : 'private';

  const requestPayload = {
    tierId,
    maxPlayers: 3,
    roomName: payload.roomName || payload.name || '',
    visibility: enableBots ? 'private' : visibility,
    roomVisibility: enableBots ? 'private' : visibility,
    enableBots,
    botsEnabled: enableBots,
    mode: enableBots ? 'solo' : visibility,
    type: enableBots ? 'solo' : visibility,
  };

  const response = await apiRequest('/rooms/private', {
    method: 'POST',
    body: JSON.stringify(requestPayload),
  });
  return normalizePrivateRoom(response, requestPayload);
}

export async function createRoom(payload = {}) {
  return createPrivateRoom(payload);
}

export async function joinPublicQueue(tierId) {
  if (!tierId) {
    throw new Error('tierId is required to join a public queue.');
  }

  const response = await apiRequest('/rooms/join', {
    method: 'POST',
    body: JSON.stringify({ tierId }),
  });

  return {
    ...response,
    tierId,
    status: response?.status || 'searching',
    socketMode: true,
  };
}

export async function leavePublicQueue(tierId) {
  const response = await apiRequest('/rooms/leave', {
    method: 'POST',
    body: JSON.stringify(tierId ? { tierId } : {}),
  });

  return response;
}

export async function joinRoom(roomIdOrCode) {
  if (!roomIdOrCode) {
    throw new Error('Room id or room code is required.');
  }

  const value = String(roomIdOrCode).trim();

  // Private room joining is intentionally socket-first. The backend exposes
  // room:join { roomCode } over Socket.io, not a REST /rooms/private/join route.
  return normalizePrivateRoom({
    roomId: value,
    roomCode: value,
    status: 'pending_socket_join',
    socketMode: true,
  });
}

export async function joinRoomByCode(roomCode) {
  if (!roomCode) {
    throw new Error('Room code is required.');
  }

  return joinRoom(roomCode);
}
