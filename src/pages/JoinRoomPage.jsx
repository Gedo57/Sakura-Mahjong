import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ROUTES } from '../router/routes.js';
import { getPublicRooms } from '../services/roomService.js';
import { saveMatchmakingContext } from '../store/gameStore.js';
import { useLanguage } from '../i18n/useLanguage.js';

const MAX_ROOM_PLAYERS = 3;
const PUBLIC_ROOM_REFRESH_MS = 5000;

export default function JoinRoomPage() {
  const navigate = useNavigate();
  const { t, tx } = useLanguage();
  const [roomCode, setRoomCode] = useState('');
  const [publicRooms, setPublicRooms] = useState([]);
  const [isJoining, setIsJoining] = useState(false);
  const [isLoadingRooms, setIsLoadingRooms] = useState(false);
  const [errorMessage, setErrorMessage] = useState('');
  const [lastRefreshAt, setLastRefreshAt] = useState(null);

  const normalizedRoomCode = useMemo(() => roomCode.trim().toUpperCase(), [roomCode]);

  const loadPublicRooms = async ({ silent = false } = {}) => {
    if (!silent) setIsLoadingRooms(true);

    try {
      const rooms = await getPublicRooms();
      setPublicRooms(rooms.filter((room) => String(room.visibility || 'public').toLowerCase() === 'public'));
      setLastRefreshAt(new Date());
    } catch (error) {
      console.error('Failed to load public rooms:', error);
      if (!silent) setErrorMessage(error.message || t('joinRoomUnavailable'));
    } finally {
      if (!silent) setIsLoadingRooms(false);
    }
  };

  useEffect(() => {
    let isMounted = true;

    const safeLoadPublicRooms = async (options) => {
      if (!isMounted) return;
      await loadPublicRooms(options);
    };

    safeLoadPublicRooms();
    const intervalId = window.setInterval(() => safeLoadPublicRooms({ silent: true }), PUBLIC_ROOM_REFRESH_MS);

    return () => {
      isMounted = false;
      window.clearInterval(intervalId);
    };
  }, []);

  const handleJoinRoom = async (room) => {
    const requestedCode = room?.roomCode || room?.code || normalizedRoomCode;
    const fallbackRoomId = room?.roomId || room?.id || requestedCode || 'joined_room';
    const maxPlayers = Number(room?.maxPlayers || MAX_ROOM_PLAYERS) || MAX_ROOM_PLAYERS;

    setErrorMessage('');
    setIsJoining(true);

    try {
      const matchmakingState = {
        roomId: fallbackRoomId,
        roomCode: requestedCode,
        tierId: room?.tierId || '',
        roomName: room?.roomName || room?.name || '',
        maxPlayers,
        source: room ? 'join-public-room-list' : 'join-room-code',
        visibility: room?.visibility || (room ? 'public' : 'private'),
        isListed: Boolean(room),
        isHost: false,
        type: room?.visibility || (room ? 'public' : 'private'),
        mode: room?.visibility || (room ? 'public' : 'private'),
        entryFee: room?.entryFee || null,
        entryFeeAmount: room?.entryFeeAmount || room?.entryFee?.amount || 0,
        currency: room?.currency || room?.entryFee?.currency || 'coins',
        prizePool: room?.prizePool || 0,
        socketMode: true,
      };

      saveMatchmakingContext(matchmakingState);
      navigate(ROUTES.privateLobby, { state: matchmakingState });
    } catch (error) {
      console.error('Join room failed:', error);
      setErrorMessage(error.message || t('joinRoomUnavailable'));
    } finally {
      setIsJoining(false);
    }
  };

  const refreshLabel = lastRefreshAt
    ? `${t('updated') || 'Updated'} ${lastRefreshAt.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}`
    : '';

  return (
    <section className="join-room-screen">
      <button type="button" className="join-room-back-button" onClick={() => navigate(ROUTES.mainMenu)} aria-label={t('backToMainMenu')}>
        ←
      </button>

      <header className="join-room-header">
        <h1>{t('joinRoom')}</h1>
        <p>{t('joinRoomPageText')}</p>
      </header>

      <main className="join-room-panel">
        <section className="join-room-code-panel" aria-label={t('roomCode')}>
          <h2>{t('roomCode')}</h2>

          <div className="join-room-code-entry">
            <input
              value={roomCode}
              onChange={(event) => setRoomCode(event.target.value)}
              placeholder={t('enterRoomCode')}
              aria-label={t('roomCode')}
              spellCheck="false"
            />
          </div>
        </section>

        <div className="join-room-divider">{t('or')}</div>

        <section className="join-room-list-panel" aria-label={t('availableRooms')}>
          <h2>{t('availableRooms')}</h2>
          <div className="join-room-refresh-status">
            {isLoadingRooms ? t('loading') : refreshLabel || `${t('autoRefresh') || 'Auto refresh'}: 5s`}
          </div>

          <div className="join-room-scroll-shell">
            <div className="join-room-list">
              {publicRooms.length > 0 ? publicRooms.map((room) => {
                const playersCount = Number(room.playersCount ?? room.playerCount ?? 0) || 0;
                const maxPlayers = Number(room.maxPlayers || MAX_ROOM_PLAYERS) || MAX_ROOM_PLAYERS;
                const entryAmount = Number(room.entryFeeAmount || room.entryFee?.amount || 0) || 0;

                return (
                  <div className="join-room-row" key={room.roomId || room.id || room.roomCode}>
                    <strong>{room.roomCode || room.code || '----'}</strong>
                    <span>{tx(room.roomName || room.name || room.tierName || 'Sakura Room')}</span>
                    <em>{playersCount}/{maxPlayers}</em>
                    <em>{entryAmount.toLocaleString('en-US')}</em>
                    <button type="button" onClick={() => handleJoinRoom(room)} disabled={isJoining || playersCount >= maxPlayers}>
                      {t('join')}
                    </button>
                  </div>
                );
              }) : (
                <div className="join-room-empty-row">
                  {isLoadingRooms ? t('loading') : t('noPublicRooms') || 'No public rooms available'}
                </div>
              )}
            </div>
          </div>
        </section>

        <p className="join-room-helper">✿ {errorMessage || t('validRoomCodeHint')} ✿</p>

        <div className="join-room-actions">
          <button type="button" className="join-room-primary-action" onClick={() => handleJoinRoom(null)} disabled={!normalizedRoomCode || isJoining}>
            {isJoining ? t('connecting') : t('joinRoom')}
          </button>
          <button type="button" className="join-room-secondary-action" onClick={() => navigate(ROUTES.mainMenu)}>
            <span>←</span> {t('back')}
          </button>
        </div>
      </main>
    </section>
  );
}
