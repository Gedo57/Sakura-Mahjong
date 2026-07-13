import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ROUTES } from '../router/routes.js';
import { getGlobalLeaderboard, getMyRank } from '../services/leaderboardService.js';

const leaderboardIcon = '/assets/leaderboard/icon-leaderboard.png';
const fallbackAvatar = '/assets/main-menu/friend-girl.png';

function formatNumber(value, fallback = '—') {
  const numericValue = Number(value);

  if (Number.isFinite(numericValue)) {
    return numericValue.toLocaleString();
  }

  return fallback;
}

function normalizePlayer(player, index) {
  const rank = Number(player?.rank ?? player?.position ?? index + 1);
  const trophies = Number(player?.trophies ?? player?.score ?? player?.points ?? 0);

  return {
    id: player?.id || player?.userId || player?.username || `leaderboard-player-${index}`,
    rank: Number.isFinite(rank) ? rank : index + 1,
    username: player?.username || player?.name || player?.displayName || `Player ${index + 1}`,
    trophies: Number.isFinite(trophies) ? trophies : 0,
    avatar: player?.avatarUrl || player?.imageUrl || player?.avatar || player?.avatarId || fallbackAvatar,
  };
}

function getAvatarSrc(avatar) {
  if (typeof avatar !== 'string' || !avatar.trim()) {
    return fallbackAvatar;
  }

  const cleanAvatar = avatar.trim();

  if (/^(https?:)?\/\//i.test(cleanAvatar) || cleanAvatar.startsWith('/')) {
    return cleanAvatar;
  }

  if (/\.(png|jpe?g|webp|gif|svg)$/i.test(cleanAvatar)) {
    return `/assets/profile/${cleanAvatar}`;
  }

  return fallbackAvatar;
}

function TopRankCard({ player }) {
  return (
    <article className={`leaderboard-top-card leaderboard-top-card-rank-${player.rank}`}>
      <div className="leaderboard-top-rank">#{player.rank}</div>
      <div className="leaderboard-top-avatar-wrap">
        <img className="leaderboard-top-avatar" src={getAvatarSrc(player.avatar)} alt="" />
        <img className="leaderboard-top-icon" src={leaderboardIcon} alt="" />
      </div>
      <strong className="leaderboard-top-name">{player.username}</strong>
      <span className="leaderboard-top-trophies">{formatNumber(player.trophies)} Trophies</span>
    </article>
  );
}

function LeaderboardRow({ player }) {
  return (
    <article className="leaderboard-row">
      <div className="leaderboard-row-rank">#{player.rank}</div>
      <img className="leaderboard-row-icon" src={leaderboardIcon} alt="" />
      <img className="leaderboard-row-avatar" src={getAvatarSrc(player.avatar)} alt="" />
      <strong className="leaderboard-row-name">{player.username}</strong>
      <span className="leaderboard-row-trophies">{formatNumber(player.trophies)}</span>
    </article>
  );
}

export default function LeaderboardPage() {
  const navigate = useNavigate();
  const [players, setPlayers] = useState([]);
  const [myRank, setMyRank] = useState(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    let isMounted = true;

    async function loadLeaderboard() {
      setIsLoading(true);
      setError('');

      try {
        const [globalResult, myRankResult] = await Promise.allSettled([
          getGlobalLeaderboard(),
          getMyRank(),
        ]);

        if (!isMounted) {
          return;
        }

        if (globalResult.status === 'fulfilled') {
          setPlayers(globalResult.value.map(normalizePlayer));
        } else {
          console.error('Failed to load global leaderboard:', globalResult.reason);
          setPlayers([]);
          setError(globalResult.reason?.message || 'Failed to load leaderboard');
        }

        if (myRankResult.status === 'fulfilled') {
          const payload = myRankResult.value?.data || myRankResult.value || {};
          setMyRank({
            rank: payload.rank ?? null,
            trophies: payload.trophies ?? 0,
          });
        } else {
          console.error('Failed to load my rank:', myRankResult.reason);
          setMyRank(null);
        }
      } finally {
        if (isMounted) {
          setIsLoading(false);
        }
      }
    }

    loadLeaderboard();

    return () => {
      isMounted = false;
    };
  }, []);

  const sortedPlayers = useMemo(() => [...players].sort((a, b) => a.rank - b.rank), [players]);
  const topPlayers = sortedPlayers.slice(0, 3);
  const podiumPlayers = topPlayers.length === 3 ? [topPlayers[1], topPlayers[0], topPlayers[2]] : topPlayers;
  const remainingPlayers = sortedPlayers.slice(3);

  return (
    <section className="leaderboard-page-ui">
      <header className="leaderboard-header">
        <button className="leaderboard-back-button" type="button" onClick={() => navigate(ROUTES.mainMenu)}>
          ‹ Back
        </button>
        <div className="leaderboard-title-wrap">
          <img src={leaderboardIcon} alt="" />
          <div>
            <h1>Leaderboard</h1>
            <p>Global Top 100 by trophies</p>
          </div>
        </div>
        <div className="leaderboard-my-rank-card">
          <span>My Rank</span>
          <strong>{myRank?.rank ? `#${formatNumber(myRank.rank)}` : '—'}</strong>
          <small>{formatNumber(myRank?.trophies ?? 0)} Trophies</small>
        </div>
      </header>

      <main className="leaderboard-content">
        <section className="leaderboard-podium" aria-label="Top 3 leaderboard players">
          {podiumPlayers.length ? (
            podiumPlayers.map((player) => <TopRankCard key={player.id} player={player} />)
          ) : (
            <div className="leaderboard-empty-top">{isLoading ? 'Loading leaderboard...' : 'No leaderboard players yet'}</div>
          )}
        </section>

        <section className="leaderboard-list-panel">
          <div className="leaderboard-list-header">
            <span>Rank</span>
            <span>Player</span>
            <span>Trophies</span>
          </div>

          <div className="leaderboard-list-scroll">
            {remainingPlayers.map((player) => (
              <LeaderboardRow key={player.id} player={player} />
            ))}

            {!isLoading && !remainingPlayers.length && topPlayers.length > 0 && (
              <div className="leaderboard-empty-list">Only top 3 available</div>
            )}

            {!isLoading && error && (
              <div className="leaderboard-error-state">{error}</div>
            )}
          </div>
        </section>
      </main>
    </section>
  );
}
