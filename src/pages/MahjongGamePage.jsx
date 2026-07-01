import { useEffect, useMemo, useState } from 'react';
import { useLocation, useNavigate, useParams } from 'react-router-dom';
import { ROUTES, buildGameRoute } from '../router/routes.js';
import { getStoredAuthUser } from '../services/authService.js';
import { getGameState, isGameApiAvailable, leaveGame } from '../services/gameService.js';
import { normalizeGameState } from '../services/gameNormalizers.js';
import {
  claimDiscard,
  connectGameSocket,
  declareRiichi,
  declareWin,
  discardTile,
  disconnectGameSocket,
  getActiveGameSocket,
  getBufferedGameSocketMessages,
  passClaimWindow,
} from '../services/socket.js';
import { clearActiveMatch, clearMatchmakingContext, getActiveMatch, saveActiveMatch } from '../store/gameStore.js';
import { useLanguage } from '../i18n/useLanguage.js';
import { mockGameState as fullMockGameState } from '../mocks/mockGameState.js';
import avatarBunbun from '../assets/profile/avatar-bunbun.png';
import avatarKiki from '../assets/profile/avatar-kiki.png';
import avatarPanda from '../assets/profile/avatar-panda.png';
import avatarStevie from '../assets/profile/avatar-stevie.png';

const asset = (name) => `/assets/gameplay/${name}`;

const PLAYER_AVATAR_FALLBACKS = {
  'Bunbun.png': avatarBunbun,
  'KIKI.png': avatarKiki,
  'Kiki.png': avatarKiki,
  'Stevie.png': avatarStevie,
  'STEIVE.png': avatarStevie,
  'Panda.png': avatarPanda,
};

const clampGameplayPlayerCount = (value, fallback = 3) => {
  const numberValue = Number(value);
  if (!Number.isFinite(numberValue)) return fallback;
  return Math.max(2, Math.min(numberValue, 3));
};

const getGameplayPlayerCountFromId = (value) => {
  const match = String(value || '').match(/(\d+)p/i);
  return match ? clampGameplayPlayerCount(match[1]) : null;
};

const getExpectedGameplayPlayerCount = (...sources) => {
  for (const source of sources) {
    if (!source) continue;

    const idCount = getGameplayPlayerCountFromId(source.tierId || source.roomId || source.room?.tierId || source.room?.id || source.room?.roomId || source.matchId || source.gameId);
    if (idCount) return idCount;

    const explicitCount = source.maxPlayers
      ?? source.expectedPlayers
      ?? source.playerLimit
      ?? source.capacity
      ?? source.room?.maxPlayers
      ?? source.room?.playerLimit
      ?? source.room?.capacity;

    if (explicitCount !== undefined && explicitCount !== null && explicitCount !== '') {
      return clampGameplayPlayerCount(explicitCount);
    }

    if (Array.isArray(source.players) && source.players.length >= 2 && source.players.length <= 3) {
      return clampGameplayPlayerCount(source.players.length);
    }
  }

  return 3;
};


const getGameplayCurrentIdentity = (...sources) => {
  const storedUser = getStoredAuthUser() || {};

  for (const source of sources) {
    if (!source) continue;
    const candidate = source.me || source.currentUser || source.user || source.profile || source.selfPlayer || source.currentPlayer;
    if (candidate && typeof candidate === 'object') return candidate;
  }

  return storedUser;
};

const getRealPlayerName = (player = {}) => {
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
};

const normalizeGameplayPlayer = (player = {}, index = 0) => {
  const handTiles = player.handTiles || player.hand || player.tiles || [];
  const score = player.score ?? player.points ?? player.balance ?? player.coins ?? '0';

  return {
    ...player,
    id: player.id || player.userId || player._id || player.playerId || player.uid || player.clientId || player.socketId || '',
    userId: player.userId || player.id || player._id || player.playerId || player.uid || '',
    name: getRealPlayerName(player),
    username: player.username || getRealPlayerName(player),
    avatar: player.avatar || player.avatarUrl || player.avatarId || player.imageUrl || player.photoUrl || player.icon || null,
    title: player.title || player.rankTitle || player.profileTitle || '',
    coins: score,
    score,
    seat: player.seat,
    seatLabel: player.seatLabel || player.seatName || '',
    isDealer: Boolean(player.isDealer ?? player.dealer),
    isRiichi: Boolean(player.isRiichi ?? player.riichi),
    isDisconnected: Boolean(player.isDisconnected ?? player.disconnected),
    handTiles,
    hand: player.hand || player.handTiles || [],
    handSize: player.handSize ?? player.handCount ?? player.tileCount ?? player.tilesCount ?? handTiles.length ?? 0,
    discardTiles: player.discardTiles || player.discards || player.discardPile || player.discardedTiles || [],
    discards: player.discards || player.discardTiles || player.discardPile || player.discardedTiles || [],
    openMelds: player.openMelds || player.melds || [],
  };
};

const getPrivateHandPlayer = (players = []) => (
  toArray(players).find((player) => Array.isArray(player?.hand) && player.hand.length)
  || toArray(players).find((player) => Array.isArray(player?.handTiles) && player.handTiles.length)
  || null
);

const getPrivateHandTiles = (players = []) => {
  const player = getPrivateHandPlayer(players);
  return player?.hand || player?.handTiles || player?.tiles || [];
};

const listFromSeatMap = (seatMap = {}) => (
  seatMap && typeof seatMap === 'object' && !Array.isArray(seatMap)
    ? Object.entries(seatMap).map(([seat, player]) => ({ seat, ...(player || {}) }))
    : []
);

const getPlayerProfileRichnessScore = (player = {}) => [
  player.name,
  player.username,
  player.avatar,
  player.avatarUrl,
  player.title,
  player.seat,
  player.seatLabel,
  player.score,
  player.coins,
  player.handSize,
  Array.isArray(player.hand) && player.hand.length ? 'hand' : '',
  Array.isArray(player.handTiles) && player.handTiles.length ? 'handTiles' : '',
  Array.isArray(player.discards) && player.discards.length ? 'discards' : '',
  Array.isArray(player.openMelds) && player.openMelds.length ? 'openMelds' : '',
].filter(Boolean).length;

const getPlayerMergeKey = (player = {}, fallbackIndex = 0) => String(
  player.userId
  || player.id
  || player.playerId
  || player._id
  || player.uid
  || player.socketId
  || player.seat
  || player.name
  || player.username
  || `player_${fallbackIndex}`
).trim();

const mergeGameplayPlayerLists = (basePlayers = [], nextPlayers = []) => {
  const merged = [];
  const indexes = new Map();

  [...basePlayers, ...nextPlayers].forEach((player, index) => {
    if (!player) return;
    const key = getPlayerMergeKey(player, index);
    const existingIndex = indexes.get(key);

    if (existingIndex === undefined) {
      indexes.set(key, merged.length);
      merged.push(player);
      return;
    }

    const existing = merged[existingIndex];
    const existingScore = getPlayerProfileRichnessScore(existing);
    const nextScore = getPlayerProfileRichnessScore(player);

    merged[existingIndex] = nextScore >= existingScore
      ? { ...existing, ...player }
      : { ...player, ...existing };
  });

  return merged;
};

const collectGameplayPlayers = (...sources) => {
  let bestPlayers = [];

  for (const source of sources) {
    if (!source) continue;
    const candidateLists = [
      source.players,
      source.playerStates,
      source.room?.players,
      source.initialGameState?.players,
      source.gameState?.players,
      listFromSeatMap(source.seats),
      listFromSeatMap(source.playersBySeat),
      listFromSeatMap(source.room?.seats),
      listFromSeatMap(source.gameState?.seats),
    ];

    for (const list of candidateLists) {
      if (!Array.isArray(list) || !list.length) continue;

      const players = list
        .filter((player) => player && typeof player === 'object')
        .map(normalizeGameplayPlayer)
        .filter((player) => !isGameplayPlaceholderPlayer(player));

      if (!players.length) continue;
      bestPlayers = mergeGameplayPlayerLists(bestPlayers, players);
    }
  }

  return bestPlayers;
};

