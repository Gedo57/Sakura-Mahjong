import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ROUTES } from '../router/routes.js';
import { createPrivateRoom, getRoomTiers } from '../services/roomService.js';
import { saveMatchmakingContext } from '../store/gameStore.js';
import { useLanguage } from '../i18n/useLanguage.js';

const asset = (name) => `/assets/create-room/${name}`;

export default function CreateRoomPage() {
  const navigate = useNavigate();
  const { t, tx } = useLanguage();
  const [maxPlayers, setMaxPlayers] = useState(3);
  const [tiers, setTiers] = useState([]);
  const [selectedTierId, setSelectedTierId] = useState('');
  const [roomType, setRoomType] = useState('Private');
  const [roomName, setRoomName] = useState('My Sakura Room');
  const [roomCode, setRoomCode] = useState('');
  const [enableBots, setEnableBots] = useState(false);
  const [errorMessage, setErrorMessage] = useState('');
  const [successMessage, setSuccessMessage] = useState('');
  const [isCreatingRoom, setIsCreatingRoom] = useState(false);
  const [createdRoom, setCreatedRoom] = useState(null);
  const [isTierDropdownOpen, setIsTierDropdownOpen] = useState(false);
  const tierDropdownRef = useRef(null);

  useEffect(() => {
    let isMounted = true;

    getRoomTiers()
      .then((roomTiers) => {
        if (!isMounted) return;
        const threePlayerTiers = (roomTiers || []).filter((tier) => Number(tier?.maxPlayers || 3) === 3 && !/_2p$/i.test(String(tier?.tierId || tier?.id || '')));
        setTiers(threePlayerTiers);

        if (threePlayerTiers?.[0]?.tierId) {
          setSelectedTierId(threePlayerTiers[0].tierId);
          setMaxPlayers(3);
        }
      })
      .catch((error) => {
        console.error('Failed to load room tiers:', error);
      });

    return () => {
      isMounted = false;
    };
  }, []);

  const roomTierOptions = useMemo(
    () => tiers,
    [tiers]
  );

  const selectedTier = useMemo(
    () => roomTierOptions.find((tier) => tier.tierId === selectedTierId) || roomTierOptions[0] || null,
    [roomTierOptions, selectedTierId]
  );

  const selectTier = (tierId) => {
    setSelectedTierId(tierId);
    setMaxPlayers(3);
    setIsTierDropdownOpen(false);
  };

  const handleTierDropdownBlur = (event) => {
    if (!tierDropdownRef.current?.contains(event.relatedTarget)) {
      setIsTierDropdownOpen(false);
    }
  };

  const handleBotModeChange = (nextValue) => {
    setEnableBots(nextValue);
    setCreatedRoom(null);
    setRoomCode('');
    setSuccessMessage('');
    setErrorMessage('');
  };

  const bet = selectedTier?.entryFee?.amount ?? 100;
  const formattedBet = useMemo(() => Number(bet || 0).toLocaleString('en-US'), [bet]);
  const isSoloMode = Boolean(enableBots);
  const previewRoomType = isSoloMode ? t('solo') : tx(roomType);

  const handleCreateRoom = async () => {
    setErrorMessage('');
    setSuccessMessage('');
    setIsCreatingRoom(true);

    try {
      const tierId = selectedTierId || selectedTier?.tierId;
      if (!tierId) {
        throw new Error('No backend room tier is selected.');
      }

      const requestedMaxPlayers = 3;
      const room = await createPrivateRoom({
        tierId,
        roomName,
        maxPlayers: requestedMaxPlayers,
        enableBots: isSoloMode,
        botsEnabled: isSoloMode,
        mode: isSoloMode ? 'solo' : 'private',
        type: isSoloMode ? 'solo' : 'private',
      });

      const nextRoomCode = room.roomCode || '';
      const roomId = room.roomId || room.id || nextRoomCode || selectedTierId || 'private_room';
      setRoomCode(nextRoomCode);

      const matchmakingState = {
        roomId,
        roomCode: nextRoomCode,
        tierId: room.tierId || selectedTierId,
        maxPlayers: requestedMaxPlayers,
        source: isSoloMode ? 'solo-room' : 'private-room',
        isHost: true,
        type: room.type || (isSoloMode ? 'solo' : 'private'),
        mode: room.mode || (isSoloMode ? 'solo' : 'private'),
        enableBots: Boolean(room.enableBots || isSoloMode),
        isSolo: Boolean(room.isSolo || room.enableBots || isSoloMode),
        botCount: Number(room.botCount || (isSoloMode ? 2 : 0)),
        players: room.players || [],
        botPlayers: room.botPlayers || [],
      };

      setCreatedRoom(matchmakingState);
      saveMatchmakingContext(matchmakingState);
      setSuccessMessage(isSoloMode ? t('soloRoomCreatedSuccessfully') : t('roomCreatedSuccessfully'));
      navigate(ROUTES.privateLobby, { state: matchmakingState });
    } catch (error) {
      console.error('Failed to create private room:', error);
      setErrorMessage(error.message || 'Failed to create private room');
    } finally {
      setIsCreatingRoom(false);
    }
  };

  const handleCopyRoomCode = async () => {
    if (!roomCode) return;

    try {
      await navigator.clipboard?.writeText(roomCode);
      setSuccessMessage(t('roomCodeCopied'));
    } catch (error) {
      console.warn('Failed to copy room code:', error);
      setSuccessMessage(`${t('roomCode')}: ${roomCode}`);
    }
  };

  return (
    <section className="create-room-screen">
      <header className="create-room-header">
        <button type="button" className="create-back-button" onClick={() => navigate(ROUTES.mainMenu)} aria-label={t('backToMainMenu')}>
          ←
        </button>
        <h1>{isSoloMode ? t('playSolo') : t('createRoomTitle')}</h1>
      </header>

      <main className="create-room-layout">
        <section className='create-settings-card lui-c8c2bb58'>
          <h2>{t('roomSettings')}</h2>

          <div className="create-form-row">
            <label htmlFor="room-name">{t('roomName')}</label>
            <input
              id="room-name"
              value={roomName}
              onChange={(event) => setRoomName(event.target.value)}
              aria-label={t('roomName')}
            />
          </div>

          <div className="create-form-row">
            <label htmlFor="room-code">{t('roomCode')}</label>
            <input
              id="room-code"
              value={roomCode}
              readOnly
              placeholder={isSoloMode ? t('soloRoomCodeHint') : 'Auto generated after create'}
              aria-label={t('roomCode')}
            />
          </div>

          <div className="create-form-row">
            <label id="room-tier-label">{t('gameMode')}</label>
            <div
              className={`create-select-wrap${isTierDropdownOpen ? ' open' : ''}`}
              ref={tierDropdownRef}
              onBlur={handleTierDropdownBlur}
            >
              <button
                type="button"
                className="create-tier-trigger"
                aria-labelledby="room-tier-label"
                aria-haspopup="listbox"
                aria-expanded={isTierDropdownOpen}
                onClick={() => setIsTierDropdownOpen((value) => !value)}
              >
                <span className="create-tier-selected">{tx(selectedTier?.name || selectedTierId)}</span>
                <span className="create-tier-arrow" aria-hidden="true">⌄</span>
              </button>

              {isTierDropdownOpen && (
                <div className="create-tier-menu" role="listbox" aria-labelledby="room-tier-label">
                  {roomTierOptions.map((tier) => {
                    const isActive = tier.tierId === selectedTierId;

                    return (
                      <button
                        type="button"
                        key={tier.tierId}
                        role="option"
                        aria-selected={isActive}
                        className={`create-tier-option${isActive ? ' active' : ''}`}
                        onMouseDown={(event) => event.preventDefault()}
                        onClick={() => selectTier(tier.tierId)}
                      >
                        {tx(tier.name || tier.tierId)}
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
          </div>

          <div className="create-form-row players-row">
            <label>{t('maxPlayers')}</label>
            <div className="segmented-options">
              {[3].map((value) => (
                <button
                  type="button"
                  key={value}
                  className="active"
                  onClick={() => setMaxPlayers(3)}
                >
                  {value} {t('players')}
                </button>
              ))}
            </div>
          </div>

          <div className="create-form-row bet-row">
            <label>{t('bet')}</label>
            <div className="bet-controls">
              <div className="bet-value"><span>●</span>{formattedBet}</div>
            </div>
          </div>

          <div className="create-form-row room-type-row">
            <label>{t('roomType')}</label>
            <div className="segmented-options room-type-options">
              {['Private'].map((type) => (
                <button
                  type="button"
                  key={type}
                  className={!isSoloMode && roomType === type ? 'active' : ''}
                  onClick={() => setRoomType(type)}
                  disabled={isSoloMode}
                >
                  <span>●</span>{tx(type)}
                </button>
              ))}
            </div>
          </div>

          <div className="create-form-row bot-mode-row">
            <label>{t('botMode')}</label>
            <div className="segmented-options bot-mode-options" role="group" aria-label={t('botMode')}>
              <button
                type="button"
                className={!isSoloMode ? 'active' : ''}
                onClick={() => handleBotModeChange(false)}
              >
                {t('botOff')}
              </button>
              <button
                type="button"
                className={isSoloMode ? 'active' : ''}
                onClick={() => handleBotModeChange(true)}
              >
                {t('botOn')}
              </button>
            </div>
          </div>

          {errorMessage && <p className="create-error-message">{errorMessage}</p>}
          {successMessage && <p className="create-success-message">{successMessage}</p>}

          <div className="create-room-actions">
            <button
              type="button"
              className="create-room-submit"
              onClick={handleCreateRoom}
              disabled={isCreatingRoom}
            >
              {isCreatingRoom ? t('creatingRoom') : isSoloMode ? t('playSolo') : createdRoom ? t('createAnotherRoom') : t('createRoom')}
            </button>

            {!isSoloMode && roomCode && (
              <button type="button" className="copy-room-code-button" onClick={handleCopyRoomCode}>
                {t('copyCode')}
              </button>
            )}
          </div>
        </section>

        <aside className='room-preview-card lui-f6c5a7a8'>
          <h2>{t('roomPreview')}</h2>
          <div className="preview-image" />

          <dl className="preview-list">
            <div><dt>{t('roomName')}</dt><dd>{roomName || tx('My Sakura Room')}</dd></div>
            <div><dt>{t('roomCode')}</dt><dd>{isSoloMode ? '—' : roomCode || '—'}</dd></div>
            <div><dt>{t('mode')}</dt><dd>{tx(selectedTier?.name || selectedTierId)}</dd></div>
            <div><dt>{t('players')}</dt><dd>{maxPlayers} {t('players')}</dd></div>
            <div><dt>{t('bet')}</dt><dd className="preview-bet"><span>●</span>{formattedBet}</dd></div>
            <div><dt>{t('type')}</dt><dd>{previewRoomType}</dd></div>
            <div><dt>{t('botMode')}</dt><dd>{isSoloMode ? t('botOn') : t('botOff')}</dd></div>
          </dl>
        </aside>
      </main>
    </section>
  );
}
