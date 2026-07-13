import { GameplayTile } from './GameplayPrimitives.jsx';

const toArray = (value) => (Array.isArray(value) ? value : []);
const MAX_VISIBLE_BONUS_TILES = 4;

const normalizePosition = (value) => {
  const position = String(value || '').toLowerCase();
  if (position === 'self' || position === 'me' || position === 'mine') return 'bottom';
  if (position === 'right') return '';
  return ['bottom', 'top', 'left', 'center'].includes(position) ? position : '';
};

export function TileFocusOverlay({ focus }) {
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

export function ReclaimFeiPrompt({ windowState, t, onConfirm, onSkip, isPending = false }) {
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

export function BonusTileRack({ position = 'left', tiles = [], label = 'BONUS', visible = false }) {
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
