import { handleProfileAvatarError, resolveProfileAvatarSrc } from '../../utils/avatarAssets.js';

const asset = (name) => `/assets/gameplay/${name}`;

export function GameplayTile({ name, className = '', label = '' }) {
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

export function TileWall({ count = 14, direction = 'horizontal', className = '' }) {
  return (
    <div className={`gameplay-tile-wall ${direction} ${className}`} aria-hidden="true">
      {Array.from({ length: count }).map((_, index) => (
        <img src={asset('tile_back.png')} alt="" draggable="false" key={index} />
      ))}
    </div>
  );
}

export function SideTool({ icon, label, onClick, className = '', disabled = false }) {
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

export function PlayerBadge({
  variant = 'small',
  avatar,
  name,
  title = '',
  seatLabel = '',
  coins,
  className = '',
  isActiveTurn = false,
  turnLabel = '',
  isDealer = false,
  dealerLabel = 'Dealer',
}) {
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

export function Compass({ round = 'East 1', timer = 30, turnLabel = 'YOUR TURN' }) {
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