const seatPlayersForGameplay = (sourcePlayers, expectedPlayerCount = 3, currentIds = [], currentSeat = '') => {
  const allowedPositions = expectedPlayerCount <= 2 ? ['left', 'top'] : ['left', 'top', 'right'];
  const normalizedPlayers = toArray(sourcePlayers)
    .filter(Boolean)
    .map(normalizeGameplayPlayer)
    .slice(0, expectedPlayerCount);

  if (!normalizedPlayers.length) return [];

  const playersWithPosition = normalizedPlayers.map((player, index) => {
    const requestedPosition = normalizePosition(player.position);
    const seatPosition = player.seat && currentSeat
      ? getRelativeSeatPosition(player.seat, currentSeat, expectedPlayerCount)
      : '';
    const isCurrent = player.isCurrentPlayer || player.isMe || player.isSelf || playerMatchesAnyId(player, currentIds);

    return {
      ...player,
      position: isCurrent ? 'left' : (requestedPosition || seatPosition || ''),
    };
  });

  // Find the true local player first, ignoring the default 'left' string which might be misassigned
  let currentIndex = playersWithPosition.findIndex((player) => player.isCurrentPlayer || player.isMe || player.isSelf || playerMatchesAnyId(player, currentIds));
  
  // If not found, fallback to 'left'
  if (currentIndex === -1) {
    currentIndex = playersWithPosition.findIndex((player) => player.position === 'left');
  }

  if (currentIndex > 0) {
    const [currentPlayer] = playersWithPosition.splice(currentIndex, 1);
    playersWithPosition.unshift({ ...currentPlayer, position: 'left' });
  } else if (currentIndex === 0) {
    playersWithPosition[0] = { ...playersWithPosition[0], position: 'left' };
  }

  const usedPositions = new Set();
  return playersWithPosition.map((player, index) => {
    let position = normalizePosition(player.position);

    if (!position || usedPositions.has(position) || !allowedPositions.includes(position)) {
      position = allowedPositions.find((candidate) => !usedPositions.has(candidate)) || allowedPositions[index] || 'top';
    }

    usedPositions.add(position);
    return { ...player, position };
  });
};

function resolvePlayerAvatar(avatar, fallbackAvatar = 'Stevie.png') {
  const value = String(avatar || '').trim();

  if (!value || /^default(\.png)?$/i.test(value)) {
    return PLAYER_AVATAR_FALLBACKS[fallbackAvatar] || avatarStevie;
  }

  if (/^(https?:|data:|blob:|\/)/i.test(value)) {
    return value;
  }

  if (PLAYER_AVATAR_FALLBACKS[value]) {
    return PLAYER_AVATAR_FALLBACKS[value];
  }

  const profileAvatarMap = {
    stevie: avatarStevie,
    'avatar-stevie.png': avatarStevie,
    kiki: avatarKiki,
    'avatar-kiki.png': avatarKiki,
    bunbun: avatarBunbun,
    'avatar-bunbun.png': avatarBunbun,
    panda: avatarPanda,
    'avatar-panda.png': avatarPanda,
    ico: avatarStevie,
    'ico.png': avatarStevie,
  };
  const lowerValue = value.toLowerCase();

  return profileAvatarMap[lowerValue]
    || PLAYER_AVATAR_FALLBACKS[fallbackAvatar]
    || avatarStevie;
}

const DEFAULT_ACTIONS = ['chow', 'pong', 'kong', 'pass'];
const ACTION_TO_UI = {
  pung: 'pong',
  pon: 'pong',
  pong: 'pong',
  chi: 'chow',
  chow: 'chow',
  kan: 'kong',
  kong: 'kong',
  ron: 'ron',
  win: 'ron',
  tsumo: 'tsumo',
  riichi: 'riichi',
  pass: 'pass',
};
const CLAIM_ACTION_ALIASES = {
  pong: 'pung',
  pung: 'pung',
  pon: 'pung',
  chow: 'chow',
  chi: 'chow',
  kong: 'kong',
  kan: 'kong',
  ron: 'ron',
  win: 'ron',
};
const normalizeActionForUi = (action) => ACTION_TO_UI[String(action || '').toLowerCase()] || String(action || '').toLowerCase();
const EMPTY_SOCKET_GAME_STATE = {
  status: 'waiting',
  players: [],
  handTiles: [],
  myHand: [],
  discards: {},
  centerTiles: [],
  availableActions: [],
  claimWindow: null,
  timer: 0,
  room: { name: 'Live Match' },
};
const toArray = (value) => (Array.isArray(value) ? value : []);
const MAX_TABLE_DISCARD_TILES = 7;

const getCircularTableTiles = (tiles = [], maxTiles = MAX_TABLE_DISCARD_TILES) => {
  const list = toArray(tiles).filter(Boolean);
  const max = Number(maxTiles) || MAX_TABLE_DISCARD_TILES;

  if (list.length <= max) return list;

  const slots = list.slice(0, max);
  for (let index = max; index < list.length; index += 1) {
    slots[index % max] = list[index];
  }

  return slots.filter(Boolean);
};

const isGameplayPlaceholderPlayer = (player = {}) => {
  const id = String(player.id || player.userId || player.playerId || '').trim().toLowerCase();
  const name = String(player.name || player.username || player.displayName || '').trim().toLowerCase();
  const avatar = String(player.avatar || player.avatarUrl || player.avatarId || '').trim().toLowerCase();

  return Boolean(player.isSearching)
    || id.startsWith('searching_')
    || /^slot_\d+$/i.test(id)
    || /^slot\s*\d+$/i.test(name)
    || /^player\s*\d+$/i.test(name)
    || name === 'searching'
    || avatar.includes('icon_02_searching');
};

const parseTimerTimestampMs = (value) => {
  if (value === undefined || value === null || value === '') return 0;

  if (typeof value === 'number') {
    return value > 9999999999 ? value : value * 1000;
  }

  const numericValue = Number(value);
  if (Number.isFinite(numericValue)) {
    return numericValue > 9999999999 ? numericValue : numericValue * 1000;
  }

  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : 0;
};

const getSecondsRemaining = (deadlineMs) => {
  const deadline = Number(deadlineMs) || 0;
  if (!deadline) return 0;
  return Math.max(0, Math.ceil((deadline - Date.now()) / 1000));
};

const resolveTimerDeadlineMs = (payload = {}, fallbackSeconds = 0) => {
  const explicitDeadline = parseTimerTimestampMs(
    payload.turnEndsAt
    || payload.endsAt
    || payload.expiresAt
    || payload.deadline
    || payload.timerEndsAt
    || payload.claimEndsAt
  );

  if (explicitDeadline) return explicitDeadline;

  const seconds = Number(payload.timeLimit ?? payload.timer ?? payload.remainingSeconds ?? fallbackSeconds ?? 0);
  return Number.isFinite(seconds) && seconds > 0 ? Date.now() + seconds * 1000 : 0;
};


const TILE_ASSET_ALIASES = {
  back: 'tile_back.png',
  tile_back: 'tile_back.png',
  Characters_1: 'm_1.png',
  Characters_2: 'm_2.png',
  Characters_3: 'm_3.png',
  Characters_4: 'm_4.png',
  Characters_5: 'm_5.png',
  Characters_6: 'm_6.png',
  Characters_7: 'm_7.png',
  Characters_8: 'm_8.png',
  Characters_9: 'm_9.png',
  'Circles-Dots_1': 'p_1.png',
  'Circles-Dots_2': 'p_2.png',
  'Circles-Dots_3': 'p_3.png',
  'Circles-Dots_4': 'p_4.png',
  'Circles-Dots_5': 'p_5.png',
  'Circles-Dots_6': 'p_6.png',
  'Circles-Dots_7': 'p_7.png',
  'Circles-Dots_8': 'p_8.png',
  'Circles-Dots_9': 'p_9.png',
  Bamboo_1: 's_1.png',
  Bamboo_2: 's_2.png',
  Bamboo_3: 's_3.png',
  Bamboo_4: 's_4.png',
  Bamboo_5: 's_5.png',
  Bamboo_6: 's_6.png',
  Bamboo_7: 's_7.png',
  Bamboo_8: 's_8.png',
  Bamboo_9: 's_9.png',
  Wind_East: 'w_e.png',
  Wind_South: 'w_s.png',
  Wind_West: 'w_w.png',
  Wind_North: 'w_n.png',
  Dragon_Red: 'd_r.png',
  Dragon_White: 'd_w.png',
  Dragon_Green: 'd_g.png',
};

