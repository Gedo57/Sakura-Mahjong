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

const toArray = (value) => (Array.isArray(value) ? value : []);
const normalizeId = (value) => String(value ?? '').trim();

const getPlayerId = (player = {}) => player.id || player.userId || player.playerId || player._id || player.uid || player.socketId || '';

function getPrivateHandPlayer(players = []) {
  return toArray(players).find((player) => Array.isArray(player?.hand) && player.hand.length)
    || toArray(players).find((player) => Array.isArray(player?.handTiles) && player.handTiles.length)
    || null;
}

function getPrivateHandTilesFromPlayers(players = []) {
  const privatePlayer = getPrivateHandPlayer(players);
  return privatePlayer?.hand || privatePlayer?.handTiles || privatePlayer?.tiles || [];
}

function normalizeActionList(actions) {
  return toArray(actions)
    .map((action) => (typeof action === 'string' ? action : action?.type || action?.key || action?.name || action?.action))
    .map((action) => String(action || '').trim())
    .filter(Boolean)
    .filter((action, index, list) => list.indexOf(action) === index);
}

export function normalizePlayer(player = {}, index = 0) {
  const fallbackPositions = ['top', 'left', 'right', 'bottom'];
  const handTiles = player.handTiles || player.hand || player.tiles || [];
  const score = player.score ?? player.points ?? player.balance ?? player.coins ?? '0';

  return {
    ...player,
    id: getPlayerId(player),
    userId: player.userId || player.id || player.playerId || player._id || player.uid || '',
    name: getBackendPlayerName(player),
    username: player.username || getBackendPlayerName(player),
    avatar: player.avatar || player.avatarUrl || player.avatarId || player.imageUrl || player.icon || null,
    title: player.title || player.rankTitle || player.profileTitle || '',
    coins: score,
    score,
    position: player.position || fallbackPositions[index] || 'left',
    ready: Boolean(player.ready ?? player.isReady ?? true),
    seat: player.seat,
    seatLabel: player.seatLabel || player.seatName || player.seatTitle || '',
    isDealer: Boolean(player.isDealer ?? player.dealer),
    isRiichi: Boolean(player.isRiichi ?? player.riichi),
    isDisconnected: Boolean(player.isDisconnected ?? player.disconnected),
    handTiles,
    hand: player.hand || player.handTiles || [],
    handSize: player.handSize ?? player.handCount ?? player.tileCount ?? player.tilesCount ?? handTiles.length ?? 0,
    handCount: player.handCount ?? player.handSize ?? player.tileCount ?? player.tilesCount ?? handTiles.length ?? 0,
    discardTiles: player.discardTiles || player.discards || player.discardPile || player.discardedTiles || [],
    discards: player.discards || player.discardTiles || player.discardPile || player.discardedTiles || [],
    openMelds: player.openMelds || player.melds || [],
  };
}

export function normalizeGameState(response = {}) {
  const safeResponse = response && typeof response === 'object' ? response : {};
  const state = safeResponse.game || safeResponse.gameState || safeResponse.state || safeResponse;
  const players = Array.isArray(state.players)
    ? state.players.map(normalizePlayer)
    : [];
  const privateHandPlayer = getPrivateHandPlayer(players);
  const privateHand = getPrivateHandTilesFromPlayers(players);
  const claimWindow = state.claimWindow || state.claim || safeResponse.claimWindow || null;
  const availableActions = normalizeActionList(
    claimWindow?.yourValidActions
    || claimWindow?.validActions
    || claimWindow?.actions
    || state.yourValidActions
    || state.validActions
    || state.availableActions
    || state.actions
    || state.allowedActions
  );

  return {
    ...state,
    matchId: state.matchId || state.id || state.gameId || state.roomId || safeResponse.matchId,
    roomId: state.roomId || state.room?.roomId || state.room?.id || safeResponse.roomId,
    tierId: state.tierId || state.room?.tierId || safeResponse.tierId,
    room: state.room || safeResponse.room || { id: state.roomId, roomId: state.roomId, name: state.roomName },
    players,
    myPlayerId: state.myPlayerId || state.selfPlayerId || state.localPlayerId || getPlayerId(privateHandPlayer || {}),
    selfPlayerId: state.selfPlayerId || state.myPlayerId || getPlayerId(privateHandPlayer || {}),
    mySeat: state.mySeat || state.selfSeat || privateHandPlayer?.seat || state.seat,
    seat: state.seat || state.mySeat || privateHandPlayer?.seat,
    activeTurnPosition: state.activeTurnPosition || state.currentTurnPosition || state.turnPosition,
    currentTurnPlayerId: state.currentTurnPlayerId || state.turnPlayerId || state.activeUserId || state.activePlayerId,
    turnPlayerId: state.turnPlayerId || state.currentTurnPlayerId || state.activeUserId || state.activePlayerId,
    activeUserId: state.activeUserId || state.turnPlayerId || state.currentTurnPlayerId || state.activePlayerId,
    activeSeat: state.activeSeat || state.currentTurnSeat || state.turnSeat || state.turn?.seat,
    round: state.round || state.windRound || state.roundWind || 'East 1',
    roundWind: state.roundWind || state.windRound,
    turnNumber: state.turnNumber ?? state.turn?.number,
    wallRemaining: state.wallRemaining ?? state.wall?.remaining,
    currentDiscard: state.currentDiscard ?? state.discardedTile ?? state.lastDiscard,
    timer: state.timer ?? state.remainingSeconds ?? state.timeLimit ?? 18,
    handTiles: state.handTiles || state.playerHand || state.myHand || state.currentPlayerHand || privateHand || [],
    myHand: state.myHand || state.handTiles || state.playerHand || state.currentPlayerHand || privateHand || [],
    discards: state.discards || state.discardTiles || state.discardPiles || {},
    centerTiles: state.centerTiles || state.centerDiscardTiles || state.centerMeldTiles || state.meldTiles || state.melds?.center || [],
    claimWindow,
    availableActions,
    validActions: availableActions,
    maxPlayers: state.maxPlayers || state.room?.maxPlayers || safeResponse.maxPlayers,
    playerCount: state.playerCount || state.players?.length || safeResponse.playerCount,
    status: state.status || safeResponse.status,
    winner: state.winner || safeResponse.winner,
    winnerId: state.winnerId || safeResponse.winnerId,
    result: state.result || safeResponse.result,
  };
}

