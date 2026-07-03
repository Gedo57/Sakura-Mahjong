import { useEffect, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { ROUTES, buildGameRoute } from '../router/routes.js';
import { getStoredAuthUser } from '../services/authService.js';
import { clearMatchmakingContext, getMatchmakingContext, saveActiveMatch } from '../store/gameStore.js';
import { connectGameSocket, disconnectGameSocket, startPrivateGame, leaveLobby } from '../services/socket.js';
import { useLanguage } from '../i18n/useLanguage.js';
import { handleProfileAvatarError, resolveProfileAvatarSrc } from '../utils/avatarAssets.js';

const DEFAULT_AVATAR = 'stevie';

function getAvatarSrc(avatar) {
  return resolveProfileAvatarSrc(avatar, DEFAULT_AVATAR);
}

function isBotLobbyPlayer(player = {}, playerId = '') {
  return Boolean(player.isBot)
    || String(playerId || player.userId || player.id || '').startsWith('bot:')
    || /^bot[_:-]/i.test(String(playerId || player.userId || player.id || ''));
}

function getCurrentUser() {
  const u = getStoredAuthUser() || {};
  return {
    id: u.id || u.userId || u._id || '',
    username: u.username || u.name || u.displayName || 'You',
    avatar: u.avatarUrl || u.imageUrl || u.avatar || u.avatarId || DEFAULT_AVATAR,
  };
}

function isSoloPayload(payload = {}) {
  return Boolean(payload.isSolo || payload.enableBots || payload.botsEnabled || payload.mode === 'solo' || payload.type === 'solo');
}

export default function PrivateLobbyPage() {
  const navigate = useNavigate();
  const { t } = useLanguage();
  const location = useLocation();
  const currentUser = getCurrentUser();

  const ctx = location.state || getMatchmakingContext() || {};
  const roomIdRef = useRef(ctx.roomId || '');
  const roomCodeRef = useRef(ctx.roomCode || '');
  const isHostRef = useRef(Boolean(ctx.isHost));
  const isSoloRef = useRef(isSoloPayload(ctx));
  const maxPlayersRef = useRef(3);

  const [roomId, setRoomId] = useState(roomIdRef.current);
  const [roomCode, setRoomCode] = useState(roomCodeRef.current);
  const [isHost, setIsHost] = useState(isHostRef.current);
  const [isSoloRoom, setIsSoloRoom] = useState(isSoloRef.current);
  const [botCount, setBotCount] = useState(Number(ctx.botCount || (isSoloRef.current ? 2 : 0)));
  const [maxPlayers, setMaxPlayers] = useState(maxPlayersRef.current);
  const [players, setPlayers] = useState(Array.isArray(ctx.players) ? ctx.players : []);
  const [status, setStatus] = useState('connecting');
  const [errorMessage, setErrorMessage] = useState('');
  const [copied, setCopied] = useState(false);
  const [gameStarting, setGameStarting] = useState(isSoloRef.current);
  const gameStartedRef = useRef(false);

  useEffect(() => {
    let isMounted = true;
    gameStartedRef.current = false;

    const applyRoomPayload = (payload = {}) => {
      if (payload.roomId) {
        roomIdRef.current = payload.roomId;
        setRoomId(payload.roomId);
      }
      if (payload.roomCode !== undefined) {
        roomCodeRef.current = payload.roomCode || '';
        setRoomCode(payload.roomCode || '');
      }
      if (payload.maxPlayers) {
        maxPlayersRef.current = 3;
        setMaxPlayers(3);
      }

      const payloadIsSolo = isSoloPayload(payload);
      if (payloadIsSolo) {
        isSoloRef.current = true;
        setIsSoloRoom(true);
        setGameStarting(true);
      }

      if (payload.botCount !== undefined) {
        setBotCount(Number(payload.botCount || 0));
      }

      if (payload.hostUserId) {
        const amHost = payload.hostUserId.toString() === currentUser.id;
        isHostRef.current = amHost;
        setIsHost(amHost);
      }

      if (Array.isArray(payload.players)) {
        setPlayers(payload.players);
      }
    };

    const handleSocketMessage = (message) => {
      if (!isMounted || gameStartedRef.current) return;
      const payload = message?.payload || {};

      switch (message?.type) {
        case 'private_joined':
          applyRoomPayload(payload);
          setStatus(isSoloRef.current ? 'starting' : 'waiting');
          setErrorMessage('');
          break;

        case 'room_state_update':
          if (payload.status === 'dissolved') {
            setErrorMessage('Room was dissolved by the host.');
            setStatus('dissolved');
            setTimeout(() => {
              if (isMounted) navigate(ROUTES.mainMenu);
            }, 2000);
            return;
          }
          applyRoomPayload(payload);
          setStatus(isSoloPayload(payload) ? 'starting' : 'waiting');
          setErrorMessage('');
          break;

        case 'game_start':
        case 'game_state': {
          gameStartedRef.current = true;
          setGameStarting(true);
          clearMatchmakingContext();

          const matchId = payload.matchId || payload.gameId || payload.roomId || roomIdRef.current || 'live_match';
          saveActiveMatch({
            matchId,
            roomId: payload.roomId || roomIdRef.current,
            roomCode: roomCodeRef.current,
            maxPlayers: maxPlayersRef.current,
            players: payload.players || [],
            initialGameState: {
              ...payload,
              myPlayerId: payload.myPlayerId || payload.selfPlayerId || currentUser.id,
              selfPlayerId: payload.selfPlayerId || payload.myPlayerId || currentUser.id,
              mySeat: payload.mySeat || payload.selfSeat || '',
            },
            socketMode: true,
          });

          setTimeout(() => {
            if (isMounted) {
              navigate(buildGameRoute(matchId), {
                state: {
                  matchId,
                  roomId: payload.roomId || roomIdRef.current,
                  roomCode: roomCodeRef.current,
                  maxPlayers: maxPlayersRef.current,
                  initialGameState: {
                    ...payload,
                    myPlayerId: payload.myPlayerId || payload.selfPlayerId || currentUser.id,
                    selfPlayerId: payload.selfPlayerId || payload.myPlayerId || currentUser.id,
                    mySeat: payload.mySeat || payload.selfSeat || '',
                  },
                  socketMode: true,
                },
              });
            }
          }, 400);
          break;
        }

        case 'error': {
          const errorText = payload.message || payload.error || 'Socket error';
          if (/already\s+in\s+the\s+queue/i.test(errorText)) break;
          setErrorMessage(errorText);
          if (isSoloRef.current) setGameStarting(false);
          break;
        }

        default:
          break;
      }
    };

    let socket = null;
    let roomJoinSent = false;

    const emitRoomJoin = (rawSocket = null) => {
      const joinByRoomId = isSoloRef.current && roomIdRef.current;
      const joinByCode = roomCodeRef.current;
      if (!joinByRoomId && !joinByCode) return;
      if (roomJoinSent) return;

      const payload = joinByRoomId
        ? { roomId: roomIdRef.current }
        : { roomCode: roomCodeRef.current };
      let joined = false;

      if (rawSocket?.connected) {
        rawSocket.emit('room:join', payload);
        joined = true;
      } else if (socket?.raw?.connected) {
        socket.raw.emit('room:join', payload);
        joined = true;
      }

      if (joined) roomJoinSent = true;
    };

    socket = connectGameSocket({
      onOpen: (rawSocket) => {
        if (!isMounted) return;
        setStatus('connected');
        emitRoomJoin(rawSocket);
      },
      onMessage: handleSocketMessage,
      onError: (error) => {
        if (isMounted) {
          setStatus('error');
          setGameStarting(false);
          setErrorMessage(error?.message || 'Unable to connect to gameplay server.');
        }
      },
      onClose: () => {
        if (isMounted && !gameStartedRef.current) {
          setStatus('disconnected');
          setGameStarting(false);
        }
      },
    });

    return () => {
      isMounted = false;
      if (!gameStartedRef.current) {
        disconnectGameSocket();
      }
    };
  }, [navigate, currentUser.id]);

  const handleCopyCode = async () => {
    try {
      await navigator.clipboard?.writeText(roomCode);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      setCopied(false);
    }
  };

  const handleStartGame = () => {
    if (!roomId) return;
    setGameStarting(true);
    startPrivateGame(roomId);
  };

  const handleLeaveLobby = () => {
    if (roomId) {
      leaveLobby(roomId);
    }
    disconnectGameSocket();
    clearMatchmakingContext();
    navigate(ROUTES.mainMenu);
  };

  const canStart = isHost && players.length === 3 && !gameStarting;
  const emptySlots = Math.max(0, maxPlayers - players.length);

  return (
    <section className="private-lobby-screen">
      <div className="private-lobby-bg" />

      <header className="private-lobby-header">
        <button type="button" className="lobby-back-btn" onClick={handleLeaveLobby} aria-label="Leave lobby">
          ←
        </button>
        <h1>{isSoloRoom ? t('soloLobbyTitle') : t('privateLobbyTitle')}</h1>
      </header>

      <main className="private-lobby-content">
        {/* Room Info Card */}
        <div className={`lobby-room-info${isSoloRoom ? ' lobby-room-info--solo' : ''}`}>
          <div className="lobby-room-code-block">
            <span className="lobby-label">{isSoloRoom ? t('soloSession') : 'Room Code'}</span>
            <div className="lobby-code-value">
              <strong>{isSoloRoom ? t('playSolo') : roomCode || '---'}</strong>
              {!isSoloRoom && roomCode && (
                <button type="button" className="lobby-copy-btn" onClick={handleCopyCode}>
                  {copied ? '✓ Copied' : 'Copy'}
                </button>
              )}
            </div>
          </div>
          <div className="lobby-room-meta">
            <span>{maxPlayers} Players</span>
            <span className="lobby-meta-divider">•</span>
            <span>{isSoloRoom ? t('solo') : 'Private'}</span>
            {isSoloRoom && (
              <>
                <span className="lobby-meta-divider">•</span>
                <span>{botCount || 2} {t('bots')}</span>
              </>
            )}
          </div>
        </div>

        {/* Status */}
        {errorMessage && <p className="lobby-error">{errorMessage}</p>}
        {status === 'connecting' && <p className="lobby-status">Connecting to server...</p>}
        {isSoloRoom && gameStarting && !errorMessage && <p className="lobby-status">{t('startingSoloGame')}</p>}

        {/* Player Slots */}
        <div className="lobby-players-grid">
          {players.map((player, index) => {
            const normalizedPlayer = typeof player === 'string'
              ? { userId: player, id: player }
              : (player || {});
            const firstPlayer = typeof players[0] === 'string' ? { userId: players[0] } : (players[0] || {});
            const pid = normalizedPlayer.userId || normalizedPlayer.id || normalizedPlayer._id || '';
            const isMe = pid === currentUser.id;
            const isBot = isBotLobbyPlayer(normalizedPlayer, pid);
            const isPlayerHost = !isBot && (normalizedPlayer.isHost || (pid === firstPlayer.userId));
            return (
              <div key={pid || index} className={`lobby-player-card ${isMe ? 'lobby-player-me' : ''} ${isBot ? 'lobby-player-bot' : ''}`}>
                <div className="lobby-player-avatar-wrap">
                  <img src={getAvatarSrc(normalizedPlayer.avatar || normalizedPlayer.avatarId)} alt="" onError={(event) => handleProfileAvatarError(event)} />
                  {isPlayerHost && <span className="lobby-host-badge">HOST</span>}
                  {isBot && <span className="lobby-bot-badge">BOT</span>}
                </div>
                <div className="lobby-player-info">
                  <h3>{normalizedPlayer.username || normalizedPlayer.name || (isBot ? `${t('botPlayer')} ${index}` : `Player ${index + 1}`)}</h3>
                  {normalizedPlayer.title && <span className="lobby-player-title">{normalizedPlayer.title}</span>}
                  <span className="lobby-ready-badge">✓ Ready</span>
                </div>
              </div>
            );
          })}

          {/* Empty slots */}
          {Array.from({ length: emptySlots }).map((_, i) => (
            <div key={`empty-${i}`} className="lobby-player-card lobby-player-empty">
              <div className="lobby-player-avatar-wrap lobby-empty-avatar">
                <span>?</span>
              </div>
              <div className="lobby-player-info">
                <h3>{isSoloRoom ? t('waitingSoloGame') : 'Waiting for player...'}</h3>
                <span className="lobby-waiting-dots">
                  <span className="dot" />
                  <span className="dot" />
                  <span className="dot" />
                </span>
              </div>
            </div>
          ))}
        </div>

        {/* Player Count */}
        <p className="lobby-player-count">
          {players.length} / {maxPlayers} Players
        </p>

        {/* Actions */}
        <div className="lobby-actions">
          {isHost && !isSoloRoom && (
            <button
              type="button"
              className="lobby-start-btn"
              onClick={handleStartGame}
              disabled={!canStart}
            >
              {gameStarting ? 'Starting...' : players.length < 3 ? 'Waiting for 3 players...' : 'START GAME'}
            </button>
          )}

          {isHost && isSoloRoom && !gameStarting && (
            <button
              type="button"
              className="lobby-start-btn"
              onClick={handleStartGame}
              disabled={!canStart}
            >
              START SOLO
            </button>
          )}

          {!isHost && !gameStarting && (
            <p className="lobby-wait-text">Waiting for host to start the game...</p>
          )}

          <button type="button" className="lobby-leave-btn" onClick={handleLeaveLobby}>
            Leave Lobby
          </button>
        </div>
      </main>
    </section>
  );
}
