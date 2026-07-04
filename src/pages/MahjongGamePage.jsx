import { useEffect, useMemo, useState } from 'react';
import { useLocation, useNavigate, useParams } from 'react-router-dom';
import { ROUTES, buildGameRoute } from '../router/routes.js';
import { getStoredAuthUser } from '../services/authService.js';
import { getGameState, isGameApiAvailable, leaveGame } from '../services/gameService.js';
import { normalizeGameState } from '../services/gameNormalizers.js';
import {
  claimDiscard,
  connectGameSocket,
  declareKong,
  declareWin,
  discardTile,
  disconnectGameSocket,
  getActiveGameSocket,
  getBufferedGameSocketMessages,
  passClaimWindow,
  playBonusTile,
  reclaimFei,
  skipFeiReclaim,
} from '../services/socket.js';
import { clearActiveMatch, clearMatchmakingContext, getActiveMatch, saveActiveMatch } from '../store/gameStore.js';
import { useLanguage } from '../i18n/useLanguage.js';
import { mockGameState as fullMockGameState } from '../mocks/mockGameState.js';
import { handleProfileAvatarError, isDefaultProfileAvatarValue, resolveProfileAvatarSrc } from '../utils/avatarAssets.js';
import { preloadGameplayAssets } from '../utils/gameplayAssetPreloader.js';

const asset = (name) => `/assets/gameplay/${name}`;

const STRICT_GAMEPLAY_PLAYER_COUNT = 3;

const clampGameplayPlayerCount = () => STRICT_GAMEPLAY_PLAYER_COUNT;

const getGameplayPlayerCountFromId = (value) => {
  const match = String(value || '').match(/(\d+)p/i);
  return match ? clampGameplayPlayerCount() : null;
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

    if (Array.isArray(source.players) && source.players.length === STRICT_GAMEPLAY_PLAYER_COUNT) {
      return STRICT_GAMEPLAY_PLAYER_COUNT;
    }
  }

  return STRICT_GAMEPLAY_PLAYER_COUNT;
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
  const rawTitle = player.title || player.rankTitle || player.profileTitle || '';
  const isBot = Boolean(player.isBot || String(player.userId || player.id || '').startsWith('bot:'));
  const cleanTitle = isBot && /^cpu$/i.test(String(rawTitle || '').trim()) ? '' : rawTitle;

  return {
    ...player,
    id: player.id || player.userId || player._id || player.playerId || player.uid || player.clientId || player.socketId || '',
    userId: player.userId || player.id || player._id || player.playerId || player.uid || '',
    name: getRealPlayerName(player),
    username: player.username || getRealPlayerName(player),
    avatar: player.avatar || player.avatarUrl || player.avatarId || player.imageUrl || player.photoUrl || player.icon || null,
    avatarId: player.avatarId || player.avatar || player.avatarUrl || player.imageUrl || player.photoUrl || player.icon || null,
    title: cleanTitle,
    coins: '',
    score: player.score ?? player.points ?? player.balance ?? player.coins ?? '',
    isBot,
    seat: player.seat,
    seatLabel: player.seatLabel || player.seatName || '',
    seatIndex: player.seatIndex,
    isDealer: Boolean(player.isDealer ?? player.dealer),
    isDisconnected: Boolean(player.isDisconnected ?? player.disconnected),
    handTiles,
    hand: player.hand || player.handTiles || [],
    handSize: player.handSize ?? player.handCount ?? player.tileCount ?? player.tilesCount ?? handTiles.length ?? 0,
    discardTiles: player.discardTiles || player.discards || player.discardPile || player.discardedTiles || [],
    discards: player.discards || player.discardTiles || player.discardPile || player.discardedTiles || [],
    openMelds: player.openMelds || player.exposedMelds || player.declaredMelds || player.openSets || player.sets || [],
    bonusTiles: player.bonusTiles || player.revealedBonusTiles || player.revealedBonus || player.bonus || player.flowers || player.seasons || player.animals || [],
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
  Array.isArray(player.exposedMelds) && player.exposedMelds.length ? 'exposedMelds' : '',
  Array.isArray(player.declaredMelds) && player.declaredMelds.length ? 'declaredMelds' : '',
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
  const allowedPositions = expectedPlayerCount <= 2 ? ['bottom', 'top'] : ['bottom', 'top', 'left'];
  const normalizedPlayers = toArray(sourcePlayers)
    .filter(Boolean)
    .map(normalizeGameplayPlayer)
    .slice(0, expectedPlayerCount);

  if (!normalizedPlayers.length) return [];

  // Patch 10: table seats are fixed by dealer-roll rank, not by the local user.
  // East / highest dice is always bottom, South / second is top, West / third is left.
  const sortedPlayers = [...normalizedPlayers].sort((a, b) => {
    const aIndex = getAbsoluteSeatSortIndex(a);
    const bIndex = getAbsoluteSeatSortIndex(b);
    if (aIndex !== bIndex) return aIndex - bIndex;
    return normalizedPlayers.indexOf(a) - normalizedPlayers.indexOf(b);
  });

  const usedPositions = new Set();
  return sortedPlayers.map((player, index) => {
    const absolutePosition = getAbsolutePositionForPlayer(player);
    const requestedPosition = normalizePosition(player.position);
    let position = absolutePosition || requestedPosition;

    if (!position || usedPositions.has(position) || !allowedPositions.includes(position)) {
      position = allowedPositions.find((candidate) => !usedPositions.has(candidate)) || allowedPositions[index] || 'top';
    }

    usedPositions.add(position);
    return { ...player, position };
  });
};

const DEFAULT_ACTIONS = ['chow', 'pong', 'kong', 'hu', 'pass'];
const ACTION_TO_UI = {
  pung: 'pong',
  pon: 'pong',
  pong: 'pong',
  chi: 'chow',
  chow: 'chow',
  kan: 'kong',
  kong: 'kong',
  ron: 'hu',
  hu: 'hu',
  hule: 'hu',
  win: 'hu',
  tsumo: 'hu',
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
  hu: 'ron',
  hule: 'ron',
  win: 'ron',
};
const MALAYSIAN_DISABLED_ACTIONS = new Set(['riichi']);
const normalizeActionForUi = (action) => {
  const normalized = ACTION_TO_UI[String(action || '').toLowerCase()] || String(action || '').toLowerCase();
  return MALAYSIAN_DISABLED_ACTIONS.has(normalized) ? '' : normalized;
};
const EMPTY_SOCKET_GAME_STATE = {
  status: 'waiting',
  players: [],
  handTiles: [],
  myHand: [],
  discards: {},
  centerTiles: [],
  availableActions: [],
  claimWindow: null,
  reclaimFei: null,
  timer: 0,
  pendingDiscardTileId: null,
  hasDiscardedThisTurn: false,
  turnEndedByDiscard: false,
  discardCountThisTurn: 0,
  room: { name: 'Live Match' },
};
const toArray = (value) => (Array.isArray(value) ? value : []);
const MAX_TABLE_DISCARD_TILES = 7;
const MINIMUM_FAN_TO_WIN = 5;
const FEI_RECLAIM_AVAILABLE_ACTIONS = new Set([
  'fei_reclaim_available',
  'reclaim_fei_available',
  'fei_reclaim_window',
  'reclaim_fei_window',
  'can_reclaim_fei',
  'replace_fei_available',
]);
const FEI_RECLAIM_COMPLETE_ACTIONS = new Set([
  'fei_reclaimed',
  'reclaim_fei',
  'reclaim_fei_confirmed',
  'replace_fei',
  'fei_reclaim_skipped',
  'skip_fei_reclaim',
]);
const CLAIM_WINDOW_ONLY_ACTIONS = new Set(['chow', 'pong', 'kong', 'pass']);
const TURN_ONLY_ACTIONS = new Set(['kong', 'hu']);


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


const TIMER_PAYLOAD_FIELDS = [
  'turnEndsAt',
  'timerEndsAt',
  'endsAt',
  'expiresAt',
  'deadline',
  'claimEndsAt',
  'timeLimit',
  'remainingSeconds',
];

const hasExplicitTimerPayload = (payload = {}) => (
  Boolean(payload && typeof payload === 'object')
  && TIMER_PAYLOAD_FIELDS.some((key) => payload[key] !== undefined && payload[key] !== null && payload[key] !== '')
);

const getTurnIdentity = (state = {}) => ({
  userId: String(state.turnPlayerId || state.currentTurnPlayerId || state.activeUserId || state.activePlayerId || '').trim(),
  seat: String(state.activeSeat || state.currentTurnSeat || state.turnSeat || state.seat || '').trim(),
  turnNumber: state.turnNumber ?? state.turnState?.turnNumber ?? state.turn?.number ?? null,
});

const isSameGameplayTurn = (current = {}, next = {}) => {
  const currentTurn = getTurnIdentity(current);
  const nextTurn = getTurnIdentity(next);

  const samePlayer = currentTurn.userId && nextTurn.userId
    ? currentTurn.userId === nextTurn.userId
    : Boolean(currentTurn.seat && nextTurn.seat && currentTurn.seat === nextTurn.seat);

  if (!samePlayer) return false;

  if (currentTurn.turnNumber === null || nextTurn.turnNumber === null) return true;
  return Number(currentTurn.turnNumber) === Number(nextTurn.turnNumber);
};

function mergeSynchronizedGameState(current = {}, payload = {}, fallbackMatchId = '') {
  const normalizedSync = normalizeInitialSocketState(payload, fallbackMatchId);
  const baseNext = {
    ...EMPTY_SOCKET_GAME_STATE,
    ...normalizedSync,
    players: normalizedSync.players?.length ? normalizedSync.players : (current?.players || []),
    matchId: payload.matchId || payload.gameId || payload.roomId || current?.matchId || fallbackMatchId,
  };

  const explicitTimer = hasExplicitTimerPayload(payload);
  const timerLimit = Number(payload.timeLimit ?? payload.timer ?? payload.remainingSeconds ?? normalizedSync.timeLimit ?? normalizedSync.timer ?? 0) || 0;
  const explicitDeadlineMs = explicitTimer ? resolveTimerDeadlineMs(payload, timerLimit) : 0;

  if (explicitDeadlineMs) {
    baseNext.timerDeadlineMs = explicitDeadlineMs;
    baseNext.timer = getSecondsRemaining(explicitDeadlineMs);
    baseNext.timeLimit = timerLimit || normalizedSync.timeLimit || current.timeLimit;
  }

  if (!explicitTimer && isSameGameplayTurn(current, baseNext)) {
    baseNext.timer = current.timer;
    baseNext.timeLimit = current.timeLimit;
    baseNext.timerDeadlineMs = current.timerDeadlineMs;
    baseNext.turnStartedAt = current.turnStartedAt;
  }

  return baseNext;
}


const TILE_ASSET_ALIASES = {
  back: 'tile_back.png',
  tile_back: 'tile_back.png',
  'Circles-Dots_1': 'p_1.png',
  'Circles-Dots_2': 'p_2.png',
  'Circles-Dots_3': 'p_3.png',
  'Circles-Dots_4': 'p_4.png',
  'Circles-Dots_5': 'p_5.png',
  'Circles-Dots_6': 'p_6.png',
  'Circles-Dots_7': 'p_7.png',
  'Circles-Dots_8': 'p_8.png',
  'Circles-Dots_9': 'p_9.png',
  Dots_1: 'p_1.png',
  Dots_2: 'p_2.png',
  Dots_3: 'p_3.png',
  Dots_4: 'p_4.png',
  Dots_5: 'p_5.png',
  Dots_6: 'p_6.png',
  Dots_7: 'p_7.png',
  Dots_8: 'p_8.png',
  Dots_9: 'p_9.png',
  Wind_East: 'w_e.png',
  Wind_South: 'w_s.png',
  Wind_West: 'w_w.png',
  Wind_North: 'w_n.png',
  Dragon_Red: 'd_r.png',
  Dragon_White: 'd_w.png',
  Dragon_Green: 'd_g.png',
  Flower_Spring: 'fl_spring.png',
  Flower_Summer: 'fl_summer.png',
  Flower_Autumn: 'fl_autumn.png',
  Flower_Winter: 'fl_winter.png',
  Season_Plum: 'sn_plum.png',
  Season_Orchid: 'sn_orchid.png',
  Season_Chrysanthemum: 'sn_chrysanthemum.png',
  Season_Bamboo: 'sn_bamboo.png',
  Animal_Cat: 'an_cat.png',
  Animal_Mouse: 'an_mouse.png',
  Animal_Chicken: 'an_chicken.png',
  Animal_Rooster: 'an_chicken.png',
  Animal_Rooster_1: 'an_chicken.png',
  Rooster: 'an_chicken.png',
  rooster: 'an_chicken.png',
  an_rooster: 'an_chicken.png',
  Animal_Centipede: 'an_centipede.png',
  Joker_Clown: 'joker_clown.png',
  Joker: 'joker_clown.png',
  Fei: 'fei.png',
};

const AVAILABLE_TILE_ASSET_NAMES = new Set([
  'tile_back.png',
  'p_1.png',
  'p_2.png',
  'p_3.png',
  'p_4.png',
  'p_5.png',
  'p_6.png',
  'p_7.png',
  'p_8.png',
  'p_9.png',
  'w_e.png',
  'w_s.png',
  'w_w.png',
  'w_n.png',
  'd_r.png',
  'd_w.png',
  'd_g.png',
  'fl_spring.png',
  'fl_summer.png',
  'fl_autumn.png',
  'fl_winter.png',
  'sn_plum.png',
  'sn_orchid.png',
  'sn_chrysanthemum.png',
  'sn_bamboo.png',
  'an_cat.png',
  'an_mouse.png',
  'an_chicken.png',
  'an_centipede.png',
  'joker_clown.png',
  'fei.png',
]);

const getSupportedTileAsset = (name) => {
  const assetName = String(name || '').trim();
  return AVAILABLE_TILE_ASSET_NAMES.has(assetName) ? assetName : '';
};

const tileIdToAssetName = (tileId) => {
  const value = String(tileId || '').trim();
  if (!value) return '';

  const withoutExtension = value.replace(/\.(png|jpe?g|webp|gif|svg)$/i, '');
  if (TILE_ASSET_ALIASES[withoutExtension]) return TILE_ASSET_ALIASES[withoutExtension];

  const normalized = withoutExtension.toLowerCase();
  const compactDotsMatch = normalized.match(/^p([1-9])(?:_\d+)?$/);
  if (compactDotsMatch) return `p_${compactDotsMatch[1]}.png`;

  const parts = normalized.split('_');
  const suit = parts[0];
  const rank = parts[1];

  // Backend tile ids may include a copy index, e.g. p_7_2 / d_g_0.
  // The asset files are shared per tile face, so the copy index is intentionally ignored.
  // Only the supplied tile asset set is rendered; unsupported suit assets are ignored.
  if (suit === 'p' && /^\d+$/.test(rank)) {
    return getSupportedTileAsset(`p_${rank}.png`);
  }

  if (suit === 'w' && ['e', 's', 'w', 'n'].includes(rank)) {
    return `w_${rank}.png`;
  }

  if (suit === 'd' && ['r', 'w', 'g'].includes(rank)) {
    return `d_${rank}.png`;
  }

  if (suit === 'fl' && ['spring', 'summer', 'autumn', 'winter'].includes(rank)) {
    return `fl_${rank}.png`;
  }

  if (suit === 'sn' && ['plum', 'orchid', 'chrysanthemum', 'bamboo'].includes(rank)) {
    return `sn_${rank}.png`;
  }

  if (suit === 'an' && ['cat', 'mouse', 'chicken', 'rooster', 'centipede'].includes(rank)) {
    return rank === 'rooster' ? 'an_chicken.png' : `an_${rank}.png`;
  }

  if (suit === 'joker' && rank === 'clown') {
    return 'joker_clown.png';
  }

  if (suit === 'fei') {
    return 'fei.png'; // Ignore copy index (e.g. fei_0 -> fei.png)
  }

  if (/\.(png|jpe?g|webp|gif|svg)$/i.test(value)) return getSupportedTileAsset(`${withoutExtension}.png`);
  return getSupportedTileAsset(`${withoutExtension}.png`);
};

