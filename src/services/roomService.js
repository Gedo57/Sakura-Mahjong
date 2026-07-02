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
  // The current API reference only exposes GET /rooms/tiers.
  // Room list UI should use real backend tiers until a public rooms endpoint exists.
  return getRoomTiers();
}

export async function createPrivateRoom(payload = {}) {
  const tierId = payload.tierId || payload.roomId;
  if (!tierId) {
    throw new Error('tierId is required to create a private room.');
  }

  const requestPayload = {
    tierId,
    maxPlayers: 3,
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
