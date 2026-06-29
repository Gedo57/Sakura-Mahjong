import { useEffect, useMemo, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { ROUTES, buildGameRoute } from '../router/routes.js';
import { getStoredAuthUser } from '../services/authService.js';
import { clearActiveMatch, clearMatchmakingContext, getMatchmakingContext, saveActiveMatch } from '../store/gameStore.js';
import { connectGameSocket, disconnectGameSocket, startPrivateGame } from '../services/socket.js';
import { useLanguage } from '../i18n/useLanguage.js';

const asset = (name) => `/assets/matchmaking/${name}`;
const DEFAULT_TIER_ID = ''; // No hardcoded tier. Real tierId must come from backend room tier selection.

const PROFILE_ASSET_ROOT = '/assets/profile/';
const PROFILE_AVATAR_STORAGE_KEY = 'sakura_profile_avatar';
const DEFAULT_PROFILE_AVATAR = 'ICO.png';
const GUEST_PLAYER_ID_STORAGE_KEY = 'sakura_guest_player_id';

const clampMatchPlayerCount = (value, fallback = 3) => {
  const numberValue = Number(value);
  if (!Number.isFinite(numberValue)) return fallback;
  return Math.max(2, Math.min(numberValue, 3));
};

const getPlayerCountFromId = (value) => {
  const match = String(value || '').match(/(\d+)p/i);
  return match ? clampMatchPlayerCount(match[1]) : null;
};

function getExpectedMatchPlayerCount(...sources) {
  for (const source of sources) {
    if (!source) continue;

    const idCount = getPlayerCountFromId(source.tierId || source.roomId || source.room?.tierId || source.room?.id || source.room?.roomId);
    if (idCount) return idCount;

    const explicitCount = source.maxPlayers
      ?? source.playerLimit
      ?? source.capacity
      ?? source.room?.maxPlayers
      ?? source.room?.playerLimit
      ?? source.room?.capacity;

    if (explicitCount !== undefined && explicitCount !== null && explicitCount !== '') {
      return clampMatchPlayerCount(explicitCount);
    }
  }

  return 3;
}

function getStableGuestPlayerId() {
  try {
    const existingId = window.sessionStorage.getItem(GUEST_PLAYER_ID_STORAGE_KEY);
    if (existingId) return existingId;

    const nextId = `guest_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    window.sessionStorage.setItem(GUEST_PLAYER_ID_STORAGE_KEY, nextId);
    return nextId;
  } catch {
    return `guest_${Math.random().toString(36).slice(2, 8)}`;
  }
}

function getStoredProfileAvatar() {
  try {
    return window.localStorage.getItem(PROFILE_AVATAR_STORAGE_KEY) || '';
  } catch {
    return '';
  }
}

function getCurrentPlayerIdentity() {
  const storedUser = getStoredAuthUser() || {};
  const storedAvatar = getStoredProfileAvatar();

  return {
    id: storedUser.id || storedUser.userId || storedUser._id || getStableGuestPlayerId(),
    userId: storedUser.userId || storedUser.id || storedUser._id,
    name: storedUser.username || storedUser.name || storedUser.displayName || storedUser.email || 'Current player',
    avatar: storedAvatar || storedUser.avatarUrl || storedUser.imageUrl || storedUser.avatar || storedUser.avatarId || DEFAULT_PROFILE_AVATAR,
  };
}

const normalizeId = (value) => String(value ?? '').trim();

function getPlayerIds(player = {}) {
  return [player.id, player._id, player.userId, player.playerId, player.uid, player.socketId, player.clientId]
    .map(normalizeId)
    .filter(Boolean);
}

function playersShareIdentity(player, ids = []) {
  if (!player || !ids.length) return false;
  return getPlayerIds(player).some((id) => ids.includes(id));
}

function isSearchingPlaceholder(player = {}) {
  const id = normalizeId(player.id || player.userId || player.playerId).toLowerCase();
  const name = normalizeId(player.name || player.username || player.displayName).toLowerCase();
  const avatar = normalizeId(player.avatar || player.avatarUrl || player.avatarId).toLowerCase();

  return Boolean(player.isSearching)
    || id.startsWith('searching_')
    || /^slot_\d+$/i.test(id)
    || /^slot\s*\d+$/i.test(name)
    || /^player\s*\d+$/i.test(name)
    || name === 'searching'
    || avatar.includes('icon_02_searching');
}

function getBackendLobbyPlayerName(player = {}) {
  return player.username
    || player.name
    || player.displayName
    || player.nickname
    || player.email
    || player.userId
    || player.id
    || player._id
    || '';
}

function normalizeLobbyPlayer(player = {}, index = 0) {
  const normalized = {
    ...player,
    id: player.id || player.userId || player._id || player.playerId || player.uid || player.socketId || `slot_${index + 1}`,
    userId: player.userId || player.id || player._id || player.playerId || player.uid || '',
    name: player.isSearching ? 'Searching' : getBackendLobbyPlayerName(player),
    username: player.username || getBackendLobbyPlayerName(player),
    avatar: player.avatar || player.avatarUrl || player.avatarId || player.imageUrl || player.photoUrl || player.icon,
  };

  const placeholder = isSearchingPlaceholder(normalized);
  return {
    ...normalized,
    ready: placeholder ? false : Boolean(player.ready ?? player.isReady ?? true),
    isSearching: placeholder,
  };
}

function getRealLobbyPlayers(players = []) {
  return (Array.isArray(players) ? players : [])
    .map(normalizeLobbyPlayer)
    .filter((player) => !isSearchingPlaceholder(player));
}

function getGameStartPlayers(players = []) {
  return (Array.isArray(players) ? players : [])
    .filter((player) => player && typeof player === 'object')
    .filter((player) => !isSearchingPlaceholder(normalizeLobbyPlayer(player)));
}

function getPrivateHandPlayer(players = []) {
  return getGameStartPlayers(players).find((player) => (
    (Array.isArray(player.hand) && player.hand.length)
    || (Array.isArray(player.handTiles) && player.handTiles.length)
    || (Array.isArray(player.tiles) && player.tiles.length)
  )) || null;
}

function getProfileAvatarSrc(avatar) {
  if (typeof avatar !== 'string' || !avatar.trim()) {
    return `${PROFILE_ASSET_ROOT}${DEFAULT_PROFILE_AVATAR}`;
  }

  const value = avatar.trim();

  if (/^(https?:)?\/\//i.test(value) || value.startsWith('/')) {
    return value;
  }

  if (/\.(png|jpe?g|webp|gif|svg)$/i.test(value)) {
    return `${PROFILE_ASSET_ROOT}${value}`;
  }

  const avatarMap = {
    stevie: 'avatar-stevie.png',
    kiki: 'avatar-kiki.png',
    bunbun: 'avatar-bunbun.png',
    panda: 'avatar-panda.png',
  };

  return `${PROFILE_ASSET_ROOT}${avatarMap[value] || DEFAULT_PROFILE_AVATAR}`;
}

function getMatchAvatarSrc(player) {
  if (player?.isCurrentPlayer) {
    return getProfileAvatarSrc(player.avatar);
  }

  const avatar = player?.avatar;

  if (typeof avatar === 'string' && avatar.trim()) {
    const value = avatar.trim();

    if (/^(https?:)?\/\//i.test(value) || value.startsWith('/')) {
      return value;
    }

    if (/^default(\.png)?$/i.test(value)) {
      return getProfileAvatarSrc(DEFAULT_PROFILE_AVATAR);
    }

    if (/^(avatar-|ICO\.png)/i.test(value)) {
      return getProfileAvatarSrc(value);
    }

    return asset(value);
  }

  return player?.ready ? getProfileAvatarSrc(DEFAULT_PROFILE_AVATAR) : asset('icon_02_searching.png');
}

function createFrontendSession(context) {
  const currentPlayer = getCurrentPlayerIdentity();
  const maxPlayers = getExpectedMatchPlayerCount(context);

  return {
    id: context.roomId || context.roomCode || 'socket_matchmaking',
    sessionId: context.roomId || context.roomCode || 'socket_matchmaking',
    status: context.roomCode ? 'waiting' : 'searching',
    roomId: context.roomId,
    roomCode: context.roomCode,
    tierId: context.tierId,
    maxPlayers,
    socketMode: true,
    isHost: Boolean(context.isHost),
    players: Array.from({ length: maxPlayers }, (_, index) => (
      index === 0
        ? {
          id: currentPlayer.id,
          name: currentPlayer.name,
          username: currentPlayer.name,
          avatar: currentPlayer.avatar,
          ready: true,
          isCurrentPlayer: true,
          isHost: Boolean(context.isHost),
        }
        : {
          id: `searching_${index}`,
          name: 'Searching',
          username: 'Searching',
          avatar: 'icon_02_searching.png',
          ready: false,
          isSearching: true,
        }
    )),
  };
}

function mergeCurrentPlayerIntoSession(session, context) {
  const fallbackSession = createFrontendSession(context);
  const currentPlayer = getCurrentPlayerIdentity();
  const currentIds = getPlayerIds(currentPlayer);
  const incomingPlayers = Array.isArray(session?.players) && session.players.length
    ? session.players.map(normalizeLobbyPlayer)
    : fallbackSession.players.map(normalizeLobbyPlayer);

  const maxPlayers = getExpectedMatchPlayerCount(context, session, fallbackSession);
  const realIncomingPlayers = incomingPlayers.filter((player) => !isSearchingPlaceholder(player));
  const currentFromBackend = realIncomingPlayers.find((player) => player.isCurrentPlayer || player.isMe || player.isSelf || playersShareIdentity(player, currentIds));
  const normalizedCurrentPlayer = normalizeLobbyPlayer({
    ...currentPlayer,
    ...(currentFromBackend || {}),
    name: currentFromBackend?.name || currentFromBackend?.username || currentPlayer.name,
    avatar: currentFromBackend?.avatar || currentPlayer.avatar,
    ready: true,
    isCurrentPlayer: true,
    isHost: Boolean(context.isHost || currentFromBackend?.isHost || currentFromBackend?.host),
  }, 0);

  const otherPlayers = realIncomingPlayers
    .filter((player) => !playersShareIdentity(player, getPlayerIds(normalizedCurrentPlayer)))
    .map((player) => ({ ...player, isCurrentPlayer: false, ready: Boolean(player.ready ?? true) }));

  const players = [normalizedCurrentPlayer, ...otherPlayers].slice(0, maxPlayers);

  while (players.length < maxPlayers) {
    const fallbackPlayer = fallbackSession.players[players.length];
    players.push(fallbackPlayer);
  }

  return {
    ...fallbackSession,
    ...(session || {}),
    maxPlayers,
    players,
  };
}

function AnimatedDots({ base, className = '' }) {
  const [dotCount, setDotCount] = useState(3);

  useEffect(() => {
    const timer = window.setInterval(() => {
      setDotCount((current) => (current === 3 ? 1 : current + 1));
    }, 430);

    return () => window.clearInterval(timer);
  }, []);

  return <span className={className}>{base}{'.'.repeat(dotCount)}</span>;
}

function PlayerSlot({ variant, avatar, name, ready, isCurrentPlayer = false, delay = 0, t }) {
  const displayName = name || (ready ? 'Waiting for player data' : t('searching'));
  return (
    <article className={`match-slot match-slot-${variant}`} style={{ '--slot-delay': `${delay}ms` }}>
      <div className="match-avatar-wrap">
        <img src={getMatchAvatarSrc({ avatar, isCurrentPlayer })} alt="" />
      </div>
      <h2>{displayName}</h2>
      {ready ? (
        <p className="match-ready"><span>✓</span>{t('ready')}</p>
      ) : (
        <p className="match-searching"><AnimatedDots base={t('searching')} /></p>
      )}
    </article>
  );
}

function getRequestedMatchmakingContext(locationState) {
  const storedContext = getMatchmakingContext() || {};

  return {
    roomId: locationState?.roomId || storedContext.roomId || '',
    roomCode: locationState?.roomCode || storedContext.roomCode || null,
    tierId: locationState?.tierId || storedContext.tierId || DEFAULT_TIER_ID,
    maxPlayers: getExpectedMatchPlayerCount(locationState, storedContext),
    source: locationState?.source || storedContext.source || 'unknown',
    isHost: Boolean(locationState?.isHost ?? storedContext.isHost),
  };
}

export default function MatchmakingPage() {
  const navigate = useNavigate();
  const { t } = useLanguage();
  const location = useLocation();
  const [seconds, setSeconds] = useState(12);
  const initialContext = getRequestedMatchmakingContext(location.state);
  const [session, setSession] = useState(() => createFrontendSession(initialContext));
  const latestSessionRef = useRef(session);
  const [errorMessage, setErrorMessage] = useState('');
  const [connectionStatus, setConnectionStatus] = useState('connecting');

  useEffect(() => {
    latestSessionRef.current = session;
  }, [session]);

  useEffect(() => {
    let isMounted = true;
    let gameWasStarted = false;
    const context = getRequestedMatchmakingContext(location.state);

    setSession(createFrontendSession(context));
    setErrorMessage('');
    setConnectionStatus('connecting');
    clearActiveMatch();

    const intervalId = window.setInterval(() => {
      setSeconds((current) => (current >= 59 ? 0 : current + 1));
    }, 1000);

    const responseTimeoutId = window.setTimeout(() => {
      if (isMounted && !gameWasStarted) {
        setErrorMessage('Connected, but the gameplay server has not returned a lobby event yet.');
      }
    }, 18000);

    const updateLobbySession = (payload = {}) => {
      if (!isMounted || gameWasStarted) return;

      lobbyEventReceived = true;
      window.clearTimeout(controllerJoinGuardId);
      setConnectionStatus(payload.status || 'waiting');
      setErrorMessage('');
      window.clearTimeout(responseTimeoutId);

      setSession((currentSession) => {
        const maxPlayers = getExpectedMatchPlayerCount(context, payload, currentSession);
        const nextSession = mergeCurrentPlayerIntoSession({
          ...currentSession,
          ...payload,
          id: payload.roomId || payload.id || currentSession?.id || context.roomId,
          sessionId: payload.roomId || payload.sessionId || currentSession?.sessionId || context.roomId,
          roomId: payload.roomId || currentSession?.roomId || context.roomId,
          roomCode: payload.roomCode || currentSession?.roomCode || context.roomCode,
          tierId: payload.tierId || currentSession?.tierId || context.tierId,
          maxPlayers,
          status: payload.status || currentSession?.status || 'searching',
          players: payload.players || currentSession?.players,
          hostUserId: payload.hostUserId || currentSession?.hostUserId,
          isHost: context.isHost || payload.isHost || currentSession?.isHost,
        }, context);

        latestSessionRef.current = nextSession;
        return nextSession;
      });
    };

    const openGame = (payload = {}) => {
      if (!isMounted || gameWasStarted) return;

      const matchId = payload.matchId || payload.gameId || payload.id || payload.roomId || context.roomId || context.roomCode || 'live_match';
      const latestSession = latestSessionRef.current || createFrontendSession(context);
      const expectedPlayers = getExpectedMatchPlayerCount(context, latestSession, payload);
      const gameStartPlayers = getGameStartPlayers(payload.players);
      const payloadPlayers = getRealLobbyPlayers(payload.players);
      const sessionPlayers = getRealLobbyPlayers(latestSession.players);
      const realPlayers = gameStartPlayers.length ? gameStartPlayers : (payloadPlayers.length ? payloadPlayers : sessionPlayers);
      const privateHandPlayer = getPrivateHandPlayer(realPlayers);
      const privateHandPlayerId = privateHandPlayer?.userId || privateHandPlayer?.id || privateHandPlayer?._id || privateHandPlayer?.playerId || '';
      const privateHandSeat = privateHandPlayer?.seat || privateHandPlayer?.seatLabel || '';
      const backendPlayerCount = Number(payload.playerCount ?? payload.playersCount ?? payload.currentPlayers ?? realPlayers.length) || realPlayers.length;

      // Do not block game:start only because the backend did not include full player profiles.
      // The game engine is already authoritative; missing names can be filled by sync/room updates later.
      if (backendPlayerCount < expectedPlayers) {
        lobbyEventReceived = true;
        setConnectionStatus('waiting');
        setErrorMessage(`Waiting for ${expectedPlayers} players before starting gameplay. Received ${backendPlayerCount}.`);
        setSession((currentSession) => {
          const nextSession = mergeCurrentPlayerIntoSession({
            ...currentSession,
            ...payload,
            maxPlayers: expectedPlayers,
            status: 'waiting',
            players: realPlayers.length ? realPlayers : currentSession?.players,
          }, context);
          latestSessionRef.current = nextSession;
          return nextSession;
        });
        return;
      }

      lobbyEventReceived = true;
      gameWasStarted = true;
      window.clearTimeout(responseTimeoutId);
      window.clearTimeout(controllerJoinGuardId);
      setConnectionStatus('starting');
      clearMatchmakingContext();
      saveActiveMatch({
        matchId,
        roomId: payload.roomId || context.roomId,
        roomCode: payload.roomCode || context.roomCode,
        tierId: payload.tierId || context.tierId,
        maxPlayers: expectedPlayers,
        players: realPlayers,
        initialGameState: {
          ...payload,
          players: realPlayers,
          maxPlayers: expectedPlayers,
          playerCount: expectedPlayers,
          myPlayerId: payload.myPlayerId || payload.selfPlayerId || privateHandPlayerId || getCurrentPlayerIdentity().id,
          selfPlayerId: payload.selfPlayerId || payload.myPlayerId || privateHandPlayerId || getCurrentPlayerIdentity().id,
          mySeat: payload.mySeat || payload.selfSeat || privateHandSeat,
          seat: payload.seat || payload.mySeat || payload.selfSeat || privateHandSeat,
        },
        socketMode: true,
      });

      window.setTimeout(() => {
        if (isMounted) {
          navigate(buildGameRoute(matchId), {
            state: {
              matchId,
              roomId: payload.roomId || context.roomId,
              roomCode: payload.roomCode || context.roomCode,
              maxPlayers: expectedPlayers,
              players: realPlayers,
              initialGameState: {
                ...payload,
                players: realPlayers,
                maxPlayers: expectedPlayers,
                playerCount: expectedPlayers,
                myPlayerId: payload.myPlayerId || payload.selfPlayerId || privateHandPlayerId || getCurrentPlayerIdentity().id,
                selfPlayerId: payload.selfPlayerId || payload.myPlayerId || privateHandPlayerId || getCurrentPlayerIdentity().id,
                mySeat: payload.mySeat || payload.selfSeat || privateHandSeat,
                seat: payload.seat || payload.mySeat || payload.selfSeat || privateHandSeat,
              },
              socketMode: true,
            },
          });
        }
      }, 450);
    };

    const handleSocketMessage = (message) => {
      const payload = message?.payload || {};

      switch (message?.type) {
        case 'queue_joined':
          updateLobbySession({ ...payload, status: payload.status || 'searching' });
          break;
        case 'private_joined':
          updateLobbySession({ ...payload, status: payload.status || 'waiting' });
          break;
        case 'room_state_update':
          updateLobbySession({ ...payload, status: payload.status || 'waiting' });
          break;
        case 'game_start':
        case 'game_state':
          openGame(payload);
          break;
        case 'error': {
          const errorText = payload.message || payload.error || payload.reason || 'Socket error. Please try again.';
          // Backend can return this if an old duplicate room:join reaches the queue.
          // Keep the UI in matchmaking instead of stopping the player.
          if (/already\s+in\s+the\s+queue/i.test(errorText)) {
            setConnectionStatus('searching');
            setErrorMessage('');
            break;
          }

          if (isMounted) {
            setConnectionStatus('error');
            setErrorMessage(errorText);
          }
          break;
        }
        default:
          break;
      }
    };

    let lobbyEventReceived = false;
    let controllerJoinGuardId = null;
    let socket = null;
    let roomJoinSent = false;
    let roomJoinPayloadKey = '';

    const emitRoomJoin = (rawSocket = null) => {
      const code = String(context.roomCode || '').trim();
      const eventName = 'room:join';
      const tierId = String(context.tierId || '').trim();
      const payload = code
        ? { roomCode: code }
        : tierId
          ? { tierId }
          : null;

      if (!payload) {
        console.error('[matchmaking] room:join blocked: missing tierId/roomCode', context);
        if (isMounted) {
          setConnectionStatus('error');
          setErrorMessage('Missing tierId or roomCode. Select a real backend room tier first.');
        }
        return false;
      }

      const nextPayloadKey = JSON.stringify(payload);
      if (roomJoinSent && roomJoinPayloadKey === nextPayloadKey) {
        console.info('[matchmaking] skip duplicate room:join', payload);
        return true;
      }

      let joined = false;

      if (rawSocket?.connected && typeof rawSocket.emit === 'function') {
        rawSocket.emit(eventName, payload);
        joined = true;
      } else if (socket?.raw?.connected && typeof socket.raw.emit === 'function') {
        socket.raw.emit(eventName, payload);
        joined = true;
      } else if (socket?.connected && typeof socket.emit === 'function') {
        joined = Boolean(socket.emit(eventName, payload));
      }

      if (joined) {
        roomJoinSent = true;
        roomJoinPayloadKey = nextPayloadKey;
      }

      console.info('[matchmaking] emit room:join', payload, {
        joined,
        rawConnected: Boolean(rawSocket?.connected),
        controllerConnected: Boolean(socket?.connected),
        hasRaw: Boolean(socket?.raw),
      });

      if (!joined && isMounted) {
        setConnectionStatus('connected');
        setErrorMessage('Socket connected, waiting to send room:join...');
        return false;
      }

      return true;
    };

    const joinRequestedRoom = (rawSocket = null) => {
      const code = String(context.roomCode || '').trim();
      setConnectionStatus(code ? 'joining_private' : 'searching');
      emitRoomJoin(rawSocket);

      // Do not retry room:join after a successful emit. The backend charges the match fee
      // on room:join, so duplicate emits can create duplicate deductions and
      // "User is already in the queue" errors.
      window.clearTimeout(controllerJoinGuardId);
    };

    socket = connectGameSocket({
      onOpen: (rawSocket) => {
        if (!isMounted) return;
        setConnectionStatus('connected');
        joinRequestedRoom(rawSocket);
      },
      onMessage: handleSocketMessage,
      onError: (error) => {
        console.error('Game socket failed:', error);
        if (isMounted) {
          setConnectionStatus('error');
          setErrorMessage(error?.message || 'Unable to connect to gameplay server.');
        }
      },
      onClose: () => {
        if (isMounted && !gameWasStarted) {
          setConnectionStatus('disconnected');
          setErrorMessage('Gameplay socket disconnected. Reconnecting if the server allows it.');
        }
      },
    });

    // Extra guard: if the connect callback was missed because of a hot reload or StrictMode remount,
    // still send room:join on the active connected controller.
    controllerJoinGuardId = window.setTimeout(() => {
      if (isMounted && !gameWasStarted && !lobbyEventReceived && !roomJoinSent && socket?.raw?.connected) {
        joinRequestedRoom(socket.raw);
      }
    }, 800);

    return () => {
      isMounted = false;
      window.clearInterval(intervalId);
      window.clearTimeout(responseTimeoutId);
      window.clearTimeout(controllerJoinGuardId);

      if (!gameWasStarted) {
        disconnectGameSocket();
      }
    };
  }, [location.state, navigate]);

  const currentContext = getRequestedMatchmakingContext(location.state);
  const canStartPrivateGame = Boolean(currentContext.isHost && (session.roomId || currentContext.roomId));

  const handleStartPrivateGame = () => {
    const roomId = session.roomId || currentContext.roomId;

    if (!roomId) {
      setConnectionStatus('error');
      setErrorMessage('Room ID is missing. Wait for the private lobby event before starting.');
      return;
    }

    setConnectionStatus('starting');
    const started = startPrivateGame(roomId);

    if (!started) {
      setConnectionStatus('error');
      setErrorMessage('Unable to start private game. Waiting for socket connection.');
    }
  };

  const waitTime = useMemo(() => `00:${String(seconds).padStart(2, '0')}`, [seconds]);
  const statusText = errorMessage || {
    connecting: 'Connecting to gameplay server...',
    connected: 'Connected. Joining lobby...',
    joining_private: 'Joining private lobby...',
    searching: t('pleaseWaitMatch'),
    waiting: t('pleaseWaitMatch'),
    starting: 'Starting game...',
    disconnected: 'Gameplay socket disconnected. Reconnecting...',
  }[connectionStatus] || t('pleaseWaitMatch');

  return (
    <section className="matchmaking-screen">
      <img className="match-bg" src={asset('BG.png')} alt="" />
      <div className="match-vignette" aria-hidden="true" />

      <header className="matchmaking-header">
        <button type="button" className="match-back-button" onClick={() => navigate(ROUTES.mainMenu)} aria-label={t('backToMainMenu')}>
          ←
        </button>
        <h1>{t('matchmakingTitle')}</h1>
      </header>

      <main className="matchmaking-content">
        <div className="matchmaking-title-block">
          <h2>
            {session.roomCode 
              ? t('privateLobby') || 'PRIVATE LOBBY' 
              : <AnimatedDots base={t('findingPlayers')} />}
          </h2>
          <p>{statusText}</p>
          {session.roomCode && (
            <div className="match-room-code-display" style={{ marginTop: '1rem', padding: '0.5rem 1rem', background: 'rgba(0,0,0,0.4)', borderRadius: '8px', display: 'inline-flex', alignItems: 'center', gap: '1rem' }}>
              <span>{t('roomCode')}: <strong>{session.roomCode}</strong></span>
              <button 
                type="button" 
                onClick={() => {
                  navigator.clipboard?.writeText(session.roomCode);
                  alert(t('roomCodeCopied') || 'Room code copied!');
                }}
                style={{ padding: '4px 12px', background: '#e0b875', color: '#3b2512', border: 'none', borderRadius: '4px', cursor: 'pointer', fontWeight: 'bold' }}
              >
                {t('copyCode') || 'Copy'}
              </button>
            </div>
          )}
        </div>

        <section className="match-slots" aria-label={t('matchmaking')}>
          <div className="match-line" aria-hidden="true" />
          {(session.players?.length ? session.players : createFrontendSession(initialContext).players).map((player, index) => (
            <PlayerSlot
              key={player.id || `${player.name}-${index}`}
              variant={player.isCurrentPlayer ? 'current' : player.ready ? 'ready' : 'search'}
              avatar={player.avatar}
              name={player.name}
              ready={player.ready}
              isCurrentPlayer={player.isCurrentPlayer}
              delay={index * 110}
              t={t}
            />
          ))}
        </section>

        <div className="match-wait-time">
          <span>{t('estimatedWait')}</span>
          <strong>{waitTime}</strong>
        </div>

        {canStartPrivateGame && (
          <button
            type="button"
            className="match-start-button"
            onClick={handleStartPrivateGame}
          >
            START GAME
          </button>
        )}

        <button
          type="button"
          className="match-cancel-button"
          onClick={() => {
            disconnectGameSocket();
            clearMatchmakingContext();
            navigate(ROUTES.mainMenu);
          }}
        >
          {t('cancel')}
        </button>
      </main>
    </section>
  );
}