const tileIdToAssetName = (tileId) => {
  const value = String(tileId || '').trim();
  if (!value) return '';

  const withoutExtension = value.replace(/\.(png|jpe?g|webp|gif|svg)$/i, '');
  if (TILE_ASSET_ALIASES[withoutExtension]) return TILE_ASSET_ALIASES[withoutExtension];

  const parts = withoutExtension.split('_');
  const suit = parts[0];
  const rank = parts[1];

  // Backend tile ids include a copy index, e.g. p_7_2 / d_g_0.
  // The asset files are shared per tile face, so the copy index is intentionally ignored.
  if ((suit === 'm' || suit === 'p' || suit === 's') && /^\d+$/.test(rank)) {
    return `${suit}_${rank}.png`;
  }

  if (suit === 'w' && ['e', 's', 'w', 'n'].includes(rank)) {
    return `w_${rank}.png`;
  }

  if (suit === 'd' && ['r', 'w', 'g'].includes(rank)) {
    return `d_${rank}.png`;
  }

  if (suit === 'fl' && ['spring', 'summer', 'autumn', 'winter'].includes(rank)) {
    return `${withoutExtension}.png`; // placeholders or actual assets
  }

  if (suit === 'sn' && ['plum', 'orchid', 'chrysanthemum', 'bamboo'].includes(rank)) {
    return `${withoutExtension}.png`;
  }

  if (suit === 'an' && ['cat', 'mouse', 'chicken', 'centipede'].includes(rank)) {
    return `${withoutExtension}.png`;
  }

  if (suit === 'fei') {
    return 'fei.png'; // Ignore copy index (e.g. fei_0 -> fei.png)
  }

  if (/\.(png|jpe?g|webp|gif|svg)$/i.test(value)) return value;
  return `${withoutExtension}.png`;
};

const getTileId = (tile) => {
  if (!tile) return '';
  if (typeof tile === 'string') return tile;
  return tile.id || tile.tileId || tile.value || tile.name || tile.tileName || tile.image || tile.asset || '';
};

const normalizeTileName = (tile) => tileIdToAssetName(getTileId(tile));

const normalizeTileList = (value) => toArray(value).map(normalizeTileName).filter(Boolean);
const getRawTileList = (value) => toArray(value).map(getTileId).filter(Boolean);

const getFirstRawTileList = (...values) => {
  for (const value of values) {
    const tiles = getRawTileList(value);
    if (tiles.length) return tiles;
  }

  return [];
};

const getFirstTileList = (...values) => {
  for (const value of values) {
    const tiles = normalizeTileList(value);
    if (tiles.length) return tiles;
  }

  return [];
};

const removeOneTileFromHand = (tiles = [], rawTileId = '', renderedTileName = '') => {
  const list = toArray(tiles);
  if (!list.length) return [];

  const raw = String(rawTileId || '');
  const exactIndex = raw ? list.findIndex((tile) => String(getTileId(tile)) === raw) : -1;
  const faceIndex = renderedTileName
    ? list.findIndex((tile) => normalizeTileName(tile) === renderedTileName)
    : -1;
  const removeIndex = exactIndex >= 0 ? exactIndex : faceIndex;

  if (removeIndex < 0) return list;
  return [...list.slice(0, removeIndex), ...list.slice(removeIndex + 1)];
};

const getPlayerTileList = (player, ...keys) => {
  if (!player) return [];

  for (const key of keys) {
    const tiles = normalizeTileList(player[key]);
    if (tiles.length) return tiles;
  }

  return [];
};

const getDiscardTilesByPosition = (state, player, position) => getFirstTileList(
  player?.discardTiles,
  player?.discards,
  player?.discardPile,
  player?.discardedTiles,
  state.discards?.[position],
  state.discardTiles?.[position],
  state.discardPiles?.[position],
  state[`${position}DiscardTiles`],
  state[`${position}Discards`]
);

const getVisibleDiscardTilesByPosition = (state, player, position) => (
  getCircularTableTiles(getDiscardTilesByPosition(state, player, position))
);

const getAvailableActions = (state, useMockDefaults = false) => {
  const rawActions = [
    state.claimWindow?.yourValidActions,
    state.claimWindow?.validActions,
    state.claimWindow?.actions,
    state.validActions,
    state.availableActions,
    state.actions,
    state.allowedActions,
  ].find((actions) => Array.isArray(actions) && actions.length) || (useMockDefaults ? DEFAULT_ACTIONS : []);

  const actions = toArray(rawActions)
    .map((action) => (typeof action === 'string' ? action : action?.type || action?.key || action?.name || action?.action))
    .filter(Boolean)
    .map(normalizeActionForUi)
    .filter(Boolean)
    .filter((action, index, list) => list.indexOf(action) === index);

  if (state.claimWindow && actions.length && !actions.includes('pass')) {
    return [...actions, 'pass'];
  }

  return actions;
};

const normalizeId = (value) => String(value ?? '').trim();

const getEntityIds = (source = {}) => [
  source.id,
  source._id,
  source.userId,
  source.playerId,
  source.uid,
  source.socketId,
  source.clientId,
  source.profileId,
].map(normalizeId).filter(Boolean);

const getCurrentPlayerIdCandidates = (...sources) => {
  const storedUser = getStoredAuthUser() || {};
  const ids = [];

  sources.filter(Boolean).forEach((source) => {
    const privateHandPlayer = getPrivateHandPlayer(source.players || source.initialGameState?.players || source.gameState?.players || []);

    // Only include identities that represent this browser/user.
    // Do not include activeUserId / turnPlayerId here, otherwise every client can
    // incorrectly resolve the current active player as "me".
    ids.push(
      privateHandPlayer?.id,
      privateHandPlayer?.userId,
      privateHandPlayer?.playerId,
      source.myPlayerId,
      source.selfPlayerId,
      source.localPlayerId,
      source.me?.id,
      source.me?.userId,
      source.currentUser?.id,
      source.currentUser?.userId,
      source.room?.myPlayerId,
      source.room?.selfPlayerId,
      source.initialGameState?.myPlayerId,
      source.initialGameState?.selfPlayerId,
      source.initialGameState?.localPlayerId,
    );
  });

  ids.push(...getEntityIds(storedUser));

  return ids.map(normalizeId).filter(Boolean).filter((id, index, list) => list.indexOf(id) === index);
};

const playerMatchesAnyId = (player, ids = []) => {
  if (!player || !ids.length) return false;
  const playerIds = getEntityIds(player);
  return playerIds.some((id) => ids.includes(id));
};

const getCurrentPlayerSeat = (...sources) => {
  for (const source of sources) {
    const seat = source?.mySeat || source?.seat || source?.currentPlayerSeat || source?.selfSeat || source?.initialGameState?.mySeat || source?.initialGameState?.seat;
    if (seat) return seat;
  }

  return '';
};

const normalizePosition = (value) => {
  const position = String(value || '').toLowerCase();
  return ['left', 'top', 'right'].includes(position) ? position : '';
};

const resolveActiveTurnPosition = ({ state, players, locationState, storedMatch, useMockFallback = false }) => {
  const explicitPosition = normalizePosition(state.activeTurnPosition || state.currentTurnPosition || state.turnPosition);
  if (explicitPosition) return explicitPosition;

  const activeSeat = state.activeSeat || state.currentTurnSeat || state.turnSeat || state.turn?.seat;
  const seatPosition = getSeatPosition(activeSeat, state);
  if (seatPosition) return seatPosition;

  const activeIds = getEntityIds({
    id: state.currentTurnPlayerId || state.turnPlayerId || state.activeUserId || state.activePlayerId || state.turn?.playerId || state.turn?.userId,
  });

  if (activeIds.length) {
    const activePlayer = toArray(players).find((player) => playerMatchesAnyId(player, activeIds));
    if (activePlayer?.position) return activePlayer.position;

    const currentIds = getCurrentPlayerIdCandidates(state, locationState, storedMatch);
    if (activeIds.some((id) => currentIds.includes(id))) return 'left';
  }

  const currentSeat = getCurrentPlayerSeat(state, locationState, storedMatch);
  if (currentSeat && activeSeat && String(currentSeat).toLowerCase() === String(activeSeat).toLowerCase()) {
    return 'left';
  }

  return useMockFallback ? 'left' : '';
};