const getTileId = (tile) => {
  if (!tile) return '';
  if (typeof tile === 'string') return tile;
  return tile.rawId
    || tile.backendId
    || tile.instanceId
    || tile.id
    || tile.tileId
    || tile.value
    || tile.name
    || tile.tileName
    || tile.image
    || tile.asset
    || tile.assetName
    || '';
};

const normalizeTileName = (tile) => {
  if (tile && typeof tile === 'object' && tile.assetName) {
    return getSupportedTileAsset(tile.assetName) || tileIdToAssetName(tile.assetName);
  }

  return tileIdToAssetName(getTileId(tile));
};

const buildTileFocus = ({ kind, payload = {}, rawTileId = '', tileName = '', position = '', visibility = 'public', label = '' } = {}) => {
  const animation = payload.animation || {};
  const resolvedRawTileId = rawTileId || payload.tileId || payload.tile || payload.drawnTile || animation.tileId || '';
  const resolvedTileName = tileName
    || tileIdToAssetName(resolvedRawTileId)
    || payload.tileBack
    || animation.tileBack
    || 'tile_back.png';

  if (!resolvedTileName) return null;

  return {
    id: payload.animationId || animation.id || `${kind || 'tile'}_${position || 'center'}_${resolvedRawTileId || resolvedTileName}_${Date.now()}`,
    kind: kind || animation.type || 'tile',
    rawTileId: resolvedRawTileId,
    tileName: resolvedTileName,
    position: normalizePosition(position || payload.position || animation.position || ''),
    visibility: visibility || payload.tileVisibility || animation.visibility || 'public',
    label: label || (kind === 'draw' ? 'DRAW' : kind === 'discard' ? 'DISCARD' : 'TILE'),
    createdAt: Date.now(),
  };
};

const tileMatchesHighlight = (tile, highlight = {}) => {
  if (!tile || !highlight) return false;
  const tileRaw = String(getTileId(tile) || '').trim();
  const tileRendered = normalizeTileName(tile) || String(tile || '').trim();
  const highlightRaw = String(highlight.rawTileId || highlight.tileId || '').trim();
  const highlightRendered = String(highlight.tileName || highlight.assetName || '').trim();

  return Boolean(
    (highlightRaw && tileRaw && highlightRaw === tileRaw)
    || (highlightRendered && tileRendered && highlightRendered === tileRendered)
  );
};

const isLastHighlightedTile = (tile, index, tiles = [], position = '', highlight = {}) => {
  if (!highlight || (highlight.position && normalizePosition(highlight.position) !== normalizePosition(position))) return false;
  if (!tileMatchesHighlight(tile, highlight)) return false;

  const lastMatchingIndex = toArray(tiles).reduce((latest, candidate, candidateIndex) => (
    tileMatchesHighlight(candidate, highlight) ? candidateIndex : latest
  ), -1);

  return lastMatchingIndex === index;
};

const normalizeHandTileEntry = (tile, index = 0) => {
  const rawId = getTileId(tile);
  const assetName = normalizeTileName(tile);

  if (!assetName) return null;

  return {
    rawId: rawId || assetName,
    assetName,
    index,
    source: tile,
  };
};

const isFeiOrJokerTileName = (tile) => {
  const assetName = normalizeTileName(tile) || String(tile || '').trim().toLowerCase();
  return assetName === 'fei.png'
    || assetName === 'joker_clown.png'
    || /^fei(?:[_.-]|$)/i.test(assetName)
    || assetName.includes('joker')
    || assetName.includes('clown');
};

const isBonusTileName = (tile) => {
  const rawId = String(getTileId(tile) || '').trim().toLowerCase().replace(/\.(png|jpe?g|webp|gif|svg)$/i, '');
  const assetName = String(normalizeTileName(tile) || '').trim().toLowerCase().replace(/\.(png|jpe?g|webp|gif|svg)$/i, '');
  const value = rawId || assetName;
  return value.startsWith('fl_') || value.startsWith('sn_') || value.startsWith('an_');
};


const getKongBaseFromTile = (tile) => {
  if (!tile || isFeiOrJokerTileName(tile)) return '';

  const raw = String(getTileId(tile) || '').trim().toLowerCase().replace(/\.(png|jpe?g|webp|gif|svg)$/i, '');
  const rendered = String(normalizeTileName(tile) || '').trim().toLowerCase().replace(/\.(png|jpe?g|webp|gif|svg)$/i, '');
  const value = raw || rendered;
  const parts = value.split('_');

  if (parts[0] === 'p' && /^\d+$/.test(parts[1] || '')) return `p_${parts[1]}`;
  if (parts[0] === 'w' && ['e', 's', 'w', 'n'].includes(parts[1])) return `w_${parts[1]}`;
  if (parts[0] === 'd' && ['r', 'w', 'g'].includes(parts[1])) return `d_${parts[1]}`;
  return '';
};

const hasLocalHiddenKong = (handTiles = []) => {
  const counts = new Map();
  toArray(handTiles).forEach((tile) => {
    const base = getKongBaseFromTile(tile);
    if (!base) return;
    counts.set(base, (counts.get(base) || 0) + 1);
  });
  return [...counts.values()].some((count) => count >= 4);
};

const hasLocalPromotedKong = (openMelds = [], handTiles = []) => {
  const handBases = new Set(toArray(handTiles).map(getKongBaseFromTile).filter(Boolean));

  return normalizeMeldList(openMelds).some((meld) => {
    const type = String(meld.type || '').toLowerCase();
    if (!['pung', 'pong', 'pon'].includes(type)) return false;
    if (meld.hasFei || meld.tiles?.some((tile) => isFeiOrJokerTileName(tile)) || meld.rawTiles?.some((tile) => isFeiOrJokerTileName(tile))) {
      return false;
    }

    const meldBases = (meld.rawTiles?.length ? meld.rawTiles : meld.tiles)
      .map(getKongBaseFromTile)
      .filter(Boolean);
    const uniqueBases = [...new Set(meldBases)];

    return uniqueBases.length === 1 && meldBases.length >= 3 && handBases.has(uniqueBases[0]);
  });
};

const hasLocalKongAction = (handTiles = [], openMelds = []) => (
  hasLocalHiddenKong(handTiles) || hasLocalPromotedKong(openMelds, handTiles)
);

const getLocalHiddenKongCandidatePayload = (handTiles = []) => {
  const byBase = new Map();

  toArray(handTiles).forEach((tile) => {
    const base = getKongBaseFromTile(tile);
    const tileId = getTileId(tile);
    if (!base || !tileId) return;
    if (!byBase.has(base)) byBase.set(base, []);
    byBase.get(base).push(tileId);
  });

  for (const [baseTile, tiles] of byBase.entries()) {
    if (tiles.length >= 4) {
      return {
        type: 'hidden',
        mode: 'hidden',
        baseTile,
        tileId: tiles[0],
        tiles: tiles.slice(0, 4),
      };
    }
  }

  return null;
};

const getMeldBaseTile = (meld = {}) => {
  const normalized = normalizeMeldEntry(meld);
  if (!normalized) return '';
  const tiles = normalized.rawTiles?.length ? normalized.rawTiles : normalized.tiles;
  const bases = toArray(tiles).map(getKongBaseFromTile).filter(Boolean);
  const uniqueBases = [...new Set(bases)];
  return uniqueBases.length === 1 ? uniqueBases[0] : '';
};

const getLocalPromotedKongCandidatePayload = (openMelds = [], handTiles = []) => {
  const handByBase = new Map();

  toArray(handTiles).forEach((tile) => {
    const base = getKongBaseFromTile(tile);
    const tileId = getTileId(tile);
    if (base && tileId && !handByBase.has(base)) handByBase.set(base, tileId);
  });

  return normalizeMeldList(openMelds).reduce((candidate, meld, index) => {
    if (candidate) return candidate;

    const type = String(meld.type || '').toLowerCase();
    if (!['pung', 'pong', 'pon'].includes(type)) return null;
    if (meld.hasFei || meld.tiles?.some((tile) => isFeiOrJokerTileName(tile)) || meld.rawTiles?.some((tile) => isFeiOrJokerTileName(tile))) {
      return null;
    }

    const baseTile = getMeldBaseTile(meld);
    const fourthTileId = handByBase.get(baseTile);
    if (!baseTile || !fourthTileId) return null;

    return {
      type: 'promoted',
      mode: 'promoted',
      kongType: 'promoted',
      baseTile,
      tileId: fourthTileId,
      targetTile: fourthTileId,
      meldId: meld.meldId || meld.id || `meld_${index}`,
      openMeldId: meld.meldId || meld.id || `meld_${index}`,
    };
  }, null);
};

const getLocalKongCandidatePayload = (handTiles = [], openMelds = []) => (
  getLocalHiddenKongCandidatePayload(handTiles) || getLocalPromotedKongCandidatePayload(openMelds, handTiles)
);

const normalizeTileList = (value) => toArray(value).map(normalizeTileName).filter(Boolean);
const getRawTileList = (value) => toArray(value).map(getTileId).filter(Boolean);

const MELD_TILE_KEYS = ['tiles', 'meldTiles', 'claimedTiles', 'exposedTiles', 'setTiles', 'groupTiles', 'cards'];

const normalizeMeldEntry = (meld, fallbackType = '') => {
  if (!meld) return null;

  const rawType = typeof meld === 'object' && !Array.isArray(meld)
    ? (meld.type || meld.action || meld.name || meld.kind || meld.meldType || fallbackType)
    : fallbackType;
  const type = normalizeActionForUi(rawType) || String(rawType || '').toLowerCase() || 'meld';

  let tiles = [];
  let rawTiles = [];

  if (Array.isArray(meld) || typeof meld === 'string') {
    tiles = normalizeTileList(Array.isArray(meld) ? meld : [meld]);
    rawTiles = getRawTileList(Array.isArray(meld) ? meld : [meld]);
  } else if (typeof meld === 'object') {
    const tileSource = MELD_TILE_KEYS.map((key) => meld[key]).find((value) => Array.isArray(value) && value.length)
      || (Array.isArray(meld.set) ? meld.set : null)
      || (Array.isArray(meld.group) ? meld.group : null);

    tiles = normalizeTileList(tileSource || []);
    rawTiles = getRawTileList(tileSource || []);
  }

  if (!tiles.length) return null;

  return {
    ...(typeof meld === 'object' && !Array.isArray(meld) ? meld : {}),
    type,
    tiles,
    rawTiles,
  };
};

const normalizeMeldList = (value) => {
  if (!value) return [];

  if (Array.isArray(value)) {
    return value.map((entry) => normalizeMeldEntry(entry)).filter(Boolean);
  }

  if (typeof value === 'object') {
    const looksLikeSingleMeld = MELD_TILE_KEYS.some((key) => Array.isArray(value[key]) && value[key].length)
      || Array.isArray(value.set)
      || Array.isArray(value.group);

    const source = looksLikeSingleMeld
      ? [value]
      : Object.values(value).flatMap((entry) => (Array.isArray(entry) ? entry : [entry]));

    return source.map((entry) => normalizeMeldEntry(entry)).filter(Boolean);
  }

  return [];
};

const getFirstMeldList = (...values) => {
  for (const value of values) {
    const melds = normalizeMeldList(value);
    if (melds.length) return melds;
  }

  return [];
};

const MELD_OWNER_ID_KEYS = [
  'ownerId',
  'ownerUserId',
  'ownerPlayerId',
  'playerId',
  'userId',
  'claimedBy',
  'claimedByUserId',
  'claimedByPlayerId',
  'claimerId',
  'claimingPlayerId',
  'actorId',
  'actorUserId',
  'actorPlayerId',
  'byPlayerId',
];

const MELD_OWNER_POSITION_KEYS = [
  'position',
  'ownerPosition',
  'playerPosition',
  'seatPosition',
  'claimedByPosition',
  'claimerPosition',
  'actorPosition',
  'actionPosition',
];

const MELD_OWNER_SEAT_KEYS = [
  'seat',
  'ownerSeat',
  'playerSeat',
  'claimedBySeat',
  'claimerSeat',
  'claimingSeat',
  'actorSeat',
  'actionSeat',
];

const getObjectKeyValue = (object, keys = []) => {
  if (!object || typeof object !== 'object') return '';
  for (const key of keys) {
    const value = object[key];
    if (value !== undefined && value !== null && value !== '') return value;
  }
  return '';
};

const getMeldOwnerIds = (meld = {}) => {
  if (!meld || typeof meld !== 'object') return [];

  const ids = MELD_OWNER_ID_KEYS.flatMap((key) => {
    const value = meld[key];
    return Array.isArray(value) ? value : [value];
  });

  ids.push(
    meld.player?.id,
    meld.player?.userId,
    meld.player?.playerId,
    meld.owner?.id,
    meld.owner?.userId,
    meld.owner?.playerId,
  );

  return ids.map(normalizeId).filter(Boolean).filter((id, index, list) => list.indexOf(id) === index);
};

const getPlayerOwnerIds = (player = {}) => getEntityIds(player)
  .filter(Boolean)
  .filter((id, index, list) => list.indexOf(id) === index);

const getMeldOwnerPosition = (meld = {}, state = {}) => {
  const explicitPosition = normalizePosition(getObjectKeyValue(meld, MELD_OWNER_POSITION_KEYS));
  if (explicitPosition) return explicitPosition;

  const ownerSeat = getObjectKeyValue(meld, MELD_OWNER_SEAT_KEYS);
  return ownerSeat ? getSeatPosition(ownerSeat, state) : '';
};

const meldHasExplicitOwner = (meld = {}, state = {}) => Boolean(
  getMeldOwnerIds(meld).length
  || getMeldOwnerPosition(meld, state)
  || getObjectKeyValue(meld, MELD_OWNER_SEAT_KEYS)
);

const isMeldOwnedByPlayer = (meld = {}, player = {}, position = '', state = {}) => {
  const ownerIds = getMeldOwnerIds(meld);
  const playerIds = getPlayerOwnerIds(player);

  if (ownerIds.length) return ownerIds.some((id) => playerIds.includes(id));

  const ownerPosition = getMeldOwnerPosition(meld, state);
  if (ownerPosition) return ownerPosition === normalizePosition(position || player?.position);

  const ownerSeat = normalizeSeat(getObjectKeyValue(meld, MELD_OWNER_SEAT_KEYS));
  const playerSeat = normalizeSeat(player?.seat);
  if (ownerSeat && playerSeat) return ownerSeat === playerSeat;

  return true;
};