export function normalizeMatchmakingSession(response = {}) {
  const safeResponse = response && typeof response === 'object' ? response : {};
  const session = safeResponse.session || safeResponse.matchmaking || safeResponse;
  const match = safeResponse.match || session.match || null;
  const matchId = session.matchId || safeResponse.matchId || match?.id || match?.matchId || null;

  return {
    ...session,
    id: session.id || session.sessionId || safeResponse.sessionId,
    sessionId: session.sessionId || session.id || safeResponse.sessionId,
    status: session.status || safeResponse.status || (matchId ? 'found' : 'searching'),
    matchId,
    roomId: session.roomId || safeResponse.roomId || match?.roomId,
    players: Array.isArray(session.players)
      ? session.players.map(normalizePlayer)
      : [],
  };
}


const ROOM_TIER_SKINS = [
  { bg: 'room-card-green.png', character: 'panda.png', button: 'button-green.png', level: 'Beginner' },
  { bg: 'room-card-blue.png', character: 'fox.png', button: 'button-blue.png', level: 'Intermediate' },
  { bg: 'room-card-purple.png', character: 'bunny.png', button: 'button-violet.png', level: 'Advanced' },
  { bg: 'room-card-gold.png', character: 'bird.png', button: 'button-gold.png', level: 'Master' },
];

function getNestedValue(source, path) {
  return path.split('.').reduce((current, key) => (current && current[key] !== undefined ? current[key] : undefined), source);
}

function firstDefined(source, paths) {
  for (const path of paths) {
    const value = getNestedValue(source, path);
    if (value !== undefined && value !== null && value !== '') {
      return value;
    }
  }

  return undefined;
}

function formatCoins(value, fallback = '0') {
  if (value === null || value === undefined || value === '') return fallback;

  const cleanValue = typeof value === 'string' ? value.replace(/,/g, '').trim() : value;
  const numberValue = Number(cleanValue);
  return Number.isFinite(numberValue) ? numberValue.toLocaleString('en-US') : String(value);
}

function titleFromTierId(tierId = '') {
  const clean = String(tierId || 'sakura_garden_3p')
    .replace(/_?\d+p$/i, '')
    .replace(/[_-]+/g, ' ')
    .trim();

  return clean
    ? clean.replace(/\b\w/g, (letter) => letter.toUpperCase())
    : 'Sakura Garden';
}