const actionDefinitions = {
  chow: { labelKey: 'chow', className: 'blue' },
  pong: { labelKey: 'pong', className: 'green' },
  kong: { labelKey: 'kong', className: 'purple' },
  pass: { labelKey: 'pass', className: 'black' },
  ron: { labelKey: 'win', className: 'purple' },
  tsumo: { labelKey: 'win', className: 'purple' },
  riichi: { labelKey: 'riichi', className: 'blue' },
};

function GameplayTile({ name, className = '', label = '' }) {
  return <img className={`gameplay-tile ${className}`} src={asset(name)} alt={label} draggable="false" />;
}

function TileWall({ count = 14, direction = 'horizontal', className = '' }) {
  return (
    <div className={`gameplay-tile-wall ${direction} ${className}`} aria-hidden="true">
      {Array.from({ length: count }).map((_, index) => (
        <img src={asset('tile_back.png')} alt="" draggable="false" key={index} />
      ))}
    </div>
  );
}

function SideTool({ icon, label, onClick, className = '', disabled = false }) {
  return (
    <button
      className={`gameplay-side-tool ${className}`}
      type="button"
      aria-label={label}
      onClick={onClick}
      disabled={disabled}
    >
      <span className="gameplay-side-icon-shell">
        <img src={asset(icon)} alt="" draggable="false" />
      </span>
      <span className="gameplay-side-label">{label}</span>
    </button>
  );
}

function PlayerBadge({ variant = 'small', avatar, name, title = '', seatLabel = '', coins, className = '', isActiveTurn = false, turnLabel = '' }) {
  const displayName = String(name || '').trim() || 'Player';
  const subtitle = [title, seatLabel].filter(Boolean).join(' • ');

  return (
    <article className={`gameplay-player-badge ${variant} ${className} ${isActiveTurn ? 'active-turn' : ''}`}>
      {isActiveTurn ? (
        <>
          <span className="gameplay-turn-badge">{turnLabel}</span>
          <span className="gameplay-turn-arrow" aria-hidden="true">➤</span>
        </>
      ) : null}
      <img src={resolvePlayerAvatar(avatar)} alt="" className="gameplay-player-avatar" draggable="false" />
      <div className="gameplay-player-info">
        <strong>{displayName}</strong>
        {subtitle ? <small>{subtitle}</small> : null}
        {coins ? (
          <span>
            <i aria-hidden="true" />
            {coins}
          </span>
        ) : null}
      </div>
    </article>
  );
}

function Compass({ round = 'East 1', timer = 18, turnLabel = 'YOUR TURN' }) {
  return (
    <div className="gameplay-center-compass" aria-label={`Round ${round}. ${turnLabel}`}>
      <span className="timer">{timer}</span>
      <span className="north">N</span>
      <span className="east">E</span>
      <strong>{round}</strong>
      <em>{turnLabel}</em>
      <span className="south">S</span>
      <span className="west">W</span>
    </div>
  );
}


function normalizeSeat(value) {
  const seat = String(value || '').trim().toLowerCase();
  const aliases = { east: 'e', south: 's', west: 'w', north: 'n' };
  return aliases[seat] || seat;
}

function getRelativeSeatPosition(activeSeat, ownSeat, playerCount = 3) {
  const active = normalizeSeat(activeSeat);
  const own = normalizeSeat(ownSeat);

  if (!active || !own) return '';
  if (active === own) return 'left';

  const seats = ['e', 's', 'w', 'n'];
  const activeIndex = seats.indexOf(active);
  const ownIndex = seats.indexOf(own);

  if (activeIndex < 0 || ownIndex < 0) return '';
  if (playerCount <= 2) return 'top';

  const offset = (activeIndex - ownIndex + seats.length) % seats.length;
  if (offset === 1) return 'right';
  if (offset === 2) return 'top';
  if (offset === 3) return 'top';

  return '';
}

function getSeatPosition(seat, state = {}) {
  if (!seat) return '';

  // Always prefer the relative seat calculation based on mySeat.
  // This gives each client a DIFFERENT perspective (the whole point).
  // Do NOT use player.position from state.players — those positions are
  // assigned by array index during normalization and are the SAME on all clients.
  const ownSeat = state.mySeat || state.seat || state.currentPlayerSeat || state.selfSeat;
  if (ownSeat) {
    const playerCount = getExpectedGameplayPlayerCount(state);
    const relative = getRelativeSeatPosition(seat, ownSeat, playerCount);
    if (relative) return relative;
  }

  // Fallback: check rendered player objects (only if mySeat is unknown)
  const playerWithSeat = toArray(state.players).find((player) => normalizeSeat(player.seat) === normalizeSeat(seat));
  if (playerWithSeat?.position) return playerWithSeat.position;

  return '';
}

function mergeTurnStart(current, payload = {}) {
  const activeUserId = payload.activeUserId || payload.currentTurnPlayerId || payload.turnPlayerId || payload.activePlayerId || payload.playerId;
  const activeSeat = payload.activeSeat || payload.currentTurnSeat || payload.turnSeat || payload.seat;
  const activeIds = getEntityIds({ id: activeUserId });
  const playerWithActiveId = activeIds.length
    ? toArray(current.players).find((player) => playerMatchesAnyId(player, activeIds))
    : null;
  const activeTurnPosition = getSeatPosition(activeSeat, current)
    || playerWithActiveId?.position
    || '';

  const nextTimeLimit = Number(payload.timeLimit ?? payload.timer ?? payload.remainingSeconds ?? current.timeLimit ?? current.timer ?? 0) || 0;
  const timerDeadlineMs = resolveTimerDeadlineMs(payload, nextTimeLimit);

  return {
    ...current,
    status: 'playing',
    activeSeat: activeSeat || current.activeSeat,
    activeUserId: activeUserId || current.activeUserId,
    activeTurnPosition,
    currentTurnPlayerId: activeUserId || current.currentTurnPlayerId,
    timer: timerDeadlineMs ? getSecondsRemaining(timerDeadlineMs) : nextTimeLimit,
    timeLimit: nextTimeLimit || current.timeLimit,
    timerDeadlineMs,
    wallRemaining: payload.wallRemaining ?? current.wallRemaining,
    turnStartedAt: Date.now(),
    availableActions: [],
    validActions: [],
    claimWindow: null,
    pendingDiscardTileId: null,
  };
}

function mergeDrawnTile(current, payload = {}) {
  const tile = payload.tileId || payload.tile || payload.drawnTile;
  if (!tile) return current;

  const handTiles = getFirstRawTileList(current.handTiles, current.myHand, current.playerHand);

  const nextHandTiles = handTiles.some((existingTile) => String(existingTile) === String(tile))
    ? handTiles
    : [...handTiles, tile];

  return {
    ...current,
    drawnTile: tile,
    handTiles: nextHandTiles,
    myHand: nextHandTiles,
  };
}

function mergeClaimWindow(current, payload = {}) {
  const validActions = toArray(payload.yourValidActions || payload.validActions || payload.actions)
    .map((action) => (typeof action === 'string' ? action : action?.type || action?.action || action?.key))
    .filter(Boolean)
    .map(normalizeActionForUi)
    .filter(Boolean)
    .filter((action, index, list) => list.indexOf(action) === index);

  const nextTimeLimit = Number(payload.timeLimit ?? payload.timer ?? payload.remainingSeconds ?? current.timer ?? 0) || 0;
  const timerDeadlineMs = resolveTimerDeadlineMs(payload, nextTimeLimit);

  return {
    ...current,
    status: 'resolving',
    claimWindow: payload,
    availableActions: validActions,
    timer: timerDeadlineMs ? getSecondsRemaining(timerDeadlineMs) : nextTimeLimit,
    timeLimit: nextTimeLimit || current.timeLimit,
    timerDeadlineMs,
  };
}