const looksLikeSingleMeldObject = (value = {}) => value && typeof value === 'object' && !Array.isArray(value) && (
  MELD_TILE_KEYS.some((key) => Array.isArray(value[key]) && value[key].length)
  || Array.isArray(value.set)
  || Array.isArray(value.group)
);

const getMappedMeldSourceCandidates = (value, player = {}, position = '') => {
  if (!value || Array.isArray(value) || typeof value !== 'object' || looksLikeSingleMeldObject(value)) {
    return value ? [value] : [];
  }

  const keys = [
    position,
    normalizePosition(player?.position),
    player?.seat,
    normalizeSeat(player?.seat),
    player?.id,
    player?.userId,
    player?.playerId,
    player?._id,
    player?.uid,
    player?.socketId,
  ].map((key) => String(key || '').trim()).filter(Boolean);

  const candidates = [];
  const seenKeys = new Set();
  keys.forEach((key) => {
    [key, key.toLowerCase(), key.toUpperCase()].forEach((candidateKey) => {
      if (!candidateKey || seenKeys.has(candidateKey)) return;
      seenKeys.add(candidateKey);
      if (value[candidateKey] !== undefined && value[candidateKey] !== null) candidates.push(value[candidateKey]);
    });
  });

  return candidates;
};

const normalizeOwnedMeldList = (value, player = {}, position = '', state = {}, { allowUnowned = false, positionMappedOnly = false } = {}) => {
  const mappedCandidates = getMappedMeldSourceCandidates(value, player, position);
  const candidates = mappedCandidates.length ? mappedCandidates : (positionMappedOnly ? [] : [value]);

  return candidates
    .flatMap((candidate) => normalizeMeldList(candidate))
    .filter((meld) => (meldHasExplicitOwner(meld, state) ? isMeldOwnedByPlayer(meld, player, position, state) : allowUnowned));
};

const getMeldSignature = (meld = {}) => {
  const normalized = normalizeMeldEntry(meld);
  if (!normalized) return '';
  const type = normalizeActionForUi(normalized.type) || String(normalized.type || '').toLowerCase() || 'meld';
  const tiles = (Array.isArray(normalized.rawTiles) && normalized.rawTiles.length ? normalized.rawTiles : normalized.tiles) || [];
  const normalizedTiles = tiles.map((tile) => normalizeTileName(tile) || getTileId(tile)).filter(Boolean);
  return `${type}|${normalizedTiles.join(',')}`;
};

const dedupeMeldListBySignature = (melds = []) => {
  const seen = new Set();
  return normalizeMeldList(melds).filter((meld) => {
    const signature = getMeldSignature(meld);
    if (!signature || seen.has(signature)) return false;
    seen.add(signature);
    return true;
  });
};

const dedupeMeldRacksByOwnership = (meldsByPosition = {}, state = {}) => {
  const next = {};
  const seenOwnerless = new Set();

  ['bottom', 'top', 'left'].forEach((position) => {
    next[position] = dedupeMeldListBySignature(meldsByPosition[position] || []).filter((meld) => {
      const signature = getMeldSignature(meld);
      if (!signature) return false;

      if (meldHasExplicitOwner(meld, state)) return true;
      if (seenOwnerless.has(signature)) return false;
      seenOwnerless.add(signature);
      return true;
    });
  });

  return next;
};

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

const appendUniqueTileList = (...values) => {
  const nextTiles = [];
  const seenTiles = new Set();

  values.forEach((value) => {
    normalizeTileList(value).forEach((tile) => {
      if (!tile || seenTiles.has(tile)) return;
      seenTiles.add(tile);
      nextTiles.push(tile);
    });
  });

  return nextTiles;
};

const getFirstNumber = (...values) => {
  for (const value of values) {
    if (Array.isArray(value) || (value && typeof value === 'object')) continue;
    if (value === undefined || value === null || value === '') continue;
    const numberValue = Number(value);
    if (Number.isFinite(numberValue)) return numberValue;
  }

  return null;
};

const getWallRemainingValue = (state = {}) => {
  const wallRemaining = getFirstNumber(
    state.wallRemaining,
    state.remainingWall,
    state.remainingWallTiles,
    state.wallTilesRemaining,
    state.tilesRemaining,
    state.wallCount,
    state.wall?.remaining,
    state.wall?.remainingTiles,
    state.wall?.count
  );

  return wallRemaining !== null && wallRemaining >= 0 ? wallRemaining : null;
};

const getFanDisplayInfo = (...sources) => {
  const flattenedSources = [];

  sources.filter(Boolean).forEach((source) => {
    flattenedSources.push(source);
    [
      source.fanInfo,
      source.fanSummary,
      source.handEvaluation,
      source.winPreview,
      source.scoring,
      source.scoreSummary,
      source.result,
    ].filter(Boolean).forEach((nestedSource) => flattenedSources.push(nestedSource));
  });

  let currentFan = null;
  let minimumFan = null;

  flattenedSources.forEach((source) => {
    if (!source || typeof source !== 'object') return;

    if (currentFan === null) {
      currentFan = getFirstNumber(
        source.currentFan,
        source.totalFan,
        source.fanCount,
        source.fanValue,
        source.fans,
        source.fan
      );
    }

    if (minimumFan === null) {
      minimumFan = getFirstNumber(
        source.minimumFan,
        source.minFan,
        source.requiredFan,
        source.requiredFans,
        source.minimumFans,
        source.winMinFan
      );
    }
  });

  return {
    currentFan,
    minimumFan: minimumFan ?? MINIMUM_FAN_TO_WIN,
    hasCurrentFan: currentFan !== null,
  };
};

const isMinimumFanErrorPayload = (payload = {}) => {
  const searchable = [
    payload.code,
    payload.errorCode,
    payload.reason,
    payload.type,
    payload.message,
    payload.error,
  ].filter(Boolean).join(' ').toLowerCase();

  return Boolean(searchable) && (
    searchable.includes('min_fan')
    || searchable.includes('minimum_fan')
    || searchable.includes('insufficient_fan')
    || searchable.includes('fan_required')
    || (searchable.includes('fan') && searchable.includes('minimum'))
    || (searchable.includes('fan') && searchable.includes('required'))
  );
};

const getGameplayErrorMessage = (payload = {}, t = (key) => key) => {
  if (isMinimumFanErrorPayload(payload)) return t('minimumFanRequired');

  const rawMessage = String(payload.message || payload.error || payload.reason || '').trim();
  const searchable = [payload.code, payload.errorCode, payload.reason, payload.type, rawMessage]
    .filter(Boolean)
    .join(' ')
    .toLowerCase();

  if (searchable.includes('bonus') && searchable.includes('win')) {
    return t('playBonusBeforeWin');
  }

  if (
    searchable.includes('4 melds')
    || searchable.includes('1 pair')
    || searchable.includes('winning hand shape')
    || searchable.includes('invalid hand')
    || searchable.includes('invalid_winning_hand')
  ) {
    return t('invalidWinningHand');
  }

  if (searchable.includes('not your turn') || searchable.includes('turn_player') || searchable.includes('turnplayer')) {
    return t('notYourTurn');
  }

  if (searchable.includes('claim window') || searchable.includes('pending claim') || searchable.includes('no claim')) {
    return t('claimWindowClosed');
  }

  if (searchable.includes('no legal kong') || (searchable.includes('kong') && searchable.includes('available'))) {
    return t('kongUnavailable');
  }

  if (searchable.includes('fei') && searchable.includes('discard')) {
    return t('feiLocked');
  }

  if (searchable.includes('bonus') && searchable.includes('discard')) {
    return t('bonusTileDiscardLocked');
  }

  if (searchable.includes('bonus') && (searchable.includes('play') || searchable.includes('flower') || searchable.includes('season') || searchable.includes('animal'))) {
    return t('bonusTileUnavailable');
  }

  return rawMessage || 'Gameplay socket error.';
};

const RECLAIM_FEI_WINDOW_KEYS = [
  'reclaimFeiWindow',
  'feiReclaimWindow',
  'reclaimFei',
  'feiReclaim',
  'pendingFeiReclaim',
  'pendingFeiReplacement',
  'feiReplacement',
  'replaceFei',
];
const RECLAIM_FEI_OPTIONS_KEYS = [
  'options',
  'reclaimFeiOptions',
  'availableFeiReclaims',
  'availableReclaims',
  'feiReclaimOptions',
  'replacements',
];

const looksLikeFeiReclaimPayload = (payload = {}) => {
  if (!payload || typeof payload !== 'object') return false;
  const action = String(payload.action || payload.type || payload.event || payload.name || '').toLowerCase();
  return Boolean(
    payload.canReclaimFei
    || payload.canReplaceFei
    || payload.hasFeiReclaim
    || payload.available === true
    || payload.active === true
    || payload.pending === true
    || (action.includes('fei') && (action.includes('reclaim') || action.includes('replace')))
    || RECLAIM_FEI_OPTIONS_KEYS.some((key) => Array.isArray(payload[key]) && payload[key].length)
  );
};

const getRawReclaimFeiWindow = (payload = {}) => {
  if (!payload) return null;
  if (payload === true) return { active: true };
  if (Array.isArray(payload)) return payload.length ? { active: true, options: payload } : null;
  if (typeof payload !== 'object') return null;

  for (const key of RECLAIM_FEI_WINDOW_KEYS) {
    const value = payload[key];
    if (!value) continue;
    if (value === true) return { ...payload, active: true };
    if (Array.isArray(value)) return value.length ? { ...payload, active: true, options: value } : null;
    if (typeof value === 'object') return { ...payload, ...value, active: value.active ?? true };
  }

  const optionArrayKey = RECLAIM_FEI_OPTIONS_KEYS.find((key) => Array.isArray(payload[key]) && payload[key].length);
  if (optionArrayKey) return { ...payload, active: true, options: payload[optionArrayKey] };

  return looksLikeFeiReclaimPayload(payload) ? { ...payload, active: true } : null;
};

const normalizeFeiReclaimOption = (option = {}, index = 0) => {
  const raw = option && typeof option === 'object' && !Array.isArray(option)
    ? option
    : { replacementTile: option };

  const replacementSource = raw.replacementTile
    || raw.actualTile
    || raw.naturalTile
    || raw.drawnTile
    || raw.tile
    || raw.tileId
    || raw.replacementTileId
    || raw.actualTileId
    || raw.naturalTileId
    || raw.drawnTileId;
  const feiSource = raw.feiTile
    || raw.jokerTile
    || raw.wildcardTile
    || raw.feiTileId
    || raw.jokerTileId
    || raw.wildcardTileId
    || raw.removedFeiTile;
  const meldSource = raw.meld
    || raw.openMeld
    || raw.exposedMeld
    || raw.meldData
    || {};

  const replacementTileId = getTileId(replacementSource);
  const feiTileId = getTileId(feiSource) || 'fei';
  const replacementTile = normalizeTileName(replacementSource) || normalizeTileName(replacementTileId);
  const feiTile = normalizeTileName(feiSource) || normalizeTileName(feiTileId) || 'fei.png';
  const meldTiles = getFirstTileList(
    raw.meldTiles,
    raw.tiles,
    raw.exposedTiles,
    raw.setTiles,
    raw.groupTiles,
    meldSource.tiles,
    meldSource.meldTiles,
    meldSource.exposedTiles,
    meldSource.setTiles
  );

  return {
    ...raw,
    id: raw.id || raw.optionId || raw.reclaimId || raw.meldId || meldSource.id || meldSource.meldId || `fei-reclaim-${index}`,
    optionId: raw.optionId || raw.id || raw.reclaimId || `fei-reclaim-${index}`,
    reclaimId: raw.reclaimId || raw.id || raw.optionId || '',
    meldId: raw.meldId || meldSource.id || meldSource.meldId || '',
    replacementTileId,
    replacementTile,
    feiTileId,
    feiTile,
    meldTiles,
    raw,
  };
};

const normalizeReclaimFeiWindow = (payload = {}) => {
  const source = getRawReclaimFeiWindow(payload);
  if (!source) return null;

  const rawOptions = RECLAIM_FEI_OPTIONS_KEYS
    .map((key) => source[key])
    .find((value) => Array.isArray(value) && value.length)
    || (Array.isArray(source) ? source : []);
  const options = (rawOptions.length ? rawOptions : [source])
    .map((option, index) => normalizeFeiReclaimOption(option, index))
    .filter(Boolean);

  if (!options.length) return null;

  return {
    ...source,
    active: true,
    options,
    message: source.message || source.description || payload.message || '',
  };
};

const buildFeiReclaimPayload = (windowState = {}, option = {}) => ({
  optionId: option.optionId || option.id || windowState.optionId || windowState.id,
  reclaimId: option.reclaimId || windowState.reclaimId || windowState.id,
  meldId: option.meldId || windowState.meldId,
  meldIndex: option.meldIndex ?? windowState.meldIndex,
  type: option.type || windowState.type,
  baseTile: option.feiSubstitutes || option.baseTile || windowState.feiSubstitutes || windowState.baseTile,
  tileId: option.replacementTileId || windowState.replacementTileId,
  replacementTileId: option.replacementTileId || windowState.replacementTileId,
  actualTileId: option.replacementTileId || windowState.actualTileId,
  feiTileId: option.feiTileId || windowState.feiTileId,
});

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