export function normalizeRoomTier(tier = {}, index = 0) {
  const tierId = firstDefined(tier, ['tierId', 'id', '_id', 'roomId', 'slug', 'key']) || `room_tier_${index + 1}`;
  const entryFee = firstDefined(tier, [
    'entryFee.amount',
    'entryFee.value',
    'entryFee',
    'fee.amount',
    'fee.value',
    'fee',
    'bet.amount',
    'bet.value',
    'bet',
    'cost.amount',
    'cost.value',
    'cost',
  ]) ?? 0;
  const prizePool = firstDefined(tier, [
    'prizePool.amount',
    'prizePool.value',
    'prizePool',
    'prize.amount',
    'prize.value',
    'prize',
    'reward.amount',
    'reward.value',
    'reward',
  ]);
  const skin = ROOM_TIER_SKINS[index % ROOM_TIER_SKINS.length];
  const name = firstDefined(tier, ['name', 'title', 'roomName', 'displayName', 'label']) || titleFromTierId(tierId);
  const maxPlayers = Number(firstDefined(tier, ['maxPlayers', 'playersCount', 'playerLimit', 'capacity']) || String(tierId).match(/(\d+)p/i)?.[1] || 3);
  const onlinePlayers = firstDefined(tier, [
    'playersOnline',
    'onlinePlayers',
    'onlineCount',
    'playerCount',
    'players',
    'activePlayers',
    'stats.playersOnline',
    'stats.onlinePlayers',
  ]);
  const entryFeeAmount = Number(String(entryFee).replace(/,/g, '')) || 0;

  return {
    ...tier,
    id: tierId,
    roomId: tierId,
    tierId,
    title: String(firstDefined(tier, ['title', 'name', 'roomName', 'displayName']) || name).toUpperCase(),
    name,
    level: firstDefined(tier, ['level', 'difficulty', 'rank', 'tierName']) || skin.level,
    maxPlayers,
    players: formatCoins(onlinePlayers, '—'),
    fee: formatCoins(entryFee, '0'),
    bet: `${formatCoins(entryFee, '0')} coins`,
    entryFee: { amount: entryFeeAmount },
    prize: formatCoins(prizePool ?? entryFeeAmount * maxPlayers, '0'),
    bg: firstDefined(tier, ['bg', 'background', 'backgroundImage', 'cardBg']) || skin.bg,
    character: firstDefined(tier, ['character', 'avatar', 'icon', 'mascot']) || skin.character,
    button: firstDefined(tier, ['button', 'buttonImage']) || skin.button,
    status: firstDefined(tier, ['status', 'state']) || 'Available',
  };
}

export function normalizeRoomTierList(response = {}) {
  const list = response.tiers
    || response.roomTiers
    || response.rooms
    || response.data?.tiers
    || response.data?.roomTiers
    || response.data?.rooms
    || response.data?.results
    || response.results
    || response.data
    || response;
  return Array.isArray(list) ? list.map(normalizeRoomTier) : [];
}

export function normalizePrivateRoom(response = {}, requestPayload = {}) {
  const room = response.room || response.privateRoom || response.data || response;
  return {
    ...room,
    id: room.roomId || room.id || requestPayload.tierId,
    roomId: room.roomId || room.id || requestPayload.tierId,
    roomCode: room.roomCode || room.code || '',
    tierId: room.tierId || requestPayload.tierId,
    maxPlayers: Number(room.maxPlayers || requestPayload.maxPlayers || 3),
    status: room.status || 'created',
  };
}

export function normalizeRoom(room = {}) {
  return {
    ...room,
    id: room.id || room.roomId || room.slug || room.title,
    title: room.title || room.name || room.roomName || 'SAKURA ROOM',
    name: room.name || room.title || room.roomName || 'Sakura Room',
    level: room.level || room.tier || room.difficulty || 'Beginner',
    players: room.players ?? room.onlinePlayers ?? room.playerCount ?? '0',
    fee: room.fee ?? room.bet ?? room.entryFee ?? '500',
    prize: room.prize ?? room.prizePool ?? '2,000',
    bg: room.bg || room.background || 'room-card-green.png',
    character: room.character || room.avatar || 'panda.png',
    button: room.button || 'button-green.png',
  };
}

export function normalizeRoomList(response = []) {
  const list = response.rooms || response.featuredRooms || response.data || response;
  return Array.isArray(list) ? list.map(normalizeRoom) : [];
}

function normalizeScoreValue(value, fallback = 0) {
  if (value === null || value === undefined || value === '') return fallback;
  return value;
}

export function normalizeResultPlayer(player = {}, index = 0, winnerId = null) {
  const id = normalizeId(player.id || player.userId || player.playerId || player._id || `result_player_${index + 1}`);
  const score = normalizeScoreValue(
    player.scoreDelta ?? player.delta ?? player.pointsDelta ?? player.payout ?? player.reward ?? player.score,
    index === 0 ? 0 : 0
  );
  const totalScore = player.totalScore ?? player.finalScore ?? player.points ?? player.balance ?? player.scoreTotal;

  return {
    ...player,
    id,
    userId: player.userId || id,
    name: getBackendPlayerName(player) || (winnerId && id === normalizeId(winnerId) ? 'Winner' : 'Unknown player'),
    avatar: player.avatar || player.avatarUrl || player.avatarId || player.imageUrl || player.icon || player.resultAvatar || null,
    title: player.title || player.rankTitle || '',
    score,
    scoreDelta: score,
    payout: player.payout ?? score,
    totalScore,
    finalScore: player.finalScore ?? totalScore,
    isWinner: Boolean(player.isWinner ?? player.winner ?? (winnerId && id === normalizeId(winnerId))),
  };
}

