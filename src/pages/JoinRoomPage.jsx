import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ROUTES } from '../router/routes.js';
import { saveMatchmakingContext } from '../store/gameStore.js';
import { useLanguage } from '../i18n/useLanguage.js';

const MAX_ROOM_PLAYERS = 3;

export default function JoinRoomPage() {
  const navigate = useNavigate();
  const { t, tx } = useLanguage();
  const [roomCode, setRoomCode] = useState('');
  const [isJoining, setIsJoining] = useState(false);
  const [errorMessage, setErrorMessage] = useState('');

  const normalizedRoomCode = useMemo(() => roomCode.trim().toUpperCase(), [roomCode]);
  const joinRoom = async (room) => {
    const requestedCode = room?.code || normalizedRoomCode;
    const fallbackRoomId = room?.id || requestedCode || 'joined_room';
    const maxPlayers = room?.maxPlayers || MAX_ROOM_PLAYERS;

    setErrorMessage('');
    setIsJoining(true);

    try {
      const matchmakingState = {
        roomId: fallbackRoomId,
        roomCode: requestedCode,
        maxPlayers,
        source: room ? 'join-room-list' : 'join-room-code',
        isHost: false,
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

        <div className="join-room-divider"><span>{t('or')}</span></div>

        <section className="join-room-list-panel" aria-label={t('availableRooms')}>
          <h2>{t('recentRooms')}</h2>

          <div className="join-room-scroll-shell">
            <div className="join-room-list">
              <article className="join-room-row">
                <strong>LIVE</strong>
                <span>Enter a real backend room code</span>
                <em>— / —</em>
                <button type="button" disabled>{t('join')}</button>
              </article>
            </div>
          </div>
        </section>

        <p className="join-room-helper">✿ {errorMessage || t('validRoomCodeHint')} ✿</p>

        <div className="join-room-actions">
          <button type="button" className="join-room-primary-action" onClick={() => joinRoom(null)} disabled={!normalizedRoomCode || isJoining}>
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