function mergeActionBroadcast(current, payload = {}) {
  const action = String(payload.action || '').toLowerCase();
  const tileId = payload.tileId || payload.tile || payload.discardedTile;
  const actionUserId = payload.userId || payload.playerId || payload.activeUserId || payload.discardedBy || payload.discardedByUserId || payload.discardedByPlayerId;
  const actionIds = getEntityIds({ id: actionUserId });
  const playerWithActionId = actionIds.length
    ? toArray(current.players).find((player) => playerMatchesAnyId(player, actionIds))
    : null;
  const seatPosition = getSeatPosition(payload.seat || payload.discardedBySeat, current)
    || playerWithActionId?.position
    || payload.position;

  if (!action) return current;

  const next = {
    ...current,
    lastAction: payload,
    status: action === 'disconnected' || action === 'reconnected' ? current.status : 'playing',
    claimWindow: null,
    availableActions: [],
    pendingDiscardTileId: null,
  };

  if (action === 'discard' && tileId) {
    const renderedTile = tileIdToAssetName(tileId);
    const discards = { ...(current.discards || {}) };
    const currentIds = getCurrentPlayerIdCandidates(current);
    const isLocalDiscard = seatPosition === 'left' || (actionIds.length && actionIds.some((id) => currentIds.includes(id)));
    const key = seatPosition || (isLocalDiscard ? 'left' : 'center');

    discards[key] = [...normalizeTileList(discards[key]), renderedTile];
    next.discards = discards;

    // Also update the per-player discards array so that getDiscardTilesByPosition
    // picks up discards from the correct player object (already positioned by seat).
    if (actionIds.length && Array.isArray(current.players)) {
      next.players = current.players.map((player) => {
        if (!playerMatchesAnyId(player, actionIds)) return player;
        const playerDiscards = toArray(player.discards || player.discardTiles || []);
        return { ...player, discards: [...playerDiscards, tileId], discardTiles: [...playerDiscards, tileId] };
      });
    }

    if (isLocalDiscard) {
      const discardedRawId = String(tileId);
      next.handTiles = removeOneTileFromHand(
        getFirstRawTileList(current.handTiles, current.myHand, current.playerHand),
        discardedRawId,
        renderedTile
      );
      next.myHand = next.handTiles;
    }
  }

  if ((action === 'pung' || action === 'pong' || action === 'kong' || action === 'chow') && payload.meldTiles) {
    const currentMelds = Array.isArray(current.centerTiles) ? current.centerTiles : [];
    next.centerTiles = [...currentMelds, ...normalizeTileList(payload.meldTiles)];
  }

  return next;
}

function normalizeInitialSocketState(payload = {}, fallbackMatchId = '') {
  const normalized = normalizeGameState(payload);
  const players = collectGameplayPlayers(payload, normalized);
  const privateHandPlayer = getPrivateHandPlayer(players);
  const privateHandTiles = getPrivateHandTiles(players);
  const handTiles = getFirstRawTileList(
    payload.initialHand,
    payload.myHand,
    payload.handTiles,
    normalized.myHand,
    normalized.handTiles,
    privateHandTiles
  );

  const privateHandPlayerId = privateHandPlayer?.userId || privateHandPlayer?.id || privateHandPlayer?.playerId || privateHandPlayer?._id || '';
  const privateHandSeat = privateHandPlayer?.seat || privateHandPlayer?.seatLabel || '';

  return {
    ...normalized,
    matchId: normalized.matchId || payload.matchId || payload.gameId || payload.roomId || fallbackMatchId,
    roomId: normalized.roomId || payload.roomId,
    tierId: normalized.tierId || payload.tierId || payload.room?.tierId,
    status: normalized.status || 'playing',
    myPlayerId: payload.myPlayerId || payload.selfPlayerId || privateHandPlayerId || normalized.myPlayerId,
    selfPlayerId: payload.selfPlayerId || payload.myPlayerId || privateHandPlayerId || normalized.selfPlayerId,
    mySeat: payload.mySeat || payload.selfSeat || privateHandSeat || payload.seat || normalized.mySeat || normalized.seat,
    seat: privateHandSeat || payload.seat || normalized.seat,
    players,
    handTiles,
    myHand: handTiles,
    wallRemaining: payload.wallRemaining ?? normalized.wallRemaining,
    currentDiscard: payload.currentDiscard ?? normalized.currentDiscard,
    playerCount: payload.playerCount ?? normalized.playerCount ?? players.length,
    maxPlayers: payload.maxPlayers ?? payload.room?.maxPlayers ?? normalized.maxPlayers ?? normalized.room?.maxPlayers,
  };
}

