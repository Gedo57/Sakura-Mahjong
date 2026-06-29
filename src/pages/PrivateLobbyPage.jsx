import { useEffect, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { ROUTES, buildGameRoute } from '../router/routes.js';
import { getStoredAuthUser } from '../services/authService.js';
import { clearMatchmakingContext, getMatchmakingContext, saveActiveMatch } from '../store/gameStore.js';
import { connectGameSocket, disconnectGameSocket, startPrivateGame, leaveLobby } from '../services/socket.js';
import { useLanguage } from '../i18n/useLanguage.js';

const PROFILE_ASSET_ROOT = '/assets/profile/';
const DEFAULT_AVATAR = 'ICO.png';

function getAvatarSrc(avatar) {
  if (!avatar || typeof avatar !== 'string') return `${PROFILE_ASSET_ROOT}${DEFAULT_AVATAR}`;
  const val = avatar.trim();
  if (/^(https?:)?\/\//i.test(val) || val.startsWith('/')) return val;
  if (/\.(png|jpe?g|webp|gif|svg)$/i.test(val)) return `${PROFILE_ASSET_ROOT}${val}`;
  return `${PROFILE_ASSET_ROOT}${DEFAULT_AVATAR}`;
}

function getCurrentUser() {
  const u = getStoredAuthUser() || {};
  return {
    id: u.id || u.userId || u._id || '',
    username: u.username || u.name || u.displayName || 'You',
    avatar: u.avatarUrl || u.imageUrl || u.avatar || u.avatarId || DEFAULT_AVATAR,
  };
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
  const maxPlayersRef = useRef(Number(ctx.maxPlayers) || 2);

  const [roomId, setRoomId] = useState(roomIdRef.current);
  const [roomCode, setRoomCode] = useState(roomCodeRef.current);
  const [isHost, setIsHost] = useState(isHostRef.current);
  const [maxPlayers, setMaxPlayers] = useState(maxPlayersRef.current);
  const [players, setPlayers] = useState([]);
  const [status, setStatus] = useState('connecting');
  const [errorMessage, setErrorMessage] = useState('');
  const [copied, setCopied] = useState(false);
  const [gameStarting, setGameStarting] = useState(false);
  const gameStartedRef = useRef(false);

  useEffect(() => {
    let isMounted = true;
    gameStartedRef.current = false;

    const handleSocketMessage = (message) => {
      if (!isMounted || gameStartedRef.current) return;
      const payload = message?.payload || {};

      switch (message?.type) {
        case 'private_joined':
          if (payload.roomId) {
            roomIdRef.current = payload.roomId;
            setRoomId(payload.roomId);
          }
          if (payload.roomCode) {
            roomCodeRef.current = payload.roomCode;
            setRoomCode(payload.roomCode);
          }
          setStatus('waiting');
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
          if (payload.roomId) {
            roomIdRef.current = payload.roomId;
            setRoomId(payload.roomId);
          }
          if (payload.roomCode) {
            roomCodeRef.current = payload.roomCode;
            setRoomCode(payload.roomCode);
          }
          if (payload.maxPlayers) {
            maxPlayersRef.current = payload.maxPlayers;
            setMaxPlayers(payload.maxPlayers);
          }
          if (payload.hostUserId) {
            const amHost = payload.hostUserId.toString() === currentUser.id;
            isHostRef.current = amHost;
            setIsHost(amHost);
          }
          if (Array.isArray(payload.players)) {
            setPlayers(payload.players);
          }
          setStatus('waiting');
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
          break;
        }

        default:
          break;
      }
    };

    let socket = null;
    let roomJoinSent = false;

    const emitRoomJoin = (rawSocket = null) => {
      const code = roomCodeRef.current;
      if (!code) return;
      if (roomJoinSent) return;

      const payload = { roomCode: code };
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
          setErrorMessage(error?.message || 'Unable to connect to gameplay server.');
        }
      },
      onClose: () => {
        if (isMounted && !gameStartedRef.current) {
          setStatus('disconnected');
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

  const canStart = isHost && players.length >= 2 && !gameStarting;
  const emptySlots = Math.max(0, maxPlayers - players.length);

  return (
    <section className="private-lobby-screen">
      <div className="private-lobby-bg" />

      <header className="private-lobby-header">
        <button type="button" className="lobby-back-btn" onClick={handleLeaveLobby} aria-label="Leave lobby">
          ←
        </button>
        <h1>Private Lobby</h1>
      </header>

      <main className="private-lobby-content">
        {/* Room Info Card */}
        <div className="lobby-room-info">
          <div className="lobby-room-code-block">
            <span className="lobby-label">Room Code</span>
            <div className="lobby-code-value">
              <strong>{roomCode || '---'}</strong>
              {roomCode && (
                <button type="button" className="lobby-copy-btn" onClick={handleCopyCode}>
                  {copied ? '✓ Copied' : 'Copy'}
                </button>
              )}
            </div>
          </div>
          <div className="lobby-room-meta">
            <span>{maxPlayers} Players</span>
            <span className="lobby-meta-divider">•</span>
            <span>Private</span>
          </div>
        </div>

        {/* Status */}
        {errorMessage && <p className="lobby-error">{errorMessage}</p>}
        {status === 'connecting' && <p className="lobby-status">Connecting to server...</p>}

        {/* Player Slots */}
        <div className="lobby-players-grid">
          {players.map((player, index) => {
            const pid = player.userId || player.id || player._id || '';
            const isMe = pid === currentUser.id;
            const isPlayerHost = player.isHost || (pid === players[0]?.userId);
            return (
              <div key={pid || index} className={`lobby-player-card ${isMe ? 'lobby-player-me' : ''}`}>
                <div className="lobby-player-avatar-wrap">
                  <img src={getAvatarSrc(player.avatar)} alt="" />
                  {isPlayerHost && <span className="lobby-host-badge">HOST</span>}
                </div>
                <div className="lobby-player-info">
                  <h3>{player.username || player.name || `Player ${index + 1}`}</h3>
                  {player.title && <span className="lobby-player-title">{player.title}</span>}
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
                <h3>Waiting for player...</h3>
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
          {isHost && (
            <button
              type="button"
              className="lobby-start-btn"
              onClick={handleStartGame}
              disabled={!canStart}
            >
              {gameStarting ? 'Starting...' : players.length < 2 ? 'Waiting for players...' : 'START GAME'}
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