function normalizeSummaryRows(result = {}) {
  const rows = result.summaryRows || result.roundSummary || result.summary || result.scoring || result.scoreBreakdown || [];

  if (Array.isArray(rows)) {
    return rows.map((row, index) => {
      if (Array.isArray(row)) {
        return { labelKey: row[0], value: row[1] };
      }

      return {
        id: row.id || `summary_${index + 1}`,
        label: row.label || row.name || row.title,
        labelKey: row.labelKey || row.key || row.translationKey,
        value: row.value ?? row.points ?? row.score ?? row.amount ?? '',
        valueKey: row.valueKey,
      };
    });
  }

  return Object.entries(rows).map(([labelKey, value]) => ({ labelKey, value }));
}

function buildResultPlayersFromMaps(result = {}, winnerId = null) {
  const payouts = result.payouts && typeof result.payouts === 'object' ? result.payouts : {};
  const finalScores = result.finalScores && typeof result.finalScores === 'object' ? result.finalScores : {};
  const sourcePlayers = toArray(result.players || result.results || result.standings || result.scoreboard || result.participants || result.room?.players || result.gameState?.players);
  const ids = Array.from(new Set([
    ...Object.keys(payouts),
    ...Object.keys(finalScores),
    ...sourcePlayers.map((player) => normalizeId(player.id || player.userId || player.playerId || player._id)).filter(Boolean),
    normalizeId(winnerId),
  ].filter(Boolean)));

  if (!ids.length) return [];

  return ids.map((id, index) => {
    const existing = sourcePlayers.find((player) => [player.id, player.userId, player.playerId, player._id].map(normalizeId).includes(id)) || {};
    return {
      ...existing,
      id,
      userId: existing.userId || id,
      scoreDelta: payouts[id] ?? existing.scoreDelta ?? existing.delta,
      payout: payouts[id] ?? existing.payout,
      totalScore: finalScores[id] ?? existing.totalScore ?? existing.finalScore,
      finalScore: finalScores[id] ?? existing.finalScore ?? existing.totalScore,
      isWinner: normalizeId(winnerId) === id || existing.isWinner || existing.winner,
    };
  });
}

export function normalizeGameResult(response = {}) {
  const safeResponse = response && typeof response === 'object' ? response : { result: response };
  const result = safeResponse.result && typeof safeResponse.result === 'object'
    ? safeResponse.result
    : safeResponse.gameResult || safeResponse.roundResult || safeResponse.data || safeResponse;
  const winnerId = result.winnerId || result.winner?.id || result.winner?.userId || safeResponse.winnerId;
  const playerList = buildResultPlayersFromMaps(result, winnerId);
  const players = Array.isArray(playerList)
    ? playerList.map((player, index) => normalizeResultPlayer(player, index, winnerId))
    : [];
  const normalizedWinner = result.winner && typeof result.winner === 'object'
    ? normalizeResultPlayer(result.winner, 0, winnerId)
    : players.find((player) => player.isWinner || normalizeId(player.id) === normalizeId(winnerId)) || players[0] || null;
  const resultType = typeof result.result === 'string'
    ? result.result
    : result.outcome || result.status || safeResponse.status || (normalizedWinner ? 'win' : '');
  const totalScore = result.totalScore
    ?? result.score
    ?? result.finalScore
    ?? (normalizedWinner ? (normalizedWinner.score ?? normalizedWinner.scoreDelta ?? normalizedWinner.payout) : undefined)
    ?? result.rewards?.coins;

  return {
    ...result,
    matchId: result.matchId || result.id || safeResponse.matchId,
    roomId: result.roomId || result.room?.id || safeResponse.roomId,
    tierId: result.tierId || result.room?.tierId || safeResponse.tierId,
    maxPlayers: result.maxPlayers || result.room?.maxPlayers || safeResponse.maxPlayers,
    status: result.status || safeResponse.status,
    result: resultType,
    reason: result.reason || safeResponse.reason,
    title: result.title || result.heading || (result.reason === 'forfeit' ? 'Won by forfeit' : undefined),
    titleKey: result.titleKey,
    winnerId,
    winner: normalizedWinner,
    players,
    winningHand: result.winningHand || [],
    winningTile: result.winningTile,
    yaku: result.yaku || [],
    han: result.han,
    isTsumo: result.isTsumo,
    payouts: result.payouts || {},
    finalScores: result.finalScores || {},
    summaryRows: normalizeSummaryRows(result),
    rewards: result.rewards || result.reward || safeResponse.rewards || {},
    totalScore,
  };
}