const removeMeldTilesFromHand = (tiles = [], rawMeldTiles = [], renderedMeldTiles = [], claimedTileId = '', renderedClaimedTile = '') => {
  let nextTiles = toArray(tiles);
  if (!nextTiles.length) return nextTiles;

  const rawEntries = toArray(rawMeldTiles)
    .map((tile, index) => {
      const rawId = getTileId(tile);
      const rendered = normalizeTileName(tile) || renderedMeldTiles[index] || tileIdToAssetName(rawId);
      return rawId || rendered ? { rawId, rendered } : null;
    })
    .filter(Boolean);

  const renderedOnlyEntries = !rawEntries.length
    ? toArray(renderedMeldTiles).map((tile) => ({ rawId: '', rendered: normalizeTileName(tile) || String(tile || '') })).filter((entry) => entry.rendered)
    : [];

  const entries = rawEntries.length ? rawEntries : renderedOnlyEntries;
  if (!entries.length) return nextTiles;

  const claimedRaw = String(claimedTileId || '').trim();
  const claimedRendered = renderedClaimedTile || tileIdToAssetName(claimedRaw);
  const hasExactClaimEntry = claimedRaw && entries.some((entry) => String(entry.rawId || '').trim() === claimedRaw);
  let skippedClaimByFace = false;

  entries.forEach((entry) => {
    const entryRaw = String(entry.rawId || '').trim();
    const entryRendered = entry.rendered || tileIdToAssetName(entryRaw);

    // The claimed discard is part of the exposed meld, but it was not in the
    // claimant's hand.  Do not remove that exact instance from the local hand.
    if (claimedRaw && entryRaw && entryRaw === claimedRaw) {
      return;
    }

    // Some backend builds send meld faces without unique copy ids. In that case
    // skip one tile matching the claimed face so we remove only the tiles that
    // actually came from this player's hand.
    if (!hasExactClaimEntry && claimedRendered && entryRendered === claimedRendered && !skippedClaimByFace) {
      skippedClaimByFace = true;
      return;
    }

    nextTiles = removeOneTileFromHand(nextTiles, entryRaw, entryRendered);
  });

  return nextTiles;
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

const getOpenMeldsByPosition = (state, player, position) => {
  const normalizedPosition = normalizePosition(position);

  const positionMappedMelds = [
    ...normalizeOwnedMeldList(state.openMelds, player, normalizedPosition, state, { allowUnowned: true, positionMappedOnly: true }),
    ...normalizeOwnedMeldList(state.exposedMelds, player, normalizedPosition, state, { allowUnowned: true, positionMappedOnly: true }),
    ...normalizeOwnedMeldList(state.declaredMelds, player, normalizedPosition, state, { allowUnowned: true, positionMappedOnly: true }),
    ...normalizeOwnedMeldList(state.melds, player, normalizedPosition, state, { allowUnowned: true, positionMappedOnly: true }),
    ...normalizeOwnedMeldList(state[`${normalizedPosition}OpenMelds`], player, normalizedPosition, state, { allowUnowned: true }),
    ...normalizeOwnedMeldList(state[`${normalizedPosition}Melds`], player, normalizedPosition, state, { allowUnowned: true }),
  ];

  const playerSpecificMelds = [
    ...normalizeOwnedMeldList(player?.openMelds, player, normalizedPosition, state, { allowUnowned: true }),
    ...normalizeOwnedMeldList(player?.exposedMelds, player, normalizedPosition, state, { allowUnowned: true }),
    ...normalizeOwnedMeldList(player?.declaredMelds, player, normalizedPosition, state, { allowUnowned: true }),
    ...normalizeOwnedMeldList(player?.openSets, player, normalizedPosition, state, { allowUnowned: true }),
    ...normalizeOwnedMeldList(player?.sets, player, normalizedPosition, state, { allowUnowned: true }),
    // Generic `melds` is risky because some backends put all players' melds there.
    // Only accept it when the meld itself has owner metadata.
    ...normalizeOwnedMeldList(player?.melds, player, normalizedPosition, state, { allowUnowned: false }),
  ];

  const globallyOwnedMelds = [
    ...normalizeOwnedMeldList(state.openMelds, player, normalizedPosition, state, { allowUnowned: false }),
    ...normalizeOwnedMeldList(state.exposedMelds, player, normalizedPosition, state, { allowUnowned: false }),
    ...normalizeOwnedMeldList(state.declaredMelds, player, normalizedPosition, state, { allowUnowned: false }),
    ...normalizeOwnedMeldList(state.melds, player, normalizedPosition, state, { allowUnowned: false }),
  ];

  return dedupeMeldListBySignature([
    ...positionMappedMelds.map((meld) => ({ ...meld, ownerPosition: getMeldOwnerPosition(meld, state) || normalizedPosition })),
    ...playerSpecificMelds,
    ...globallyOwnedMelds,
  ]);
};

const upsertMeldEntry = (melds = [], nextMeld = {}, payload = {}) => {
  const normalizedMelds = normalizeMeldList(melds);
  const normalizedNext = normalizeMeldEntry(nextMeld);
  if (!normalizedNext) return normalizedMelds;

  const isPromotedKong = normalizeActionForUi(normalizedNext.type) === 'kong'
    && (payload.promotedFromPung || String(payload.kongType || '').toLowerCase() === 'promoted');

  if (!isPromotedKong) {
    const nextSignature = getMeldSignature(normalizedNext);
    return normalizedMelds.some((meld) => getMeldSignature(meld) === nextSignature)
      ? normalizedMelds
      : [...normalizedMelds, normalizedNext];
  }

  const targetMeldId = String(payload.meldId || normalizedNext.meldId || normalizedNext.id || '').trim();
  const targetBase = getMeldBaseTile(normalizedNext) || getKongBaseFromTile(payload.baseTile || payload.tileId || payload.targetTile);
  let replaced = false;

  const merged = normalizedMelds.map((meld) => {
    const meldId = String(meld.meldId || meld.id || '').trim();
    const meldType = String(meld.type || '').toLowerCase();
    const sameId = targetMeldId && meldId && targetMeldId === meldId;
    const sameBasePong = targetBase && ['pung', 'pong', 'pon'].includes(meldType) && getMeldBaseTile(meld) === targetBase;

    if (!sameId && !sameBasePong) return meld;

    replaced = true;
    return {
      ...meld,
      ...normalizedNext,
      type: 'kong',
      tiles: normalizedNext.tiles?.length ? normalizedNext.tiles : meld.tiles,
      rawTiles: normalizedNext.rawTiles?.length ? normalizedNext.rawTiles : meld.rawTiles,
      promotedFromPung: true,
    };
  });

  return replaced ? merged : [...merged, normalizedNext];
};

const removeLastMatchingTile = (tiles = [], rawTileId = '', renderedTileName = '') => {
  const list = toArray(tiles);
  if (!list.length) return { tiles: [], removed: false };

  const raw = String(rawTileId || '').trim();
  const rendered = String(renderedTileName || '').trim();
  let removeIndex = -1;

  for (let index = list.length - 1; index >= 0; index -= 1) {
    const tile = list[index];
    const tileRaw = String(getTileId(tile) || '').trim();
    const tileRendered = normalizeTileName(tile);

    if ((raw && tileRaw === raw) || (rendered && tileRendered === rendered)) {
      removeIndex = index;
      break;
    }
  }

  if (removeIndex < 0) return { tiles: list, removed: false };
  return { tiles: [...list.slice(0, removeIndex), ...list.slice(removeIndex + 1)], removed: true };
};

const hasMatchingTile = (tiles = [], rawTileId = '', renderedTileName = '') => (
  toArray(tiles).some((tile) => {
    const tileRaw = String(getTileId(tile) || '').trim();
    const tileRendered = normalizeTileName(tile);
    return (rawTileId && tileRaw === String(rawTileId)) || (renderedTileName && tileRendered === renderedTileName);
  })
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
  if (position === 'self' || position === 'me' || position === 'mine') return 'bottom';
  if (position === 'right') return '';
  return ['bottom', 'top', 'left', 'center'].includes(position) ? position : '';
};

const isBottomPosition = (position) => normalizePosition(position) === 'bottom';

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
    if (activeIds.some((id) => currentIds.includes(id))) {
      const currentSeat = getCurrentPlayerSeat(state, locationState, storedMatch);
      return getSeatPosition(currentSeat, state) || activePlayer?.position || '';
    }
  }

  const currentSeat = getCurrentPlayerSeat(state, locationState, storedMatch);
  if (currentSeat && activeSeat && normalizeSeat(currentSeat) === normalizeSeat(activeSeat)) {
    return getSeatPosition(currentSeat, state);
  }

  return useMockFallback ? 'bottom' : '';
};

const actionDefinitions = {
  chow: { labelKey: 'chow', className: 'blue' },
  pong: { labelKey: 'pong', className: 'green' },
  kong: { labelKey: 'kong', className: 'purple' },
  hu: { labelKey: 'win', className: 'orange' },
  pass: { labelKey: 'pass', className: 'black' },
  ron: { labelKey: 'win', className: 'orange' },
  tsumo: { labelKey: 'win', className: 'orange' },
};

function GameplayTile({ name, className = '', label = '' }) {
  const tileName = name || 'tile_back.png';

  return (
    <img
      className={`gameplay-tile ${className}`}
      src={asset(tileName)}
      alt={label}
      draggable="false"
      onError={(event) => {
        const img = event.currentTarget;
        if (img.dataset.tileFallbackApplied === 'true') return;
        img.dataset.tileFallbackApplied = 'true';
        img.src = asset('tile_back.png');
      }}
    />
  );
}

function TileFocusOverlay({ focus }) {
  if (!focus?.tileName) return null;

  const kind = String(focus.kind || 'tile').toLowerCase();
  const position = normalizePosition(focus.position || 'center') || 'center';
  const visibility = String(focus.visibility || 'public').toLowerCase();

  return (
    <div
      className={`gameplay-tile-focus gameplay-tile-focus--${kind} gameplay-tile-focus--${position} gameplay-tile-focus--${visibility}`}
      key={focus.id}
      aria-hidden="true"
    >
      <span className="gameplay-tile-focus-label">{focus.label || (kind === 'draw' ? 'DRAW' : 'DISCARD')}</span>
      <GameplayTile name={focus.tileName} className="gameplay-tile--focus" />
    </div>
  );
}

function ReclaimFeiPrompt({ windowState, t, onConfirm, onSkip, isPending = false }) {
  if (!windowState?.active) return null;

  const option = toArray(windowState.options)[0] || {};
  const meldTiles = toArray(option.meldTiles).filter(Boolean);
  const replacementTile = option.replacementTile || '';
  const feiTile = option.feiTile || 'fei.png';

  return (
    <div className="gameplay-fei-reclaim" role="dialog" aria-modal="true" aria-label={t('reclaimFeiTitle')}>
      <div className="gameplay-fei-reclaim-card">
        <span className="gameplay-fei-reclaim-kicker">FEI</span>
        <h2>{t('reclaimFeiTitle')}</h2>
        <p>{windowState.message || t('reclaimFeiBody')}</p>

        <div className="gameplay-fei-reclaim-tiles" aria-label={t('reclaimFeiMeld')}>
          <div className="gameplay-fei-reclaim-tile-group">
            <span>{t('reclaimFeiMeld')}</span>
            <div className="gameplay-fei-reclaim-tile-row">
              {meldTiles.length ? meldTiles.map((tile, index) => (
                <GameplayTile name={tile} key={`fei-reclaim-meld-${tile}-${index}`} />
              )) : (
                <GameplayTile name={feiTile} className="gameplay-tile--fei" />
              )}
            </div>
          </div>

          <div className="gameplay-fei-reclaim-arrow" aria-hidden="true">→</div>

          <div className="gameplay-fei-reclaim-tile-group">
            <span>{t('reclaimFeiReplacement')}</span>
            <div className="gameplay-fei-reclaim-tile-row">
              {replacementTile ? <GameplayTile name={replacementTile} /> : null}
              <GameplayTile name={feiTile} className="gameplay-tile--fei" />
            </div>
          </div>
        </div>

        <div className="gameplay-fei-reclaim-actions">
          <button type="button" className="gameplay-fei-reclaim-button confirm" onClick={() => onConfirm(option)} disabled={isPending}>
            {t('reclaimFeiConfirm')}
          </button>
          <button type="button" className="gameplay-fei-reclaim-button skip" onClick={() => onSkip(option)} disabled={isPending}>
            {t('reclaimFeiSkip')}
          </button>
        </div>
      </div>
    </div>
  );
}

const MAX_VISIBLE_BONUS_TILES = 4;
const MAX_VISIBLE_MELD_GROUPS = 3;
const MAX_VISIBLE_SIDE_MELD_GROUPS = 2;
const MAX_VISIBLE_MELD_TILES = 4;

function BonusTileRack({ position = 'left', tiles = [], label = 'BONUS', visible = false }) {
  const tileList = toArray(tiles).filter(Boolean);
  const visibleTiles = tileList.slice(0, MAX_VISIBLE_BONUS_TILES);
  const hiddenTileCount = Math.max(tileList.length - visibleTiles.length, 0);

  if (!visible && !tileList.length) return null;

  return (
    <div className={`gameplay-bonus-rack gameplay-bonus-rack--${position} ${tileList.length ? 'has-tiles' : 'empty'} ${hiddenTileCount ? 'has-overflow' : ''}`} aria-label={`${label} ${position}`}>
      <span className="gameplay-bonus-rack-label">{hiddenTileCount ? `${label} +${hiddenTileCount}` : label}</span>
      <div className="gameplay-bonus-rack-body">
        {tileList.length ? (
          <>
            {visibleTiles.map((tile, index) => (
              <GameplayTile name={tile} key={`bonus-${position}-${tile}-${index}`} />
            ))}
            {hiddenTileCount ? (
              <span className="gameplay-bonus-overflow-badge" aria-label={`${hiddenTileCount} more bonus tiles`}>+{hiddenTileCount}</span>
            ) : null}
          </>
        ) : Array.from({ length: 4 }).map((_, index) => (
          <span className="gameplay-bonus-empty-slot" key={`bonus-empty-${position}-${index}`} aria-hidden="true" />
        ))}
      </div>
    </div>
  );
}

function getMeldDisplayLabel(type = '') {
  const normalized = normalizeActionForUi(type);
  if (normalized === 'chow') return 'CHOW';
  if (normalized === 'pong') return 'PONG';
  if (normalized === 'kong') return 'KONG';
  if (normalized === 'hu') return 'HU';
  return 'MELD';
}

