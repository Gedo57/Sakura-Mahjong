import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useLanguage } from '../i18n/useLanguage.js';
import { ROUTES } from '../router/routes.js';
import { getUserMatchHistory } from '../services/authService.js';
import { getStoredAuthUser } from '../services/authService.js';

export default function MatchHistoryPage() {
  const { t, tx } = useLanguage();
  const navigate = useNavigate();
  const [history, setHistory] = useState([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState(null);
  
  const currentUser = getStoredAuthUser();

  useEffect(() => {
    let isMounted = true;
    
    async function fetchHistory() {
      try {
        setIsLoading(true);
        const data = await getUserMatchHistory();
        if (isMounted) {
          setHistory(data || []);
        }
      } catch (err) {
        if (isMounted) {
          setError(err.message || 'Failed to load match history');
        }
      } finally {
        if (isMounted) {
          setIsLoading(false);
        }
      }
    }
    
    fetchHistory();
    
    return () => {
      isMounted = false;
    };
  }, []);

  const formatDate = (dateString) => {
    const date = new Date(dateString);
    return new Intl.DateTimeFormat('en-US', {
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    }).format(date);
  };

  const getOrdinal = (n) => {
    const s = ["th", "st", "nd", "rd"];
    const v = n % 100;
    return s[(v - 20) % 10] || s[v] || s[0];
  };

  return (
    <div className="match-history-screen">
      <div className="history-bg-fx" />
      
      <header className="match-history-header">
        <button 
          className="history-back-btn" 
          onClick={() => navigate(ROUTES.profile)}
          aria-label={t('backToProfile') || 'Back to Profile'}
        >
          ←
        </button>
        <h1>{t('matchHistory') || 'Match History'}</h1>
      </header>
      
      <main className="match-history-content">
        {isLoading ? (
          <div className="history-loading">{t('loading') || 'Loading...'}</div>
        ) : error ? (
          <div className="history-error">{error}</div>
        ) : history.length === 0 ? (
          <div className="history-empty">
            {t('noMatchHistory') || 'No match history found. Go play some games!'}
          </div>
        ) : (
          history.map((match) => {
            // Find current user's stats
            const myStats = match.players.find(p => {
              // Handle both populated and unpopulated userId
              const playerId = typeof p.userId === 'object' ? p.userId?._id : p.userId;
              return playerId === currentUser?.id;
            });
            
            if (!myStats) return null; // Should not happen if data is consistent
            
            const isWinner = match.winnerId && (
              typeof match.winnerId === 'object' 
                ? match.winnerId._id === currentUser?.id 
                : match.winnerId === currentUser?.id
            );

            // Sort players by placement
            const sortedPlayers = [...match.players].sort((a, b) => a.placement - b.placement);

            return (
              <div key={match._id || match.matchId} className="history-card lui-9b7e3f2">
                <div className="history-card-header">
                  <div className="history-match-info">
                    <span className="history-tier">{tx(match.tierId)}</span>
                    <span className="history-type">{tx(match.roomType)}</span>
                  </div>
                  <div className="history-date">
                    {formatDate(match.createdAt)}
                  </div>
                </div>
                
                <div className="history-card-body">
                  <div className="history-my-stats">
                    <div className={`history-placement place-${myStats.placement}`}>
                      {myStats.placement}<span>{getOrdinal(myStats.placement)}</span>
                    </div>
                    <div className="history-score">{myStats.finalScore.toLocaleString()} pts</div>
                    
                    <div className="history-changes">
                      <div className={`change-item ${myStats.coinChange > 0 ? 'positive' : myStats.coinChange < 0 ? 'negative' : 'neutral'}`}>
                        <span className="change-icon">🪙</span>
                        {myStats.coinChange > 0 ? '+' : ''}{myStats.coinChange}
                      </div>
                      <div className={`change-item ${myStats.trophyChange > 0 ? 'positive' : myStats.trophyChange < 0 ? 'negative' : 'neutral'}`}>
                        <span className="change-icon">🏆</span>
                        {myStats.trophyChange > 0 ? '+' : ''}{myStats.trophyChange}
                      </div>
                    </div>
                  </div>
                  
                  <div className="history-players">
                    <div className="history-players-title">Players</div>
                    {sortedPlayers.map((player) => {
                      const playerId = typeof player.userId === 'object' ? player.userId?._id : player.userId;
                      const isMe = playerId === currentUser?.id;
                      const username = typeof player.userId === 'object' ? player.userId?.username : (isMe ? currentUser?.username : 'Unknown');
                      const avatar = typeof player.userId === 'object' ? player.userId?.avatar : (isMe ? currentUser?.avatar : null);
                      
                      return (
                        <div key={playerId} className={`history-player-row ${isMe ? 'is-me' : ''}`}>
                          <div className="history-player-left">
                            <span className="history-player-place">{player.placement}</span>
                            <img 
                              src={avatar || '/assets/avatars/default.png'} 
                              alt="avatar" 
                              className="history-player-avatar"
                              onError={(e) => { e.target.src = '/assets/avatars/default.png'; }}
                            />
                            <span className="history-player-name">{username} {isMe && '(You)'}</span>
                          </div>
                          <span className="history-player-score">{player.finalScore.toLocaleString()}</span>
                        </div>
                      );
                    })}
                    
                    <div className="history-win-info">
                      <div>Method: <strong>{tx(match.winningMethod)}</strong></div>
                      {match.winningTile && <div>Tile: <strong>{match.winningTile}</strong></div>}
                    </div>
                  </div>
                </div>
              </div>
            );
          })
        )}
      </main>
    </div>
  );
}