export default function MahjongGamePage({ mockMode = false } = {}) {
  const navigate = useNavigate();
  const { t } = useLanguage();
  const location = useLocation();
  const { matchId: routeMatchId } = useParams();
  const isMockGameplay = Boolean(
    mockMode
    || location.pathname === ROUTES.mockGame
    || location.pathname === ROUTES.gameplayMock
    || location.pathname === ROUTES.mockGameCompact
    || routeMatchId === 'mock-game'
    || routeMatchId === 'gameplay-mock'
  );
  const [storedMatch] = useState(() => {
    const match = getActiveMatch();
    const user = getStoredAuthUser();
    if (match && user) {
      const userIds = getEntityIds(user);
      const matchUserId = match.myPlayerId || match.selfPlayerId;
      if (matchUserId && userIds.length && !userIds.includes(matchUserId)) {
        clearActiveMatch();
        return null;
      }
    }
    return match;
  });
  const gameApiAvailable = isMockGameplay ? false : isGameApiAvailable();
  const initialSocketPayload = isMockGameplay
    ? fullMockGameState
    : (location.state?.initialGameState || storedMatch?.initialGameState || null);
  const socketGameplayEnabled = !isMockGameplay && Boolean(location.state?.socketMode || storedMatch?.socketMode || initialSocketPayload || !gameApiAvailable);
  const resolvedMatchId = isMockGameplay
    ? (fullMockGameState.matchId || 'mock_full_gameplay')
    : (routeMatchId
      || location.state?.matchId
      || storedMatch?.matchId
      || initialSocketPayload?.matchId
      || initialSocketPayload?.gameId
      || initialSocketPayload?.roomId
      || 'live_match');

  const [selectedAction, setSelectedAction] = useState(null);
  const [gameState, setGameState] = useState(() => ({
    ...EMPTY_SOCKET_GAME_STATE,
    ...(initialSocketPayload ? normalizeInitialSocketState(initialSocketPayload, resolvedMatchId) : {}),
    ...(isMockGameplay ? {
      status: 'playing',
      timer: 999,
      timeLimit: 999,
      timerDeadlineMs: 0,
      activeTurnPosition: 'left',
      availableActions: ['chow', 'pong', 'kong', 'pass'],
    } : {}),
    matchId: resolvedMatchId,
  }));
  const [gameError, setGameError] = useState('');
  const [isLeavingGame, setIsLeavingGame] = useState(false);
  const [displayTimer, setDisplayTimer] = useState(() => Number(gameState.timer ?? gameState.timeLimit ?? 0) || 0);

  useEffect(() => {
    if (!isMockGameplay && !routeMatchId && resolvedMatchId) {
      navigate(buildGameRoute(resolvedMatchId), { replace: true, state: location.state });
      return undefined;
    }

    let isMounted = true;
    const activeMatchBase = {
      ...storedMatch,
      matchId: resolvedMatchId,
      roomId: location.state?.roomId || storedMatch?.roomId,
      roomCode: location.state?.roomCode || storedMatch?.roomCode,
      tierId: location.state?.tierId || storedMatch?.tierId || initialSocketPayload?.tierId,
      socketMode: socketGameplayEnabled,
      maxPlayers: location.state?.maxPlayers || storedMatch?.maxPlayers || initialSocketPayload?.maxPlayers,
      players: location.state?.players || storedMatch?.players || initialSocketPayload?.players,
    };

    if (isMockGameplay) {
      const normalizedMock = normalizeInitialSocketState(fullMockGameState, resolvedMatchId);
      setGameState({
        ...EMPTY_SOCKET_GAME_STATE,
        ...normalizedMock,
        status: 'playing',
        timer: 999,
        timeLimit: 999,
        timerDeadlineMs: 0,
        activeTurnPosition: 'left',
        availableActions: ['chow', 'pong', 'kong', 'pass'],
        claimWindow: null,
        matchId: normalizedMock.matchId || resolvedMatchId,
      });
      setGameError('');
      return () => {
        isMounted = false;
      };
    }

    if (!gameApiAvailable && !socketGameplayEnabled && !getActiveGameSocket()) {
      setGameError('No active gameplay session found. Start from matchmaking or join a room first.');
      setGameState((current) => ({ ...(current || EMPTY_SOCKET_GAME_STATE), status: 'waiting', handTiles: [], myHand: [], availableActions: [] }));
      return () => {
        isMounted = false;
      };
    }

    if (initialSocketPayload) {
      const normalizedInitial = normalizeInitialSocketState(initialSocketPayload, resolvedMatchId);
      setGameState((current) => ({
        ...(current || {}),
        ...normalizedInitial,
        players: normalizedInitial.players?.length ? normalizedInitial.players : (current?.players || activeMatchBase.players || []),
        matchId: normalizedInitial.matchId || resolvedMatchId,
      }));
      saveActiveMatch({ ...activeMatchBase, initialGameState: normalizedInitial });
    }

    if (gameApiAvailable) {
      getGameState(resolvedMatchId)
        .then((state) => {
          if (isMounted && state) {
            setGameState((current) => ({ ...(current || {}), ...state, matchId: state.matchId || resolvedMatchId }));
            saveActiveMatch({
              ...activeMatchBase,
              matchId: state.matchId || resolvedMatchId,
              roomId: state.room?.id || activeMatchBase.roomId,
            });
          }
        })
        .catch((error) => {
          console.error('Failed to load game state:', error);
          if (isMounted && !socketGameplayEnabled) {
            setGameError(error.message || t('gameLoadFailed'));
          }
        });
    }

    const handleSocketMessage = (message = {}) => {
      if (!isMounted) return;
      const payload = message.payload || {};

      switch (message.type) {
        case 'game_start':
          setGameState((current) => {
            const normalizedStart = normalizeInitialSocketState(payload, resolvedMatchId);
            return {
              ...(current || EMPTY_SOCKET_GAME_STATE),
              ...normalizedStart,
              players: normalizedStart.players?.length ? normalizedStart.players : (current?.players || []),
              matchId: payload.matchId || payload.gameId || payload.roomId || current?.matchId || resolvedMatchId,
            };
          });
          setGameError('');
          break;
        case 'game_state':
          setGameState((current) => {
            const normalizedSync = normalizeInitialSocketState(payload, resolvedMatchId);
            return {
              ...EMPTY_SOCKET_GAME_STATE,
              ...normalizedSync,
              players: normalizedSync.players?.length ? normalizedSync.players : (current?.players || []),
              matchId: payload.matchId || payload.gameId || payload.roomId || current?.matchId || resolvedMatchId,
            };
          });
          setGameError('');
          break;
        case 'turn_changed':
          setGameState((current) => mergeTurnStart(current || {}, payload));
          setGameError('');
          break;
        case 'drawn_tile':
          setGameState((current) => mergeDrawnTile(current || {}, payload));
          break;
        case 'claim_window':
          setGameState((current) => mergeClaimWindow(current || {}, payload));
          break;
        case 'action_broadcast':
        case 'tile_discarded':
          setGameState((current) => mergeActionBroadcast(current || {}, payload));
          break;
        case 'game_finished':
          setGameState((current) => {
            const currentPlayers = toArray(current?.players);
            const resultPayload = {
              ...payload,
              players: Array.isArray(payload.players) && payload.players.length ? payload.players : currentPlayers,
              roomId: payload.roomId || current?.roomId || activeMatchBase.roomId,
              tierId: payload.tierId || current?.tierId || activeMatchBase.tierId,
              maxPlayers: payload.maxPlayers || current?.maxPlayers || activeMatchBase.maxPlayers,
            };

            return {
              ...(current || {}),
              ...payload,
              status: 'finished',
              result: resultPayload,
              winner: payload.winner || payload.winnerId || current?.winner,
              winnerId: payload.winnerId || payload.winner?.id || current?.winnerId,
              matchId: payload.matchId || current?.matchId || resolvedMatchId,
              players: currentPlayers,
            };
          });
          break;
        case 'error':
          setGameError(payload.message || payload.error || 'Gameplay socket error.');
          break;
        default:
          break;
      }
    };

    const existingSocket = getActiveGameSocket();
    const gameSocket = existingSocket || connectGameSocket({
      matchId: resolvedMatchId,
      onError(error) {
        console.error('Game socket error:', error);
        if (isMounted) setGameError(error?.message || 'Unable to connect to gameplay server.');
      },
      onClose() {
        if (isMounted) setGameError('Gameplay socket disconnected. Reconnect will sync state if the backend supports it.');
      },
    });

    const socketHandlers = [
      ['game:start', (payload) => handleSocketMessage({ type: 'game_start', payload })],
      ['game:sync_state', (payload) => handleSocketMessage({ type: 'game_state', payload })],
      ['game:turn_start', (payload) => handleSocketMessage({ type: 'turn_changed', payload })],
      ['player:drawn_tile', (payload) => handleSocketMessage({ type: 'drawn_tile', payload })],
      ['game:claim_window', (payload) => handleSocketMessage({ type: 'claim_window', payload })],
      ['game:action_broadcast', (payload) => handleSocketMessage({ type: 'action_broadcast', payload })],
      ['game:over', (payload) => handleSocketMessage({ type: 'game_finished', payload })],
      ['error', (payload) => handleSocketMessage({ type: 'error', payload })],
      ['game:error', (payload) => handleSocketMessage({ type: 'error', payload })],
      ['player:action_rejected', (payload) => handleSocketMessage({ type: 'error', payload })],
      ['room:error', (payload) => handleSocketMessage({ type: 'error', payload })],
      ['connect', () => { if (isMounted) setGameError(''); }],
      ['disconnect', () => { if (isMounted) setGameError('Gameplay socket disconnected. Reconnect will sync state if the backend supports it.'); }],
    ];

    if (gameSocket?.on) {
      socketHandlers.forEach(([eventName, handler]) => gameSocket.on(eventName, handler));
    }

    // Replay any gameplay events that arrived while React was navigating
    // from matchmaking to the gameplay page. This prevents missing the first
    // game:turn_start / player:drawn_tile pair and then waiting until auto-discard.
    getBufferedGameSocketMessages().forEach((bufferedMessage) => {
      handleSocketMessage(bufferedMessage);
    });

    return () => {
      isMounted = false;
      if (gameSocket?.off) {
        socketHandlers.forEach(([eventName, handler]) => gameSocket.off(eventName, handler));
      }
      // Keep the live socket alive while navigating from the game to the result screen.
      if (!socketGameplayEnabled) {
        disconnectGameSocket();
      }
    };
  }, [gameApiAvailable, initialSocketPayload, isMockGameplay, location.state, navigate, resolvedMatchId, routeMatchId, socketGameplayEnabled, storedMatch, t]);

  useEffect(() => {
    if (isMockGameplay) {
      setDisplayTimer(999);
      return;
    }

    const deadline = Number(gameState.timerDeadlineMs || 0);

    if (deadline) {
      setDisplayTimer(getSecondsRemaining(deadline));
      return;
    }

    const nextTimer = Number(gameState.timer ?? gameState.remainingSeconds ?? gameState.timeLimit ?? 0);
    setDisplayTimer(Number.isFinite(nextTimer) ? nextTimer : 0);
  }, [gameState.timerDeadlineMs, gameState.timer, gameState.remainingSeconds, gameState.timeLimit, gameState.activeTurnPosition, gameState.claimWindow, isMockGameplay]);

  const expectedPlayerCount = useMemo(() => getExpectedGameplayPlayerCount(
    gameState,
    location.state,
    storedMatch
  ), [gameState, location.state, storedMatch]);

  const currentPlayerIds = useMemo(() => getCurrentPlayerIdCandidates(gameState, location.state, storedMatch), [gameState, location.state, storedMatch]);
  const currentPlayerSeat = getCurrentPlayerSeat(gameState, location.state, storedMatch);

  const players = useMemo(() => {
    const livePlayers = collectGameplayPlayers(gameState, location.state, storedMatch, initialSocketPayload);
    const currentIdentity = normalizeGameplayPlayer(getGameplayCurrentIdentity(gameState, location.state, storedMatch, initialSocketPayload), 0);
    const sourcePlayers = livePlayers.length
      ? livePlayers
      : [{ ...currentIdentity, isCurrentPlayer: true }];

    return seatPlayersForGameplay(sourcePlayers, expectedPlayerCount, currentPlayerIds, currentPlayerSeat);
  }, [currentPlayerIds, currentPlayerSeat, expectedPlayerCount, gameApiAvailable, gameState, initialSocketPayload, location.state, storedMatch]);

  const fallbackCurrentPlayer = normalizeGameplayPlayer(getGameplayCurrentIdentity(gameState, location.state, storedMatch, initialSocketPayload), 0);
  const topPlayer = players.find((player) => player.position === 'top') || null;
  const leftPlayer = players.find((player) => player.position === 'left') || { ...fallbackCurrentPlayer, position: 'left' };
  const rightPlayer = players.find((player) => player.position === 'right') || null;
  const realPlayerCount = players.filter((player) => !isGameplayPlaceholderPlayer(player)).length;
  const isLiveGameStateIncomplete = socketGameplayEnabled && !gameApiAvailable && realPlayerCount < expectedPlayerCount;
  const shouldShowSyncWarning = isLiveGameStateIncomplete && !gameState.activeUserId && !gameState.activeSeat && !gameState.claimWindow;
  const hasRightPlayer = expectedPlayerCount >= 3 && Boolean(rightPlayer);

  const activeTurnPosition = resolveActiveTurnPosition({
    state: gameState,
    players,
    locationState: location.state,
    storedMatch,
    useMockFallback: gameApiAvailable || isMockGameplay,
  });
  const isUserTurn = activeTurnPosition === 'left';
  const activeTurnName = activeTurnPosition === 'top'
    ? (topPlayer?.name === 'BUNBUN' ? 'Bunbun' : topPlayer?.name || 'Waiting')
    : activeTurnPosition === 'right'
      ? (rightPlayer?.name || 'Waiting')
      : 'Your';
  const activeTurnLabel = activeTurnPosition
    ? (isUserTurn ? t('yourTurn') : `${activeTurnName}${t('turnSuffix')}`)
    : t('pleaseWaitMatch');

  const rawPlayerHandTiles = getFirstRawTileList(
    gameState.handTiles,
    gameState.playerHand,
    gameState.myHand,
    gameState.currentPlayerHand,
    ...(gameApiAvailable ? [getPlayerTileList(leftPlayer, 'handTiles', 'hand', 'tiles')] : [])
  );
  const playerHandTiles = rawPlayerHandTiles.map((tile) => normalizeTileName(tile));
  const leftDiscardTiles = getVisibleDiscardTilesByPosition(gameState, leftPlayer, 'left');
  const topDiscardTiles = getVisibleDiscardTilesByPosition(gameState, topPlayer, 'top');
  const rightDiscardTiles = hasRightPlayer ? getVisibleDiscardTilesByPosition(gameState, rightPlayer, 'right') : [];
  
  const leftBonusTiles = getFirstTileList(leftPlayer?.bonusTiles);
  const topBonusTiles = getFirstTileList(topPlayer?.bonusTiles);
  const rightBonusTiles = hasRightPlayer ? getFirstTileList(rightPlayer?.bonusTiles) : [];
  const centerDiscardTiles = getCircularTableTiles(getFirstTileList(
    gameState.centerTiles,
    gameState.centerDiscardTiles,
    gameState.centerMeldTiles,
    gameState.meldTiles,
    gameState.melds?.center,
    gameState.discards?.center,
    gameState.discardTiles?.center
  ));
  const isClaimWindowOpen = Boolean(gameState.claimWindow);
  const availableActions = getAvailableActions(gameState, false);


  useEffect(() => {
    if (isMockGameplay) {
      return undefined;
    }

    const status = String(gameState.status || '').toLowerCase();
    const shouldRunTimer = ['playing', 'resolving', 'active'].includes(status) || isUserTurn || isClaimWindowOpen;
    const deadline = Number(gameState.timerDeadlineMs || 0);

    if (!shouldRunTimer) {
      return undefined;
    }

    if (deadline) {
      const updateTimer = () => setDisplayTimer(getSecondsRemaining(deadline));
      updateTimer();
      const intervalId = window.setInterval(updateTimer, 250);
      return () => window.clearInterval(intervalId);
    }

    if (displayTimer <= 0) {
      return undefined;
    }

    const intervalId = window.setInterval(() => {
      setDisplayTimer((current) => Math.max(0, current - 1));
    }, 1000);

    return () => window.clearInterval(intervalId);
  }, [gameState.timerDeadlineMs, gameState.status, gameState.turnStartedAt, isClaimWindowOpen, isMockGameplay, isUserTurn]);


  useEffect(() => {
    if (isMockGameplay) return;

    const status = String(gameState.status || '').toLowerCase();
    const winner = gameState.winner || gameState.winnerId || gameState.result?.winner || gameState.result?.winnerId;

    if (status === 'finished' || status === 'completed' || winner) {
      navigate(ROUTES.result, {
        replace: true,
        state: {
          matchId: gameState.matchId || resolvedMatchId,
          result: gameState.result || gameState,
          winner,
        },
      });
    }
  }, [gameState.matchId, gameState.result, gameState.status, gameState.winner, gameState.winnerId, isMockGameplay, navigate, resolvedMatchId]);

  const handleExitGameplaySession = async () => {
    if (isLeavingGame) return;

    setIsLeavingGame(true);

    if (isMockGameplay) {
      navigate(ROUTES.mainMenu, { replace: true });
      return;
    }

    const leavePayload = {
      matchId: gameState.matchId || resolvedMatchId,
      gameId: gameState.gameId || gameState.matchId || resolvedMatchId,
      roomId: gameState.roomId || gameState.room?.id || gameState.room?.roomId || location.state?.roomId || storedMatch?.roomId || resolvedMatchId,
      roomCode: gameState.roomCode || gameState.room?.roomCode || location.state?.roomCode || storedMatch?.roomCode,
      tierId: gameState.tierId || gameState.room?.tierId || location.state?.tierId || storedMatch?.tierId,
    };

    try {
      await leaveGame(leavePayload);
    } catch (error) {
      console.warn('[gameplay] Unable to notify backend before leaving gameplay:', error);
    } finally {
      disconnectGameSocket();
      clearActiveMatch();
      clearMatchmakingContext();
      navigate(ROUTES.mainMenu, { replace: true });
    }
  };

  const handleTileDiscard = (visualTile) => {
    if (!isUserTurn || gameState.pendingDiscardTileId) return;

    const rawList = getFirstRawTileList(gameState.handTiles, gameState.myHand, gameState.playerHand);
    const rawTileId = rawList.find(t => tileIdToAssetName(t) === visualTile) || visualTile;

    const tileId = getTileId(rawTileId);
    if (!tileId) return;

    if (isMockGameplay) {
      const renderedTile = tileIdToAssetName(tileId);
      setGameState((current) => {
        const handTiles = removeOneTileFromHand(
          getFirstRawTileList(current.handTiles, current.myHand, current.playerHand),
          String(tileId),
          renderedTile
        );
        const discards = { ...(current.discards || {}) };
        discards.left = [...normalizeTileList(discards.left), renderedTile];

        return {
          ...(current || {}),
          handTiles,
          myHand: handTiles,
          discards,
          currentDiscard: renderedTile,
          pendingDiscardTileId: null,
        };
      });
      setGameError('');
      return;
    }

    const sent = discardTile(tileId);
    if (sent) {
      setGameState((current) => ({ ...(current || {}), pendingDiscardTileId: tileId }));
      setGameError('');
    } else {
      setGameError('Unable to discard tile. Waiting for gameplay socket connection.');
    }
  };

  const handleMahjongAction = (actionKey) => {
    setSelectedAction(actionKey);

    if (isMockGameplay) {
      setGameError('');
      return;
    }

    if (actionKey === 'pass') {
      const sent = passClaimWindow();
      if (!sent) setGameError('Unable to pass. Waiting for gameplay socket connection.');
      return;
    }

    if (actionKey === 'tsumo') {
      const sent = declareWin('tsumo');
      if (!sent) setGameError('Unable to declare win. Waiting for gameplay socket connection.');
      return;
    }

    if (actionKey === 'riichi') {
      const drawnTile = gameState.drawnTile || rawPlayerHandTiles[rawPlayerHandTiles.length - 1];
      const sent = declareRiichi(getTileId(drawnTile));
      if (!sent) setGameError('Unable to declare Riichi. Waiting for gameplay socket connection.');
      return;
    }

    const claimAction = CLAIM_ACTION_ALIASES[actionKey] || actionKey;
    const sent = claimDiscard(claimAction);
    if (!sent) {
      setGameError('Unable to send claim action. Waiting for gameplay socket connection.');
    }
  };

  return (
    <section className={`gameplay-screen ${isMockGameplay ? 'gameplay-screen--mock' : ''}`} aria-label="Mahjong gameplay screen">
      <img className="gameplay-bg" src={asset('BG.png')} alt="" draggable="false" />
      <div className="gameplay-vignette" aria-hidden="true" />
      <div className="gameplay-sakura-particles" aria-hidden="true">
        {Array.from({ length: 18 }).map((_, index) => (
          <span key={index} />
        ))}
      </div>

      {gameError ? <div className="gameplay-error" role="alert">{gameError}</div> : null}
      {shouldShowSyncWarning ? (
        <div className="gameplay-error" role="status">
          Waiting for synchronized {expectedPlayerCount}P game state. Received {realPlayerCount}/{expectedPlayerCount} real players.
        </div>
      ) : null}

      <header className="gameplay-room-title">
        <span>{t('room')}</span>
        <strong>{gameState.room?.name || 'My Sakura Room'}</strong>
      </header>

      {topPlayer ? (
        <PlayerBadge
          className="top-player"
          variant="top"
          avatar={topPlayer.avatar}
          name={topPlayer.name === 'BUNBUN' ? 'Bunbun' : topPlayer.name}
          title={topPlayer.title}
          seatLabel={topPlayer.seatLabel}
          coins={topPlayer.coins}
          isActiveTurn={activeTurnPosition === 'top'}
          turnLabel={activeTurnPosition === 'top' ? activeTurnLabel : ''}
        />
      ) : null}

      <PlayerBadge
        className="left-player"
        variant="left"
        avatar={leftPlayer.avatar}
        name={leftPlayer.name === 'STEIVE' ? 'Stevie' : leftPlayer.name}
        title={leftPlayer.title}
        seatLabel={leftPlayer.seatLabel}
        coins={leftPlayer.coins}
        isActiveTurn={activeTurnPosition === 'left'}
        turnLabel={activeTurnPosition === 'left' ? activeTurnLabel : ''}
      />

      {hasRightPlayer ? (
        <PlayerBadge
          className="right-player"
          variant="right"
          avatar={rightPlayer.avatar}
          name={rightPlayer.name}
          title={rightPlayer.title}
          seatLabel={rightPlayer.seatLabel}
          coins={rightPlayer.coins}
          isActiveTurn={activeTurnPosition === 'right'}
          turnLabel={activeTurnPosition === 'right' ? activeTurnLabel : ''}
        />
      ) : null}

      <main className="gameplay-table-zone">
        <img className="gameplay-table" src={asset('table.png')} alt="Mahjong table" draggable="false" />

        <TileWall count={14} direction="horizontal" className="wall-top" />
        {hasRightPlayer ? <TileWall count={13} direction="vertical" className="wall-right" /> : null}

        <Compass round={gameState.round || 'East 1'} timer={displayTimer} turnLabel={activeTurnLabel} />

        <div className="gameplay-upper-discard" aria-label="Top discard tiles">
          {topDiscardTiles.map((tile, index) => (
            <GameplayTile name={tile} key={`${tile}-${index}`} />
          ))}
        </div>
        {topBonusTiles.length > 0 && (
          <div className="gameplay-upper-bonus" aria-label="Top bonus tiles" style={{ position: 'absolute', top: '10px', right: '10px', display: 'flex', gap: '4px', scale: '0.8' }}>
            {topBonusTiles.map((tile, index) => (
              <GameplayTile name={tile} key={`bonus-top-${tile}-${index}`} />
            ))}
          </div>
        )}

        {hasRightPlayer ? (
          <>
            <div className="gameplay-right-discard" aria-label="Right discard tiles">
              {rightDiscardTiles.map((tile, index) => (
                <GameplayTile name={tile} key={`${tile}-${index}`} />
              ))}
            </div>
            {rightBonusTiles.length > 0 && (
              <div className="gameplay-right-bonus" aria-label="Right bonus tiles" style={{ position: 'absolute', right: '10px', bottom: '20%', display: 'flex', flexDirection: 'column', gap: '4px', scale: '0.8' }}>
                {rightBonusTiles.map((tile, index) => (
                  <GameplayTile name={tile} key={`bonus-right-${tile}-${index}`} />
                ))}
              </div>
            )}
          </>
        ) : null}

        <div className="gameplay-center-discard" aria-label="Center meld tiles">
          {centerDiscardTiles.map((tile, index) => (
            <GameplayTile name={tile} key={`${tile}-${index}`} />
          ))}
        </div>

        <div className="gameplay-left-discard" aria-label="Your discard tiles">
          {leftDiscardTiles.map((tile, index) => (
            <GameplayTile name={tile} key={`${tile}-${index}`} />
          ))}
        </div>
        {leftBonusTiles.length > 0 && (
          <div className="gameplay-left-bonus" aria-label="Your bonus tiles" style={{ position: 'absolute', bottom: '110px', right: '5%', display: 'flex', gap: '4px', scale: '0.9' }}>
            {leftBonusTiles.map((tile, index) => (
              <GameplayTile name={tile} key={`bonus-left-${tile}-${index}`} />
            ))}
          </div>
        )}

        <div className="gameplay-hand" aria-label="Player hand tiles">
          {playerHandTiles.map((tile, index) => (
            <button
              className="gameplay-hand-tile"
              type="button"
              key={`${tile}-${index}`}
              aria-label={`Tile ${index + 1}`}
              disabled={!isUserTurn || Boolean(gameState.pendingDiscardTileId)}
              onClick={() => handleTileDiscard(tile)}
            >
              <GameplayTile name={tile} />
            </button>
          ))}
        </div>
      </main>

      <nav className={`gameplay-actions ${isUserTurn ? 'player-turn' : 'waiting-turn'} ${isClaimWindowOpen ? 'claim-window' : ''}`} aria-label={t('mahjongActions')}>
        {availableActions.map((actionKey) => {
          const action = actionDefinitions[actionKey];

          if (!action) {
            return null;
          }

          const isActive = selectedAction === actionKey;

          return (
            <button
              className={`gameplay-action ${action.className} ${isActive ? 'active' : ''}`}
              type="button"
              key={actionKey}
              onClick={() => handleMahjongAction(actionKey)}
              aria-pressed={isActive}
              disabled={!isClaimWindowOpen && !isUserTurn}
            >
              {t(action.labelKey)}
            </button>
          );
        })}
      </nav>

      <aside className="gameplay-side-menu" aria-label="Gameplay side menu">
        <SideTool
          icon="exit.png"
          label={t('leave')}
          className="leave"
          onClick={handleExitGameplaySession}
          disabled={isLeavingGame}
        />
      </aside>
    </section>
  );
}