function PlayerMeldRack({ position = 'left', melds = [] }) {
  const meldList = normalizeMeldList(melds);
  const maxVisibleMeldGroups = position === 'left' ? MAX_VISIBLE_SIDE_MELD_GROUPS : MAX_VISIBLE_MELD_GROUPS;
  const visibleMeldList = meldList.slice(0, maxVisibleMeldGroups);
  const hiddenMeldCount = Math.max(meldList.length - visibleMeldList.length, 0);

  if (!meldList.length) return null;

  return (
    <div className={`gameplay-meld-rack gameplay-meld-rack--${position} ${hiddenMeldCount ? 'has-overflow' : ''}`} aria-label={`${position} open melds`}>
      {visibleMeldList.map((meld, meldIndex) => {
        const meldType = normalizeActionForUi(meld.type) || 'meld';
        const meldTiles = toArray(meld.tiles).filter(Boolean);
        const visibleMeldTiles = meldTiles.slice(0, MAX_VISIBLE_MELD_TILES);
        const hiddenTileCount = Math.max(meldTiles.length - visibleMeldTiles.length, 0);

        return (
          <div className={`gameplay-meld-group gameplay-meld-group--${meldType}`} key={`meld-${position}-${meldIndex}`}>
            <span className="gameplay-meld-label">{getMeldDisplayLabel(meldType)}</span>
            <div className="gameplay-meld-tiles">
              {visibleMeldTiles.map((tile, tileIndex) => (
                <GameplayTile name={tile} key={`meld-${position}-${meldIndex}-${tile}-${tileIndex}`} />
              ))}
              {hiddenTileCount ? (
                <span className="gameplay-meld-tile-overflow-badge" aria-label={`${hiddenTileCount} more meld tiles`}>+{hiddenTileCount}</span>
              ) : null}
            </div>
          </div>
        );
      })}
      {hiddenMeldCount ? (
        <div className="gameplay-meld-overflow-badge" aria-label={`${hiddenMeldCount} more melds`}>+{hiddenMeldCount}</div>
      ) : null}
    </div>
  );
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

function PlayerBadge({ variant = 'small', avatar, name, title = '', seatLabel = '', coins, className = '', isActiveTurn = false, turnLabel = '', isDealer = false, dealerLabel = 'Dealer' }) {
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
      <img
        src={resolveProfileAvatarSrc(avatar)}
        alt=""
        className="gameplay-player-avatar"
        draggable="false"
        onError={(event) => handleProfileAvatarError(event)}
      />
      {isDealer ? <span className="gameplay-dealer-chip">{dealerLabel}</span> : null}
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

function Compass({ round = 'East 1', timer = 30, turnLabel = 'YOUR TURN' }) {
  return (
    <div className="gameplay-center-compass" aria-label={`Round ${round}. ${turnLabel}`}>
      <span className="timer">{timer}</span>
      <span className="east">E</span>
      <strong>{round}</strong>
      <em>{turnLabel}</em>
      <span className="south">S</span>
      <span className="west">W</span>
    </div>
  );
}

const getDealerRollRows = (state = {}, players = []) => {
  const reveal = state.dealerRollReveal || {};
  const rolls = toArray(reveal.dealerRolls).length ? reveal.dealerRolls : toArray(state.dealerRolls);

  return rolls.map((roll = {}, index) => {
    const rollUserId = normalizeId(roll.userId || roll.playerId || roll.id);
    const player = toArray(players).find((candidate) => playerMatchesAnyId(candidate, [rollUserId])) || {};
    const dice = toArray(roll.dice).map((value) => Number(value) || 0).filter(Boolean);
    const total = Number(roll.total ?? roll.diceTotal ?? dice.reduce((sum, value) => sum + value, 0)) || 0;
    const seatLabel = roll.seatLabel || player.seatLabel || roll.seatWind || player.seat || '';

    return {
      key: rollUserId || `${seatLabel || 'seat'}_${index}`,
      userId: rollUserId,
      name: player.name || player.username || roll.username || `Player ${index + 1}`,
      position: getSeatPosition(roll.seatWind || player.seat, state) || normalizePosition(player.position) || '',
      seatLabel,
      isDealer: Boolean(roll.isDealer || player.isDealer || rollUserId === normalizeId(state.dealerUserId || reveal.dealerUserId)),
      dice,
      total,
      rollAttempt: Number(roll.rollAttempt || roll.attempt || 1) || 1,
      rerolled: Boolean(roll.rerolled),
      seatIndex: Number.isFinite(Number(roll.seatIndex ?? player.seatIndex)) ? Number(roll.seatIndex ?? player.seatIndex) : index,
    };
  }).sort((a, b) => a.seatIndex - b.seatIndex);
};

function DealerRollOverlay({ state = {}, players = [], t }) {
  const rows = getDealerRollRows(state, players);
  const status = String(state.status || '').toLowerCase();
  const reveal = state.dealerRollReveal || {};
  const phase = String(state.dealerRollPhase || reveal.phase || '').toLowerCase();
  const revealEndsAt = Number(state.dealerRollEndsAt || reveal.endsAt || 0) || 0;
  const revealStartedAt = Number(state.dealerRollStartedAt || reveal.startedAt || 0) || 0;
  const revealDurationMs = Number(state.dealerRollRevealMs || reveal.revealDurationMs || 7000) || 7000;
  const fallbackEndsAt = revealStartedAt ? revealStartedAt + revealDurationMs : 0;
  const effectiveEndsAt = revealEndsAt || fallbackEndsAt;
  const hasRevealExpired = effectiveEndsAt ? Date.now() >= effectiveEndsAt : false;
  const isComplete = phase === 'complete' || phase === 'completed';
  const isVisible = rows.length > 0 && !isComplete && !hasRevealExpired && (status === 'dealing' || phase === 'dealer_roll');

  if (!isVisible) return null;

  const dealerRow = rows.find((row) => row.isDealer) || rows[0];

  return (
    <div className="gameplay-dealer-roll-overlay" role="status" aria-live="polite">
      <div className="gameplay-dealer-roll-card">
        <span className="gameplay-dealer-roll-kicker">{t('determiningDealer')}</span>
        <h2>{t('dealerRollTitle')}</h2>
        <p>{t('dealerRollBody')}</p>

        <div className="gameplay-dealer-roll-list">
          {rows.map((row) => (
            <div className={`gameplay-dealer-roll-row ${row.isDealer ? 'is-dealer' : ''}`} key={row.key}>
              <div className="gameplay-dealer-roll-player">
                <strong>{row.name}</strong>
                <span>{row.seatLabel}{row.position ? ` • ${row.position}` : ''}</span>
              </div>
              <div className="gameplay-dealer-roll-dice" aria-label={`Dice total ${row.total}`}>
                {(row.dice.length ? row.dice : [0, 0]).map((die, index) => (
                  <span className="gameplay-dealer-die" key={`${row.key}-die-${index}`}>{die || '?'}</span>
                ))}
              </div>
              <strong className="gameplay-dealer-roll-total">{row.total}</strong>
              {row.isDealer ? <em>{t('dealer')}</em> : null}
            </div>
          ))}
        </div>

        {dealerRow ? (
          <div className="gameplay-dealer-roll-result">
            <span>{t('highestRollDealer')}</span>
            <strong>{dealerRow.name} — {dealerRow.seatLabel}</strong>
          </div>
        ) : null}
      </div>
    </div>
  );
}


function normalizeSeat(value) {
  const seat = String(value || '').trim().toLowerCase();
  const aliases = { east: 'e', south: 's', west: 'w' };
  return aliases[seat] || seat;
}

const ABSOLUTE_SEAT_POSITIONS = {
  e: 'bottom',
  s: 'top',
  w: 'left',
};

const ABSOLUTE_POSITION_ORDER = ['bottom', 'top', 'left'];

function getAbsoluteSeatPosition(seat) {
  return ABSOLUTE_SEAT_POSITIONS[normalizeSeat(seat)] || '';
}

function getAbsoluteSeatIndexPosition(seatIndex) {
  const index = Number(seatIndex);
  return Number.isFinite(index) ? (ABSOLUTE_POSITION_ORDER[index] || '') : '';
}

function getAbsolutePositionForPlayer(player = {}) {
  return getAbsoluteSeatPosition(player.seat || player.seatWind || player.wind || player.seatLabel)
    || getAbsoluteSeatIndexPosition(player.seatIndex);
}

function getAbsoluteSeatSortIndex(player = {}) {
  const position = getAbsolutePositionForPlayer(player);
  const positionIndex = ABSOLUTE_POSITION_ORDER.indexOf(position);
  if (positionIndex >= 0) return positionIndex;

  const seatIndex = Number(player.seatIndex);
  if (Number.isFinite(seatIndex)) return seatIndex;

  return 99;
}

function getRelativeSeatPosition(activeSeat, ownSeat, playerCount = 3) {
  const active = normalizeSeat(activeSeat);
  const own = normalizeSeat(ownSeat);

  if (!active || !own) return '';
  if (active === own) return 'bottom';

  // 3P turn/visual contract: own seat is bottom, next turn is top, third is left.
  const seats = playerCount > 3 ? ['e', 's', 'w', 'n'] : ['e', 's', 'w'];
  const activeIndex = seats.indexOf(active);
  const ownIndex = seats.indexOf(own);

  if (activeIndex < 0 || ownIndex < 0) return '';
  if (playerCount <= 2) return 'top';

  const offset = (activeIndex - ownIndex + seats.length) % seats.length;
  if (offset === 1) return 'top';
  if (offset === 2) return 'left';

  return '';
}

function getSeatPosition(seat, state = {}) {
  if (!seat) return '';

  const absolutePosition = getAbsoluteSeatPosition(seat);
  if (absolutePosition) return absolutePosition;

  const seatOrderEntry = toArray(state.seatOrder).find((entry) => normalizeSeat(entry.seatWind || entry.seat || entry.wind) === normalizeSeat(seat));
  const seatOrderPosition = normalizePosition(seatOrderEntry?.turnPosition || seatOrderEntry?.position);
  if (seatOrderPosition) return seatOrderPosition;

  const playerWithSeat = toArray(state.players).find((player) => normalizeSeat(player.seat) === normalizeSeat(seat));
  if (playerWithSeat?.position) return normalizePosition(playerWithSeat.position);

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
    wallRemaining: getWallRemainingValue(payload) ?? current.wallRemaining,
    turnStartedAt: Date.now(),
    availableActions: [],
    validActions: [],
    claimWindow: null,
    reclaimFei: null,
    pendingDiscardTileId: null,
    hasDiscardedThisTurn: false,
    turnEndedByDiscard: false,
    discardCountThisTurn: Number(payload.discardCountThisTurn || 0),
    canDiscard: payload.canDiscard ?? true,
    canPlayBonus: payload.canPlayBonus,
    playableBonusTiles: payload.playableBonusTiles || [],
    pendingKong: null,
    pendingClaimAction: null,
    pendingReclaimFei: null,
    pendingBonusTileId: null,
  };
}

function mergeDrawnTile(current, payload = {}) {
  const tile = payload.tileId || payload.tile || payload.drawnTile;
  if (!tile) return current;

  const handTiles = getFirstRawTileList(current.handTiles, current.myHand, current.playerHand);

  const nextHandTiles = handTiles.some((existingTile) => String(existingTile) === String(tile))
    ? handTiles
    : [...handTiles, tile];

  const renderedTile = tileIdToAssetName(tile);
  const tileFocus = buildTileFocus({
    kind: 'draw',
    payload,
    rawTileId: tile,
    tileName: renderedTile,
    position: 'bottom',
    visibility: 'private',
    label: 'DRAW',
  });

  return {
    ...current,
    drawnTile: tile,
    highlightedDrawnTile: { rawTileId: tile, tileName: renderedTile, id: tileFocus?.id || `${tile}_${Date.now()}` },
    tileFocus,
    handTiles: nextHandTiles,
    myHand: nextHandTiles,
    wallRemaining: getWallRemainingValue(payload) ?? current.wallRemaining,
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
    hasDiscardedThisTurn: current.hasDiscardedThisTurn || false,
    turnEndedByDiscard: current.turnEndedByDiscard || false,
    canDiscard: false,
    timer: timerDeadlineMs ? getSecondsRemaining(timerDeadlineMs) : nextTimeLimit,
    timeLimit: nextTimeLimit || current.timeLimit,
    timerDeadlineMs,
  };
}

function mergeFeiReclaimWindow(current, payload = {}) {
  const reclaimFei = normalizeReclaimFeiWindow(payload);
  if (!reclaimFei) return current;

  const nextTimeLimit = Number(payload.timeLimit ?? payload.timer ?? payload.remainingSeconds ?? current.timer ?? 0) || 0;
  const timerDeadlineMs = resolveTimerDeadlineMs(payload, nextTimeLimit);

  return {
    ...current,
    status: 'resolving',
    reclaimFei,
    timer: timerDeadlineMs ? getSecondsRemaining(timerDeadlineMs) : nextTimeLimit,
    timeLimit: nextTimeLimit || current.timeLimit,
    timerDeadlineMs,
  };
}

function mergeActionBroadcast(current, payload = {}) {
  const action = String(payload.action || '').toLowerCase();
  const tileId = payload.tileId || payload.tile || payload.discardedTile || payload.claimedTile;
  const isMeldAction = ['pung', 'pong', 'pon', 'kong', 'kan', 'chow', 'chi'].includes(action);
  const actionUserId = isMeldAction
    ? (payload.userId || payload.playerId || payload.activeUserId || payload.claimedBy || payload.claimedByUserId || payload.claimedByPlayerId || payload.claimerId || payload.actorId || payload.actorUserId)
    : (payload.userId || payload.playerId || payload.activeUserId || payload.discardedBy || payload.discardedByUserId || payload.discardedByPlayerId || payload.actorId || payload.actorUserId);
  const actionIds = getEntityIds({ id: actionUserId });
  const playerWithActionId = actionIds.length
    ? toArray(current.players).find((player) => playerMatchesAnyId(player, actionIds))
    : null;
  const seatPosition = getSeatPosition(
    payload.seat || payload.claimedBySeat || payload.claimerSeat || payload.actorSeat || (!isMeldAction ? payload.discardedBySeat : ''),
    current
  ) || playerWithActionId?.position || payload.position;

  if (!action) return current;

  const currentIds = getCurrentPlayerIdCandidates(current);
  const isLocalActionPlayer = isBottomPosition(seatPosition) || (actionIds.length && actionIds.some((id) => currentIds.includes(id)));
  const isLocalDiscard = action === 'discard' && isLocalActionPlayer;

  const next = {
    ...current,
    lastAction: payload,
    status: action === 'disconnected' || action === 'reconnected'
      ? current.status
      : (action === 'discard' ? 'resolving' : 'playing'),
    claimWindow: null,
    availableActions: [],
    validActions: [],
    pendingDiscardTileId: null,
    hasDiscardedThisTurn: isLocalDiscard ? true : (current.hasDiscardedThisTurn || false),
    turnEndedByDiscard: isLocalDiscard ? true : (current.turnEndedByDiscard || false),
    discardCountThisTurn: isLocalDiscard ? Number(payload.discardCountThisTurn || current.discardCountThisTurn || 1) : Number(current.discardCountThisTurn || 0),
    canDiscard: isLocalDiscard ? false : current.canDiscard,
    pendingKong: null,
    pendingClaimAction: null,
  };

  if (FEI_RECLAIM_AVAILABLE_ACTIONS.has(action)) {
    return mergeFeiReclaimWindow(next, payload);
  }

  if (FEI_RECLAIM_COMPLETE_ACTIONS.has(action)) {
    next.reclaimFei = null;
    next.pendingReclaimFei = null;
    const payloadHandTiles = getFirstRawTileList(payload.handTiles, payload.myHand, payload.playerHand, payload.remainingHand, payload.currentPlayerHand, payload.hand);
    const isReclaimConfirm = ['fei_reclaimed', 'reclaim_fei', 'reclaim_fei_confirmed', 'replace_fei'].includes(action);
    const isLocalReclaimPlayer = isBottomPosition(seatPosition) || (actionIds.length && actionIds.some((id) => currentIds.includes(id)));
    const replacementTileId = payload.replacementTileId || payload.actualTileId || payload.tileId;
    const feiTileId = payload.feiTileId || payload.feiTile || 'fei';
    const nextMeldTiles = getFirstTileList(payload.meldTiles, payload.tiles, payload.openMeld?.tiles, payload.meld?.tiles);
    const rawNextMeldTiles = getFirstRawTileList(payload.meldTiles, payload.tiles, payload.openMeld?.tiles, payload.meld?.tiles);

    if (payloadHandTiles.length) {
      next.handTiles = payloadHandTiles;
      next.myHand = payloadHandTiles;
      next.playerHand = payloadHandTiles;
    } else if (isReclaimConfirm && isLocalReclaimPlayer && replacementTileId) {
      const currentHandTiles = getFirstRawTileList(current.handTiles, current.myHand, current.playerHand);
      const handWithoutReplacement = removeOneTileFromHand(currentHandTiles, replacementTileId, tileIdToAssetName(replacementTileId));
      next.handTiles = feiTileId ? [...handWithoutReplacement, feiTileId] : handWithoutReplacement;
      next.myHand = next.handTiles;
      next.playerHand = next.handTiles;
    }

    if (isReclaimConfirm && nextMeldTiles.length && Array.isArray(current.players)) {
      next.players = current.players.map((player) => {
        const isTarget = (actionIds.length && playerMatchesAnyId(player, actionIds))
          || (seatPosition && normalizePosition(player.position) === seatPosition);
        if (!isTarget) return player;

        const currentOpenMelds = normalizeMeldList(player.openMelds || player.melds || player.exposedMelds || player.declaredMelds || []);
        const targetMeldId = String(payload.meldId || '').trim();
        const targetIndex = Number.isInteger(payload.meldIndex) ? payload.meldIndex : Number.parseInt(payload.meldIndex, 10);

        const openMelds = currentOpenMelds.map((meld, index) => {
          const meldId = String(meld.meldId || meld.id || '').trim();
          const isTargetMeld = (targetMeldId && meldId && targetMeldId === meldId) || (Number.isInteger(targetIndex) && targetIndex === index);
          return isTargetMeld ? { ...meld, tiles: nextMeldTiles, rawTiles: rawNextMeldTiles, hasFei: false } : meld;
        });

        return {
          ...player,
          openMelds,
          ...(isLocalReclaimPlayer && next.handTiles ? { handTiles: next.handTiles, hand: next.handTiles, tiles: next.handTiles } : {}),
        };
      });
    }
  }

  if (action === 'draw' || action === 'draw_dead_wall') {
    next.wallRemaining = getWallRemainingValue(payload) ?? current.wallRemaining;

    const shouldKeepPrivateLocalDraw = isLocalActionPlayer
      && current.tileFocus?.kind === 'draw'
      && current.tileFocus?.visibility === 'private'
      && (payload.animationId ? current.tileFocus?.id === payload.animationId : true);

    if (!shouldKeepPrivateLocalDraw) {
      next.tileFocus = buildTileFocus({
        kind: 'draw',
        payload,
        rawTileId: payload.tileVisibility === 'hidden' ? '' : tileId,
        tileName: payload.tileVisibility === 'hidden' ? (payload.tileBack || 'tile_back.png') : tileIdToAssetName(tileId),
        position: seatPosition || (isLocalActionPlayer ? 'bottom' : 'center'),
        visibility: payload.tileVisibility || 'hidden',
        label: 'DRAW',
      });
    }
  }

  if (action === 'bonus_tile_revealed' || action === 'bonus_tile_played' || action === 'play_bonus') {
    const revealedSource = [
      payload.revealedBonusTiles,
      payload.revealedBonus,
      payload.bonusTiles,
      payload.tiles,
    ].find((value) => Array.isArray(value) && value.length)
      || [payload.bonusTile || payload.revealedTile || payload.tileId || payload.tile].filter(Boolean);
    const revealedTiles = normalizeTileList(revealedSource);
    const positionToUpdate = normalizePosition(seatPosition);
    next.wallRemaining = getWallRemainingValue(payload) ?? current.wallRemaining;

    if ((actionIds.length || positionToUpdate) && Array.isArray(current.players)) {
      next.players = current.players.map((player) => {
        const isBonusPlayer = (actionIds.length && playerMatchesAnyId(player, actionIds))
          || (positionToUpdate && normalizePosition(player.position) === positionToUpdate);

        if (!isBonusPlayer) return player;

        const currentBonusTiles = getFirstTileList(
          player.bonusTiles,
          player.revealedBonusTiles,
          player.revealedBonus,
          player.bonus,
          player.flowers,
          player.seasons,
          player.animals
        );

        return {
          ...player,
          bonusTiles: revealedTiles.length
            ? appendUniqueTileList(currentBonusTiles, revealedTiles)
            : currentBonusTiles,
        };
      });
    }

    if (positionToUpdate && revealedTiles.length) {
      const bonusTilesByPosition = { ...(current.bonusTiles || {}) };
      bonusTilesByPosition[positionToUpdate] = appendUniqueTileList(bonusTilesByPosition[positionToUpdate], revealedTiles);
      next.bonusTiles = bonusTilesByPosition;
    }

    const replacementTileId = payload.replacementTile || payload.replacementTileId || payload.drawnTile || payload.drawnTileId || payload.replacement;
    if (action !== 'bonus_tile_revealed' && isLocalActionPlayer) {
      const currentHandTiles = getFirstRawTileList(current.handTiles, current.myHand, current.playerHand);
      const handWithoutBonus = removeOneTileFromHand(currentHandTiles, tileId, tileIdToAssetName(tileId));
      next.handTiles = replacementTileId && !handWithoutBonus.some((handTile) => String(handTile) === String(replacementTileId))
        ? [...handWithoutBonus, replacementTileId]
        : handWithoutBonus;
      next.myHand = next.handTiles;
      next.playerHand = next.handTiles;
      next.canPlayBonus = false;
      next.playableBonusTiles = [];
      next.pendingBonusTileId = null;
    }
  }

  if (action === 'discard' && tileId) {
    const renderedTile = tileIdToAssetName(tileId);
    const discards = { ...(current.discards || {}) };
    const currentIds = getCurrentPlayerIdCandidates(current);
    const isLocalDiscard = isBottomPosition(seatPosition) || (actionIds.length && actionIds.some((id) => currentIds.includes(id)));
    const key = seatPosition || (isLocalDiscard ? 'bottom' : 'center');

    discards[key] = [...normalizeTileList(discards[key]), renderedTile];
    next.discards = discards;

    const tileFocus = buildTileFocus({
      kind: 'discard',
      payload,
      rawTileId: tileId,
      tileName: renderedTile,
      position: key,
      visibility: 'public',
      label: 'DISCARD',
    });

    next.tileFocus = tileFocus;
    next.highlightedDiscard = {
      rawTileId: tileId,
      tileName: renderedTile,
      position: key,
      id: tileFocus?.id || `${key}_${tileId}_${Date.now()}`,
    };

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

  if (isMeldAction) {
    const uiAction = normalizeActionForUi(action);
    const meldTiles = getFirstTileList(
      payload.meldTiles,
      payload.tiles,
      payload.openMeld?.tiles,
      payload.meld?.tiles,
      payload.claimedTiles,
      payload.exposedTiles
    );
    const rawMeldTiles = getFirstRawTileList(
      payload.meldTiles,
      payload.tiles,
      payload.openMeld?.tiles,
      payload.meld?.tiles,
      payload.claimedTiles,
      payload.exposedTiles
    );
    const renderedClaimedTile = tileIdToAssetName(tileId);
    const isSelfDeclaredKong = uiAction === 'kong'
      && Boolean(payload.kongType || payload.concealed || payload.promotedFromPung)
      && !(payload.claimedTile || payload.discardedTile || payload.claimedTileId || payload.discardedTileId);
    const isPromotedKong = uiAction === 'kong'
      && (payload.promotedFromPung || String(payload.kongType || '').toLowerCase() === 'promoted');
    const handRemovalClaimedTileId = isSelfDeclaredKong ? '' : tileId;
    const handRemovalClaimedTile = isSelfDeclaredKong ? '' : renderedClaimedTile;
    const meldEntry = normalizeMeldEntry({
      type: uiAction,
      tiles: meldTiles,
      rawTiles: rawMeldTiles,
      claimedTile: tileId || payload.claimedTile || payload.discardedTile,
      fromPlayerId: payload.discardedBy || payload.discardedByUserId || payload.discardedByPlayerId || payload.shooterId || payload.fromPlayerId,
      fromSeat: payload.discardedBySeat || payload.shooterSeat || payload.fromSeat,
    });

    if (meldEntry) {
      const sourceIds = getEntityIds({
        id: payload.discardedBy || payload.discardedByUserId || payload.discardedByPlayerId || payload.shooterId || payload.fromPlayerId,
      });
      const sourcePosition = getSeatPosition(payload.discardedBySeat || payload.shooterSeat || payload.fromSeat, current);
      const positionToUpdate = normalizePosition(seatPosition);
      const ownerSeat = payload.seat || payload.claimedBySeat || payload.claimerSeat || payload.actorSeat || '';
      const ownedMeldEntry = {
        ...meldEntry,
        ...(payload.meldId || payload.openMeld?.id || payload.meld?.id ? { id: payload.meldId || payload.openMeld?.id || payload.meld?.id } : {}),
        ...(actionUserId ? { ownerId: actionUserId } : {}),
        ...(ownerSeat ? { ownerSeat } : {}),
        ...(positionToUpdate ? { ownerPosition: positionToUpdate } : {}),
      };
      const hasActionIdentity = Boolean(actionIds.length || positionToUpdate);
      const currentIds = getCurrentPlayerIdCandidates(current);
      const isLocalActionPlayer = isBottomPosition(positionToUpdate)
        || (actionIds.length && actionIds.some((id) => currentIds.includes(id)));
      const payloadHandTiles = getFirstRawTileList(
        payload.handTiles,
        payload.myHand,
        payload.playerHand,
        payload.remainingHand,
        payload.currentPlayerHand,
        payload.hand,
        payload.player?.handTiles,
        payload.player?.hand
      );

      if (isLocalActionPlayer) {
        const currentHandTiles = getFirstRawTileList(current.handTiles, current.myHand, current.playerHand);
        const nextHandTiles = payloadHandTiles.length
          ? payloadHandTiles
          : isPromotedKong
            ? removeOneTileFromHand(currentHandTiles, tileId, renderedClaimedTile)
            : removeMeldTilesFromHand(currentHandTiles, rawMeldTiles, meldTiles, handRemovalClaimedTileId, handRemovalClaimedTile);

        next.handTiles = nextHandTiles;
        next.myHand = nextHandTiles;
        next.playerHand = nextHandTiles;
      }

      if (Array.isArray(current.players)) {
        let removedFromPlayerDiscard = false;

        next.players = current.players.map((player) => {
          const isActionPlayer = (actionIds.length && playerMatchesAnyId(player, actionIds))
            || (positionToUpdate && normalizePosition(player.position) === positionToUpdate);
          const isSourcePlayer = (sourceIds.length && playerMatchesAnyId(player, sourceIds))
            || (sourcePosition && normalizePosition(player.position) === sourcePosition);
          const shouldFallbackRemove = !sourceIds.length
            && !sourcePosition
            && !isActionPlayer
            && !removedFromPlayerDiscard
            && hasMatchingTile(player.discards || player.discardTiles || [], tileId, renderedClaimedTile);

          if (isActionPlayer) {
            const currentOpenMelds = normalizeMeldList(player.openMelds || player.melds || player.exposedMelds || player.declaredMelds || []);
            const playerPrivateHand = getFirstRawTileList(player.handTiles, player.hand, player.tiles);
            const shouldUpdatePlayerHand = isLocalActionPlayer && playerPrivateHand.length;
            const nextPlayerHand = payloadHandTiles.length
              ? payloadHandTiles
              : isPromotedKong
                ? removeOneTileFromHand(playerPrivateHand, tileId, renderedClaimedTile)
                : removeMeldTilesFromHand(playerPrivateHand, rawMeldTiles, meldTiles, handRemovalClaimedTileId, handRemovalClaimedTile);
            const removedFromHandCount = isPromotedKong
              ? 1
              : isSelfDeclaredKong
                ? rawMeldTiles.length
                : Math.max(0, rawMeldTiles.length - (tileId ? 1 : 0));
            const nextHandSize = shouldUpdatePlayerHand
              ? nextPlayerHand.length
              : Math.max(0, Number(player.handSize ?? player.handCount ?? 0) - removedFromHandCount);

            return {
              ...player,
              openMelds: upsertMeldEntry(currentOpenMelds, ownedMeldEntry, payload),
              ...(shouldUpdatePlayerHand ? { handTiles: nextPlayerHand, hand: nextPlayerHand, tiles: nextPlayerHand } : {}),
              ...(Number.isFinite(nextHandSize) && nextHandSize > 0 ? { handSize: nextHandSize, handCount: nextHandSize } : {}),
            };
          }

          if ((isSourcePlayer || shouldFallbackRemove) && (tileId || renderedClaimedTile)) {
            const rawDiscards = player.discards || player.discardTiles || [];
            const { tiles: nextPlayerDiscards, removed } = removeLastMatchingTile(rawDiscards, tileId, renderedClaimedTile);
            removedFromPlayerDiscard = removedFromPlayerDiscard || removed;
            return {
              ...player,
              discards: nextPlayerDiscards,
              discardTiles: nextPlayerDiscards,
            };
          }

          return player;
        });
      }

      if (hasActionIdentity) {
        const openMeldsByPosition = { ...(current.openMelds || {}) };
        const currentPositionMelds = getFirstMeldList(openMeldsByPosition[positionToUpdate]);
        if (positionToUpdate) {
          openMeldsByPosition[positionToUpdate] = upsertMeldEntry(currentPositionMelds, ownedMeldEntry, payload);
          next.openMelds = openMeldsByPosition;
        }
      }

      if ((tileId || renderedClaimedTile) && !isSelfDeclaredKong) {
        const discards = { ...(current.discards || {}) };
        const priorityPositions = [sourcePosition, 'center', 'bottom', 'top', 'left'].filter(Boolean);
        const uniquePositions = priorityPositions.filter((position, index, list) => list.indexOf(position) === index);
        let removedFromStateDiscard = false;

        uniquePositions.forEach((position) => {
          if (removedFromStateDiscard && !sourcePosition) return;
          const { tiles: nextPositionDiscards, removed } = removeLastMatchingTile(discards[position] || [], tileId, renderedClaimedTile);
          if (removed) {
            discards[position] = nextPositionDiscards;
            removedFromStateDiscard = true;
          }
        });

        next.discards = discards;

        if (Array.isArray(current.centerTiles)) {
          next.centerTiles = removeLastMatchingTile(current.centerTiles, tileId, renderedClaimedTile).tiles;
        }
      }
    }
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
    wallRemaining: getWallRemainingValue(payload) ?? getWallRemainingValue(normalized) ?? normalized.wallRemaining,
    currentFan: payload.currentFan ?? payload.totalFan ?? payload.fanCount ?? normalized.currentFan,
    minimumFan: payload.minimumFan ?? payload.minFan ?? payload.requiredFan ?? normalized.minimumFan,
    fanInfo: payload.fanInfo || payload.fanSummary || payload.handEvaluation || payload.winPreview || normalized.fanInfo,
    reclaimFei: normalizeReclaimFeiWindow(payload) || normalizeReclaimFeiWindow(normalized),
    currentDiscard: payload.currentDiscard ?? normalized.currentDiscard,
    turnState: payload.turnState || normalized.turnState || null,
    hasDiscardedThisTurn: Boolean(payload.myTurnHasDiscarded ?? normalized.myTurnHasDiscarded ?? payload.hasDiscardedThisTurn ?? normalized.hasDiscardedThisTurn ?? false),
    turnEndedByDiscard: Boolean(payload.turnEndedByDiscard ?? normalized.turnEndedByDiscard ?? false),
    discardCountThisTurn: Number(payload.discardCountThisTurn ?? normalized.discardCountThisTurn ?? payload.turnState?.discardCount ?? normalized.turnState?.discardCount ?? 0) || 0,
    canDiscard: payload.canDiscard ?? normalized.canDiscard,
    canPlayBonus: payload.canPlayBonus ?? normalized.canPlayBonus,
    playableBonusTiles: payload.playableBonusTiles || normalized.playableBonusTiles || [],
    dealerRolls: payload.dealerRolls || normalized.dealerRolls || payload.dealerRollReveal?.dealerRolls || [],
    dealerRollReveal: payload.dealerRollReveal || normalized.dealerRollReveal || null,
    dealerRollRevealMs: payload.dealerRollRevealMs || payload.dealerRollReveal?.revealDurationMs || normalized.dealerRollRevealMs || 7000,
    dealerRollStartedAt: payload.dealerRollStartedAt || payload.dealerRollReveal?.startedAt || normalized.dealerRollStartedAt || null,
    dealerRollEndsAt: payload.dealerRollEndsAt || payload.dealerRollReveal?.endsAt || normalized.dealerRollEndsAt || null,
    dealerRollPhase: payload.dealerRollPhase || payload.dealerRollReveal?.phase || normalized.dealerRollPhase || null,
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
      activeTurnPosition: 'bottom',
      availableActions: DEFAULT_ACTIONS,
      wallRemaining: 52,
      currentFan: MINIMUM_FAN_TO_WIN,
      minimumFan: MINIMUM_FAN_TO_WIN,
      reclaimFei: null,
    } : {}),
    matchId: resolvedMatchId,
  }));
  const [gameError, setGameError] = useState('');
  const [isLeavingGame, setIsLeavingGame] = useState(false);
  const [displayTimer, setDisplayTimer] = useState(() => Number(gameState.timer ?? gameState.timeLimit ?? 0) || 0);
  const [areGameplayAssetsReady, setAreGameplayAssetsReady] = useState(() => typeof window === 'undefined');

  useEffect(() => {
    let cancelled = false;

    preloadGameplayAssets({ timeoutMs: 3000 })
      .catch(() => null)
      .finally(() => {
        if (!cancelled) {
          setAreGameplayAssetsReady(true);
        }
      });

    return () => {
      cancelled = true;
    };
  }, []);

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
        activeTurnPosition: 'bottom',
        availableActions: DEFAULT_ACTIONS,
        wallRemaining: normalizedMock.wallRemaining ?? 52,
        currentFan: normalizedMock.currentFan ?? MINIMUM_FAN_TO_WIN,
        minimumFan: normalizedMock.minimumFan ?? MINIMUM_FAN_TO_WIN,
        claimWindow: null,
        reclaimFei: null,
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
          setGameState((current) => mergeSynchronizedGameState(current || {}, payload, resolvedMatchId));
          setGameError('');
          break;
        case 'dealer_roll':
          setGameState((current) => {
            const now = Date.now();
            const payloadEndsAt = Number(payload.endsAt || 0) || 0;
            const currentIsPlaying = String(current?.status || '').toLowerCase() === 'playing';

            // Stale dealer-roll events can arrive after reconnect/navigation.
            // Never let them reopen the overlay or rewind a live game.
            if (currentIsPlaying && payloadEndsAt && payloadEndsAt <= now) {
              return current || EMPTY_SOCKET_GAME_STATE;
            }

            return {
              ...(current || EMPTY_SOCKET_GAME_STATE),
              status: currentIsPlaying ? current.status : 'DEALING',
              dealerRollReveal: payload,
              dealerRolls: payload.dealerRolls || current?.dealerRolls || [],
              dealerUserId: payload.dealerUserId || current?.dealerUserId,
              dealerSelectionMethod: payload.dealerSelectionMethod || current?.dealerSelectionMethod,
              dealerRollRevealMs: payload.revealDurationMs || current?.dealerRollRevealMs || 7000,
              dealerRollStartedAt: payload.startedAt || current?.dealerRollStartedAt || null,
              dealerRollEndsAt: payload.endsAt || current?.dealerRollEndsAt || null,
              dealerRollPhase: payload.phase || 'DEALER_ROLL',
              seatOrder: payload.seatOrder || current?.seatOrder || [],
              turnOrderPositions: payload.turnOrderPositions || current?.turnOrderPositions || [],
              rotation: payload.rotation || current?.rotation || 'bottom_top_left',
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
        case 'fei_reclaim_window':
          setGameState((current) => mergeFeiReclaimWindow(current || {}, payload));
          setGameError('');
          break;
        case 'action_broadcast':
        case 'tile_discarded':
          setGameState((current) => mergeActionBroadcast(current || {}, payload));
          break;
        case 'game_finished':
          setGameState((current) => {
            const currentPlayers = toArray(current?.players);
            const myPlayerId = payload.myPlayerId || payload.selfPlayerId || current?.myPlayerId || current?.selfPlayerId;
            const ownSummary = myPlayerId
              ? (payload.playerSummaries?.[myPlayerId] || payload.roundSummary?.playerStats?.[myPlayerId])
              : null;
            const resultPayload = {
              ...payload,
              myPlayerId,
              selfPlayerId: myPlayerId,
              players: Array.isArray(payload.players) && payload.players.length ? payload.players : currentPlayers,
              summaryRows: ownSummary?.summaryRows || payload.summaryRows || [],
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
          setGameState((current) => ({
            ...(current || {}),
            pendingDiscardTileId: null,
            pendingKong: null,
            pendingClaimAction: null,
            pendingReclaimFei: null,
          }));
          setGameError(getGameplayErrorMessage(payload, t));
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
      ['game:dealer_roll', (payload) => handleSocketMessage({ type: 'dealer_roll', payload })],
      ['game:sync_state', (payload) => handleSocketMessage({ type: 'game_state', payload })],
      ['game:turn_start', (payload) => handleSocketMessage({ type: 'turn_changed', payload })],
      ['player:drawn_tile', (payload) => handleSocketMessage({ type: 'drawn_tile', payload })],
      ['game:claim_window', (payload) => handleSocketMessage({ type: 'claim_window', payload })],
      ['game:fei_reclaim_window', (payload) => handleSocketMessage({ type: 'fei_reclaim_window', payload })],
      ['game:reclaim_fei_window', (payload) => handleSocketMessage({ type: 'fei_reclaim_window', payload })],
      ['game:fei_reclaim_available', (payload) => handleSocketMessage({ type: 'fei_reclaim_window', payload })],
      ['player:fei_reclaim_available', (payload) => handleSocketMessage({ type: 'fei_reclaim_window', payload })],
      ['player:reclaim_fei_available', (payload) => handleSocketMessage({ type: 'fei_reclaim_window', payload })],
      ['player:fei_reclaim_window', (payload) => handleSocketMessage({ type: 'fei_reclaim_window', payload })],
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

    const currentIdentityAvatar = currentIdentity.avatar
      || currentIdentity.avatarId
      || currentIdentity.avatarUrl
      || currentIdentity.imageUrl
      || currentIdentity.photoUrl
      || currentIdentity.icon
      || '';

    return seatPlayersForGameplay(sourcePlayers, expectedPlayerCount, currentPlayerIds, currentPlayerSeat)
      .map((player) => {
        const isCurrentPlayer = player.isCurrentPlayer
          || player.isMe
          || player.isSelf
          || playerMatchesAnyId(player, currentPlayerIds);

        if (!isCurrentPlayer || !currentIdentityAvatar) {
          return player;
        }

        const currentAvatar = player.avatar || player.avatarId || player.avatarUrl || player.imageUrl || player.photoUrl || player.icon || '';
        if (currentAvatar && !isDefaultProfileAvatarValue(currentAvatar)) {
          return player;
        }

        return {
          ...player,
          avatar: currentIdentityAvatar,
          avatarId: currentIdentity.avatarId || currentIdentityAvatar,
        };
      });
  }, [currentPlayerIds, currentPlayerSeat, expectedPlayerCount, gameApiAvailable, gameState, initialSocketPayload, location.state, storedMatch]);

  const fallbackCurrentPlayer = normalizeGameplayPlayer(getGameplayCurrentIdentity(gameState, location.state, storedMatch, initialSocketPayload), 0);
  const topPlayer = players.find((player) => player.position === 'top') || null;
  const sidePlayer = players.find((player) => player.position === 'left') || null;
  const bottomPlayer = players.find((player) => player.position === 'bottom') || { ...fallbackCurrentPlayer, position: 'bottom' };
  const realPlayerCount = players.filter((player) => !isGameplayPlaceholderPlayer(player)).length;
  const isLiveGameStateIncomplete = socketGameplayEnabled && !gameApiAvailable && realPlayerCount < expectedPlayerCount;
  const shouldShowSyncWarning = isLiveGameStateIncomplete && !gameState.activeUserId && !gameState.activeSeat && !gameState.claimWindow;
  const hasSidePlayer = expectedPlayerCount >= 3 && Boolean(sidePlayer);

  const activeTurnPosition = resolveActiveTurnPosition({
    state: gameState,
    players,
    locationState: location.state,
    storedMatch,
    useMockFallback: gameApiAvailable || isMockGameplay,
  });
  const localPlayer = players.find((player) => player.isCurrentPlayer || player.isMe || player.isSelf || playerMatchesAnyId(player, currentPlayerIds)) || null;
  const localPlayerPosition = localPlayer?.position || getSeatPosition(currentPlayerSeat, gameState) || '';
  const activeTurnIds = getEntityIds({
    id: gameState.currentTurnPlayerId || gameState.turnPlayerId || gameState.activeUserId || gameState.activePlayerId || gameState.turn?.playerId || gameState.turn?.userId,
  });
  const isUserTurn = activeTurnIds.length
    ? activeTurnIds.some((id) => currentPlayerIds.includes(id))
    : Boolean(localPlayerPosition && activeTurnPosition === localPlayerPosition);
  const activeTurnName = activeTurnPosition === 'top'
    ? (topPlayer?.name === 'BUNBUN' ? 'Bunbun' : topPlayer?.name || 'Waiting')
    : activeTurnPosition === 'left'
      ? (sidePlayer?.name || 'Waiting')
      : (bottomPlayer?.name || 'Waiting');
  const activeTurnLabel = activeTurnPosition
    ? (isUserTurn ? t('yourTurn') : `${activeTurnName}${t('turnSuffix')}`)
    : t('pleaseWaitMatch');

  const rawPlayerHandTiles = getFirstRawTileList(
    gameState.handTiles,
    gameState.playerHand,
    gameState.myHand,
    gameState.currentPlayerHand,
    ...(gameApiAvailable ? [getPlayerTileList(bottomPlayer, 'handTiles', 'hand', 'tiles')] : [])
  );
  const playerHandTiles = rawPlayerHandTiles
    .map((tile, index) => normalizeHandTileEntry(tile, index))
    .filter(Boolean);
  const bottomDiscardTiles = getVisibleDiscardTilesByPosition(gameState, bottomPlayer, 'bottom');
  const topDiscardTiles = getVisibleDiscardTilesByPosition(gameState, topPlayer, 'top');
  const sideDiscardTiles = hasSidePlayer ? getVisibleDiscardTilesByPosition(gameState, sidePlayer, 'left') : [];
  
  const bottomBonusTiles = getFirstTileList(bottomPlayer?.bonusTiles, gameState.bonusTiles?.bottom, gameState.bonusTiles?.left);
  const topBonusTiles = getFirstTileList(topPlayer?.bonusTiles, gameState.bonusTiles?.top);
  const sideBonusTiles = hasSidePlayer ? getFirstTileList(sidePlayer?.bonusTiles, gameState.bonusTiles?.left) : [];
  const shouldShowBonusRacks = isMockGameplay || bottomBonusTiles.length || topBonusTiles.length || sideBonusTiles.length;
  const wallRemaining = getWallRemainingValue(gameState);
  const fanInfo = getFanDisplayInfo(gameState, bottomPlayer);
  const shouldShowGameplayInfo = wallRemaining !== null || fanInfo.hasCurrentFan;
  const openMeldsByPosition = dedupeMeldRacksByOwnership({
    bottom: getOpenMeldsByPosition(gameState, bottomPlayer, 'bottom'),
    top: getOpenMeldsByPosition(gameState, topPlayer, 'top'),
    left: hasSidePlayer ? getOpenMeldsByPosition(gameState, sidePlayer, 'left') : [],
  }, gameState);
  const bottomOpenMelds = openMeldsByPosition.bottom;
  const topOpenMelds = openMeldsByPosition.top;
  const sideOpenMelds = openMeldsByPosition.left;
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
  const reclaimFeiWindow = normalizeReclaimFeiWindow(gameState.reclaimFei);
  const isReclaimFeiPending = Boolean(gameState.pendingReclaimFei);
  const isFeiReclaimBlocking = Boolean(reclaimFeiWindow?.active || isReclaimFeiPending);
  const hasUserDiscardedThisTurn = Boolean(gameState.hasDiscardedThisTurn || gameState.myTurnHasDiscarded);
  const canUserDiscard = Boolean(isUserTurn && gameState.canDiscard !== false && !hasUserDiscardedThisTurn && !isClaimWindowOpen && !isFeiReclaimBlocking && !gameState.pendingDiscardTileId && !gameState.currentDiscard);
  const canUserPlayBonus = Boolean(isUserTurn && gameState.canPlayBonus !== false && !hasUserDiscardedThisTurn && !isClaimWindowOpen && !isFeiReclaimBlocking && !gameState.pendingDiscardTileId && !gameState.pendingBonusTileId && !gameState.currentDiscard);
  const baseAvailableActions = getAvailableActions(gameState, false);
  const turnAvailableActions = isUserTurn && !hasUserDiscardedThisTurn && !isClaimWindowOpen && !isFeiReclaimBlocking
    ? baseAvailableActions.filter((action) => TURN_ONLY_ACTIONS.has(action))
    : [];
  const claimAvailableActions = isClaimWindowOpen && !isFeiReclaimBlocking
    ? baseAvailableActions.filter((action) => CLAIM_WINDOW_ONLY_ACTIONS.has(action) || action === 'hu')
    : [];
  const localKongPayload = getLocalKongCandidatePayload(playerHandTiles, bottomOpenMelds);
  const localKongAvailable = Boolean(isUserTurn && !hasUserDiscardedThisTurn && !isClaimWindowOpen && !isFeiReclaimBlocking && localKongPayload);
  const availableActions = localKongAvailable && !turnAvailableActions.includes('kong')
    ? [...turnAvailableActions, 'kong']
    : (isClaimWindowOpen ? claimAvailableActions : turnAvailableActions);


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

  const handleTileDiscard = (tileEntry) => {
    if (!(canUserDiscard || canUserPlayBonus) || isFeiReclaimBlocking) return;

    if (isClaimWindowOpen) {
      setGameError(t('claimWindowOpen'));
      return;
    }

    if (isFeiReclaimBlocking) {
      setGameError(t('resolveFeiReclaimFirst'));
      return;
    }

    const entry = normalizeHandTileEntry(tileEntry, tileEntry?.index ?? 0);
    if (!entry) return;

    const isBonusTile = isBonusTileName(entry);

    if (isFeiOrJokerTileName(entry)) {
      setGameError(t('feiLocked'));
      return;
    }

    const tileId = getTileId(entry);
    const renderedTile = entry.assetName;
    if (!tileId) return;

    if (isBonusTile) {
      if (!canUserPlayBonus) {
        setGameError(t('bonusTileUnavailable'));
        return;
      }

      if (isMockGameplay) {
        setGameState((current) => {
          const handTiles = removeOneTileFromHand(
            getFirstRawTileList(current.handTiles, current.myHand, current.playerHand),
            String(tileId),
            renderedTile
          );
          const bonusTiles = { ...(current.bonusTiles || {}) };
          bonusTiles.left = appendUniqueTileList(bonusTiles.left, [renderedTile]);

          return {
            ...(current || {}),
            handTiles,
            myHand: handTiles,
            playerHand: handTiles,
            bonusTiles,
          };
        });
        setGameError('');
        return;
      }

      const sent = playBonusTile(tileId);
      if (sent) {
        setGameState((current) => ({
          ...(current || {}),
          pendingBonusTileId: tileId,
        }));
        setGameError('');
      } else {
        setGameError(t('unablePlayBonusTile'));
      }
      return;
    }

    if (isMockGameplay) {
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
          playerHand: handTiles,
          discards,
          currentDiscard: renderedTile,
          pendingDiscardTileId: null,
          hasDiscardedThisTurn: true,
          turnEndedByDiscard: true,
          discardCountThisTurn: 1,
          canDiscard: false,
        };
      });
      setGameError('');
      return;
    }

    const sent = discardTile(tileId);
    if (sent) {
      setGameState((current) => ({
        ...(current || {}),
        pendingDiscardTileId: tileId,
        hasDiscardedThisTurn: true,
        turnEndedByDiscard: true,
        discardCountThisTurn: 1,
        canDiscard: false,
        availableActions: [],
        validActions: [],
      }));
      setGameError('');
    } else {
      setGameError('Unable to discard tile. Waiting for gameplay socket connection.');
    }
  };

  const handleMahjongAction = (actionKey) => {
    const normalizedAction = normalizeActionForUi(actionKey);
    const effectiveActionKey = normalizedAction || actionKey;
    setSelectedAction(effectiveActionKey);

    if (isFeiReclaimBlocking) {
      setGameError(t('resolveFeiReclaimFirst'));
      return;
    }

    if (!availableActions.includes(normalizedAction)) {
      setGameError(t('actionUnavailable'));
      return;
    }

    if (!isClaimWindowOpen && CLAIM_WINDOW_ONLY_ACTIONS.has(normalizedAction) && normalizedAction !== 'kong') {
      setGameError(t('claimWindowClosed'));
      return;
    }

    if (normalizedAction === 'pass' && !isClaimWindowOpen) {
      setGameError(t('claimWindowClosed'));
      return;
    }

    if (!isClaimWindowOpen && !isUserTurn) {
      setGameError(t('notYourTurn'));
      return;
    }

    if (isMockGameplay) {
      if (['chow', 'pong', 'kong'].includes(effectiveActionKey)) {
        const mockMeldTilesByAction = {
          chow: ['p_2.png', 'p_3.png', 'p_4.png'],
          pong: ['p_5.png', 'p_5.png', 'p_5.png'],
          kong: ['w_e.png', 'w_e.png', 'w_e.png', 'w_e.png'],
        };

        setGameState((current) => ({
          ...(current || {}),
          players: toArray(current?.players).map((player) => {
            if (!isBottomPosition(player.position)) return player;
            const currentOpenMelds = normalizeMeldList(player.openMelds || player.melds || []);
            return {
              ...player,
              openMelds: [
                ...currentOpenMelds,
                { type: effectiveActionKey, tiles: mockMeldTilesByAction[effectiveActionKey] || [] },
              ],
            };
          }),
        }));
      }
      setGameError('');
      return;
    }

    if (effectiveActionKey === 'pass') {
      const sent = passClaimWindow();
      if (sent) {
        setGameState((current) => ({ ...(current || {}), pendingClaimAction: 'skip' }));
        setGameError('');
      } else {
        setGameError('Unable to pass. Waiting for gameplay socket connection.');
      }
      return;
    }

    if (effectiveActionKey === 'hu') {
      if (fanInfo.hasCurrentFan && fanInfo.currentFan < fanInfo.minimumFan) {
        setGameError(t('minimumFanRequired'));
        return;
      }

      const sent = isClaimWindowOpen ? claimDiscard('ron') : declareWin('tsumo');
      if (sent) {
        setGameState((current) => ({ ...(current || {}), pendingClaimAction: isClaimWindowOpen ? 'ron' : 'tsumo' }));
        setGameError('');
      } else {
        setGameError('Unable to declare Hu. Waiting for gameplay socket connection.');
      }
      return;
    }

    if (effectiveActionKey === 'tsumo') {
      const sent = declareWin('tsumo');
      if (!sent) setGameError('Unable to declare win. Waiting for gameplay socket connection.');
      return;
    }

    if (effectiveActionKey === 'kong' && !isClaimWindowOpen) {
      if (!localKongPayload) {
        setGameError(t('kongUnavailable'));
        return;
      }
      const sent = declareKong(localKongPayload);
      if (sent) {
        setGameState((current) => ({ ...(current || {}), pendingKong: localKongPayload }));
        setGameError('');
      } else {
        setGameError('Unable to declare Kong. Waiting for gameplay socket connection.');
      }
      return;
    }

    const claimAction = CLAIM_ACTION_ALIASES[effectiveActionKey] || effectiveActionKey;
    const sent = claimDiscard(claimAction);
    if (sent) {
      setGameState((current) => ({ ...(current || {}), pendingClaimAction: claimAction }));
      setGameError('');
    } else {
      setGameError('Unable to send claim action. Waiting for gameplay socket connection.');
    }
  };

  const handleConfirmReclaimFei = (option = {}) => {
    const payload = buildFeiReclaimPayload(reclaimFeiWindow, option);

    if (isMockGameplay) {
      setGameState((current) => ({ ...(current || {}), reclaimFei: null, pendingReclaimFei: null }));
      setGameError('');
      return;
    }

    const sent = reclaimFei(payload);
    if (sent) {
      setGameState((current) => ({ ...(current || {}), pendingReclaimFei: payload }));
      setGameError('');
    } else {
      setGameError(t('unableReclaimFei'));
    }
  };

  const handleSkipReclaimFei = (option = {}) => {
    const payload = buildFeiReclaimPayload(reclaimFeiWindow, option);

    if (isMockGameplay) {
      setGameState((current) => ({ ...(current || {}), reclaimFei: null, pendingReclaimFei: null }));
      setGameError('');
      return;
    }

    const sent = skipFeiReclaim(payload);
    if (sent) {
      setGameState((current) => ({ ...(current || {}), reclaimFei: null, pendingReclaimFei: null }));
      setGameError('');
    } else {
      setGameError(t('unableSkipReclaimFei'));
    }
  };

  const getDiscardTileClassName = (tile, index, tiles, position) => (
    isLastHighlightedTile(tile, index, tiles, position, gameState.highlightedDiscard)
      ? 'gameplay-tile--highlighted gameplay-tile--discard-highlight'
      : ''
  );

  return (
    <section className={`gameplay-screen ${isMockGameplay ? 'gameplay-screen--mock' : ''}`} aria-label="Mahjong gameplay screen">
      <img className="gameplay-bg" src={asset('BG.png')} alt="" draggable="false" />
      <div className="gameplay-vignette" aria-hidden="true" />
      <div className="gameplay-sakura-particles" aria-hidden="true">
        {Array.from({ length: 18 }).map((_, index) => (
          <span key={index} />
        ))}
      </div>

      {!areGameplayAssetsReady ? (
        <div className="gameplay-asset-preload" role="status" aria-live="polite">
          <span>{t('loading')}</span>
        </div>
      ) : null}

      {gameError ? <div className="gameplay-error" role="alert">{gameError}</div> : null}
      {shouldShowSyncWarning ? (
        <div className="gameplay-error" role="status">
          Waiting for synchronized {expectedPlayerCount}P game state. Received {realPlayerCount}/{expectedPlayerCount} real players.
        </div>
      ) : null}

      <ReclaimFeiPrompt
        windowState={reclaimFeiWindow}
        t={t}
        onConfirm={handleConfirmReclaimFei}
        onSkip={handleSkipReclaimFei}
        isPending={isReclaimFeiPending}
      />

      <DealerRollOverlay state={gameState} players={players} t={t} />

      <header className="gameplay-room-title">
        <span>{t('room')}</span>
        <strong>{gameState.room?.name || 'My Sakura Room'}</strong>
      </header>

      {shouldShowGameplayInfo ? (
        <div className="gameplay-info-panel" aria-label="Gameplay information">
          {wallRemaining !== null ? (
            <div className="gameplay-info-item">
              <span>{t('wallRemaining')}</span>
              <strong>{wallRemaining}</strong>
            </div>
          ) : null}
          {fanInfo.hasCurrentFan ? (
            <div className="gameplay-info-item">
              <span>{t('fan')}</span>
              <strong>{fanInfo.currentFan}/{fanInfo.minimumFan}</strong>
            </div>
          ) : null}
        </div>
      ) : null}

      {topPlayer ? (
        <PlayerBadge
          className="top-player"
          variant="top"
          avatar={topPlayer.avatar}
          name={topPlayer.name === 'BUNBUN' ? 'Bunbun' : topPlayer.name}
          title={topPlayer.title}
          seatLabel={topPlayer.seatLabel}
          isDealer={Boolean(topPlayer.isDealer)}
          dealerLabel={t('dealer')}
          isActiveTurn={activeTurnPosition === 'top'}
          turnLabel={activeTurnPosition === 'top' ? activeTurnLabel : ''}
        />
      ) : null}

      <PlayerBadge
        className="bottom-player"
        variant="bottom"
        avatar={bottomPlayer.avatar}
        name={bottomPlayer.name === 'STEIVE' ? 'Stevie' : bottomPlayer.name}
        title={bottomPlayer.title}
        seatLabel={bottomPlayer.seatLabel}
        isDealer={Boolean(bottomPlayer.isDealer)}
        dealerLabel={t('dealer')}
        isActiveTurn={activeTurnPosition === 'bottom'}
        turnLabel={activeTurnPosition === 'bottom' ? activeTurnLabel : ''}
      />

      {hasSidePlayer ? (
        <PlayerBadge
          className="left-opponent-player"
          variant="left"
          avatar={sidePlayer.avatar}
          name={sidePlayer.name}
          title={sidePlayer.title}
          seatLabel={sidePlayer.seatLabel}
          isActiveTurn={activeTurnPosition === 'left'}
          turnLabel={activeTurnPosition === 'left' ? activeTurnLabel : ''}
        />
      ) : null}

      <main className="gameplay-table-zone">
        <img className="gameplay-table" src={asset('table.png')} alt="Mahjong table" draggable="false" />
        <div className="gameplay-middle-tray" aria-hidden="true" />
        <TileFocusOverlay key={gameState.tileFocus?.id || 'tile-focus'} focus={gameState.tileFocus} />

        <TileWall count={14} direction="horizontal" className="wall-top" />
        <TileWall count={13} direction="vertical" className="wall-left" />
        <TileWall count={14} direction="horizontal" className="wall-bottom" />

        <Compass round={gameState.round || 'East 1'} timer={displayTimer} turnLabel={activeTurnLabel} />

        <div className="gameplay-upper-discard" aria-label="Top discard tiles">
          {topDiscardTiles.map((tile, index) => (
            <GameplayTile name={tile} className={getDiscardTileClassName(tile, index, topDiscardTiles, 'top')} key={`${tile}-${index}`} />
          ))}
        </div>
        <BonusTileRack position="top" tiles={topBonusTiles} label={t('bonusTiles')} visible={shouldShowBonusRacks} />
        <PlayerMeldRack position="top" melds={topOpenMelds} />

        {hasSidePlayer ? (
          <>
            <div className="gameplay-side-discard" aria-label="Left opponent discard tiles">
              {sideDiscardTiles.map((tile, index) => (
                <GameplayTile name={tile} className={getDiscardTileClassName(tile, index, sideDiscardTiles, 'left')} key={`${tile}-${index}`} />
              ))}
            </div>
            <BonusTileRack position="left" tiles={sideBonusTiles} label={t('bonusTiles')} visible={shouldShowBonusRacks} />
            <PlayerMeldRack position="left" melds={sideOpenMelds} />
          </>
        ) : null}

        <div className="gameplay-center-discard" aria-label="Center meld tiles">
          {centerDiscardTiles.map((tile, index) => (
            <GameplayTile name={tile} className={getDiscardTileClassName(tile, index, centerDiscardTiles, 'center')} key={`${tile}-${index}`} />
          ))}
        </div>

        <div className="gameplay-bottom-discard" aria-label="Your discard tiles">
          {bottomDiscardTiles.map((tile, index) => (
            <GameplayTile name={tile} className={getDiscardTileClassName(tile, index, bottomDiscardTiles, 'bottom')} key={`${tile}-${index}`} />
          ))}
        </div>
        <BonusTileRack position="bottom" tiles={bottomBonusTiles} label={t('bonusTiles')} visible={shouldShowBonusRacks} />
        <PlayerMeldRack position="bottom" melds={bottomOpenMelds} />

        <div className="gameplay-hand" aria-label="Player hand tiles">
          {playerHandTiles.map((tile, index) => {
            const isLockedFei = isFeiOrJokerTileName(tile);
            const isBonusTile = isBonusTileName(tile);
            const assetName = tile.assetName;
            const isDrawnTileHighlight = tileMatchesHighlight(tile, gameState.highlightedDrawnTile);
            const isTileDisabled = isLockedFei || isFeiReclaimBlocking || (isBonusTile ? !canUserPlayBonus : !canUserDiscard);

            return (
              <button
                className={`gameplay-hand-tile ${isLockedFei ? 'gameplay-hand-tile--fei' : ''} ${isBonusTile ? 'gameplay-hand-tile--bonus' : ''} ${isDrawnTileHighlight ? 'gameplay-hand-tile--drawn-highlight' : ''}`}
                type="button"
                key={`${tile.rawId || assetName}-${index}`}
                data-tile-id={tile.rawId}
                aria-label={isLockedFei ? `${t('feiLocked')} ${index + 1}` : isBonusTile ? `${t('playBonusTile')} ${index + 1}` : `Tile ${index + 1}`}
                title={isLockedFei ? t('feiLocked') : isBonusTile ? t('playBonusTile') : undefined}
                disabled={isTileDisabled}
                onClick={() => handleTileDiscard(tile)}
              >
                <GameplayTile name={assetName} className={`${isLockedFei ? 'gameplay-tile--fei' : ''} ${isBonusTile ? 'gameplay-tile--bonus' : ''} ${isDrawnTileHighlight ? 'gameplay-tile--drawn-highlight' : ''}`} />
                {isLockedFei ? <span className="gameplay-fei-lock" aria-hidden="true">FEI</span> : null}
                {isBonusTile ? <span className="gameplay-bonus-play-label" aria-hidden="true">BONUS</span> : null}
              </button>
            );
          })}
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
              disabled={isFeiReclaimBlocking || hasUserDiscardedThisTurn || !availableActions.includes(actionKey) || (!isClaimWindowOpen && !isUserTurn)}
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
