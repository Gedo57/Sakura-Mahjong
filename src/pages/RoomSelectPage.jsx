import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ROUTES } from '../router/routes.js';
import ScreenHeader from '../components/ScreenHeader.jsx';
import PrimaryButton from '../components/PrimaryButton.jsx';
import FlowNav from '../components/FlowNav.jsx';
import { getRooms } from '../services/roomService.js';
import { saveMatchmakingContext } from '../store/gameStore.js';
import { useLanguage } from '../i18n/useLanguage.js';

const fallbackRooms = [];

export default function RoomSelectPage() {
  const navigate = useNavigate();
  const { t, tx } = useLanguage();
  const [rooms, setRooms] = useState(fallbackRooms);

  useEffect(() => {
    let isMounted = true;

    getRooms()
      .then((response) => {
        if (isMounted && response?.length) {
          setRooms(response);
        }
      })
      .catch((error) => console.error('Failed to load rooms:', error));

    return () => {
      isMounted = false;
    };
  }, []);

  const handleSelectRoom = async (room) => {
    if (String(room.status || '').includes('Locked')) {
      return;
    }

    const roomId = room.roomId || room.tierId || room.id || room.name;
    const matchmakingState = {
      roomId,
      tierId: room.tierId || room.id || room.roomId || '',
      maxPlayers: Number(room.maxPlayers) || 3,
      source: 'room-select',
    };
    saveMatchmakingContext(matchmakingState);
    navigate(ROUTES.matchmaking, { state: matchmakingState });
  };

  return (
    <section className="screen room-select-screen">
      <ScreenHeader
        eyebrow={t('lobby')}
        title={t('selectRoom')}
        description={t('roomDescription')}
      />

      <div className="room-grid">
        {rooms.length ? rooms.map((room) => (
          <article className="room-card" key={room.name}>
            <h2>{tx(room.name)}</h2>
            <p>{tx(room.bet)}</p>
            <span>{tx(room.status)}</span>
            <PrimaryButton onClick={() => handleSelectRoom(room)} disabled={String(room.status || '').includes('Locked')}>
              {t('select')}
            </PrimaryButton>
          </article>
        )) : (
          <article className="room-card">
            <h2>No rooms available</h2>
            <p>Backend did not return room tiers.</p>
            <span>Unavailable</span>
            <PrimaryButton disabled>{t('select')}</PrimaryButton>
          </article>
        )}
      </div>

      <div className="split-actions">
        <PrimaryButton onClick={() => navigate(ROUTES.createRoom)}>{t('createRoom')}</PrimaryButton>
        <PrimaryButton variant="secondary" onClick={() => navigate(ROUTES.joinRoom)}>{t('joinRoom')}</PrimaryButton>
      </div>

      <FlowNav backTo={ROUTES.mainMenu} />
    </section>
  );
}
