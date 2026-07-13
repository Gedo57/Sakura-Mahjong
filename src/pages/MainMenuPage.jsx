import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ROUTES } from '../router/routes.js';
import { DEFAULT_DAILY_REWARD_SCHEDULE, claimDailyReward, getBalances, getDailyRewardStatus } from '../services/economyService.js';
import { saveMatchmakingContext } from '../store/gameStore.js';
import { getStoredAuthUser } from '../services/authService.js';
import { getRoomTiers } from '../services/roomService.js';
import { isMockApiEnabled } from '../services/api.js';
import { acceptFriendRequest as acceptFriendRequestApi, declineFriendRequest as declineFriendRequestApi, getApiErrorMessage, getBulkFriendStatus, getFriends, getIncomingFriendRequests, removeFriend as removeFriendApi, searchFriendUsers, sendFriendRequest } from '../services/friendsService.js';
import { useLanguage } from '../i18n/useLanguage.js';

const asset = (name) => `/assets/main-menu/${name}`;
const profileAsset = (name) => `/assets/profile/${name}`;
const dailyAsset = (name) => `/assets/daily-login/${name}`;
const PROFILE_AVATAR_STORAGE_KEY = 'sakura_profile_avatar';
const SAKURA_CUP_TIER_ID = 'sakura_garden_3p';

const PROFILE_AVATAR_ID_TO_FILE = {
  dragon_avatar: 'ICO.png',
  default: 'ICO.png',
  default_avatar: 'ICO.png',
  stevie: 'avatar-stevie.png',
  kiki: 'avatar-kiki.png',
  bunbun: 'avatar-bunbun.png',
  panda: 'avatar-panda.png',
};

const EMPTY_MENU_PROFILE = {
  id: '',
  username: 'Player',
  name: 'Player',
};

function pickFriendUser(friend = {}) {
  return friend.user
    || friend.friend
    || friend.profile
    || friend.player
    || friend.targetUser
    || friend.target
    || friend.recipient
    || friend.sender
    || friend.from
    || {};
}

function getFriendUserId(user) {
  const nestedUser = pickFriendUser(user || {});
  return user?.userId
    || user?.id
    || user?._id
    || user?.targetUserId
    || user?.friendId
    || nestedUser.userId
    || nestedUser.id
    || nestedUser._id
    || '';
}


function getFriendRequestId(request) {
  return request?.requestId
    || request?.id
    || request?._id
    || request?.friendRequestId
    || request?.friendshipId
    || request?.pendingRequestId
    || request?.incomingRequestId
    || request?.request?.id
    || request?.request?._id
    || request?.request?.requestId
    || '';
}

function pickFriendRequestUser(request = {}) {
  return request.sender
    || request.from
    || request.fromUser
    || request.requester
    || request.requestedBy
    || request.user
    || request.createdBy
    || request.owner
    || request.request?.sender
    || request.request?.from
    || request.request?.fromUser
    || {};
}

function getFriendRequestUserId(request = {}) {
  const user = pickFriendRequestUser(request);

  return request.fromUserId
    || request.senderId
    || request.requesterId
    || request.createdById
    || user.userId
    || user.id
    || user._id
    || request.userId
    || '';
}

function getFriendRequestName(request = {}) {
  const user = pickFriendRequestUser(request);

  return user.username
    || user.name
    || user.displayName
    || request.username
    || request.name
    || request.fromUsername
    || request.senderUsername
    || request.requesterUsername
    || request.request?.username
    || request.request?.fromUsername
    || 'Unknown player';
}

function getFriendRequestLevel(request = {}) {
  const user = pickFriendRequestUser(request);
  const level = user.level
    ?? request.level
    ?? request.fromLevel
    ?? request.senderLevel
    ?? request.requesterLevel
    ?? request.request?.level;

  if (level !== undefined && level !== null && String(level).trim() !== '') {
    return `Level ${level}`;
  }

  return user.levelLabel
    || request.levelLabel
    || request.sender?.levelLabel
    || request.from?.levelLabel
    || request.request?.levelLabel
    || '';
}

function getFriendRequestAvatar(request = {}) {
  const user = pickFriendRequestUser(request);

  return user.avatarUrl
    || user.imageUrl
    || user.avatar
    || user.avatarId
    || request.avatarUrl
    || request.imageUrl
    || request.avatar
    || request.avatarId
    || request.request?.avatar
    || request.request?.avatarId
    || '';
}

function getFriendAvatarSrc(avatarValue) {
  const avatar = normalizeProfileAvatarValue(avatarValue);

  if (!avatar) {
    return asset('friend-girl.png');
  }

  if (/^(https?:)?\/\//i.test(avatar) || avatar.startsWith('/')) {
    return avatar;
  }

  if (/\.(png|jpe?g|webp|gif|svg)$/i.test(avatar)) {
    return avatar.includes('/') ? avatar : profileAsset(avatar);
  }

  return asset('friend-girl.png');
}

function pickBestFriendSearchResult(results, query) {
  const normalizedQuery = String(query || '').trim().toLowerCase();

  if (!Array.isArray(results) || !results.length) {
    return null;
  }

  return results.find((user) => String(user?.playerId || '').toLowerCase() === normalizedQuery)
    || results.find((user) => String(user?.username || user?.name || '').toLowerCase() === normalizedQuery)
    || results.find((user) => getFriendUserId(user))
    || results[0];
}

function getStoredProfileAvatar() {
  try {
    return window.localStorage.getItem(PROFILE_AVATAR_STORAGE_KEY) || '';
  } catch {
    return '';
  }
}

function normalizeProfileAvatarValue(avatarValue) {
  if (typeof avatarValue !== 'string') {
    return '';
  }

  const avatar = avatarValue.trim();

  if (!avatar) {
    return '';
  }

  return PROFILE_AVATAR_ID_TO_FILE[avatar] || avatar;
}

function getOwnProfileAvatarValue(profile) {
  return getStoredProfileAvatar() || profile?.avatarUrl || profile?.imageUrl || profile?.avatar || profile?.avatarId || '';
}

function getFriendDisplayName(friend = {}) {
  const user = pickFriendUser(friend);
  return user.username
    || user.name
    || user.displayName
    || friend.username
    || friend.name
    || friend.displayName
    || friend.friendUsername
    || 'Friend';
}

function getFriendBackendStatus(friend = {}) {
  const user = pickFriendUser(friend);
  return user.status
    || user.state
    || user.onlineStatus
    || user.presence
    || friend.status
    || friend.state
    || friend.onlineStatus
    || friend.presence
    || '';
}

function formatFriendStatus(status) {
  if (status === true) return 'Online';
  if (status === false) return 'Offline';

  const value = String(status || '').trim();
  if (!value) return '';

  const normalized = value.toLowerCase();
  if (normalized === 'online' || normalized === 'active') return 'Online';
  if (normalized === 'offline' || normalized === 'inactive') return 'Offline';

  return value;
}

function isOwnProfileRecord(friend = {}, profile = {}) {
  const friendId = String(getFriendUserId(friend) || '').trim();
  const profileId = String(profile?.userId || profile?.id || profile?._id || '').trim();
  const friendName = String(getFriendDisplayName(friend) || '').trim().toLowerCase();
  const profileName = String(profile?.username || profile?.name || '').trim().toLowerCase();

  return Boolean((friendId && profileId && friendId === profileId) || (friendName && profileName && friendName === profileName));
}

function getFriendAvatarValue(friend = {}, profile = {}) {
  const user = pickFriendUser(friend);

  if (isOwnProfileRecord(friend, profile)) {
    const ownAvatar = getOwnProfileAvatarValue(profile);

    if (ownAvatar) {
      return ownAvatar;
    }
  }

  return user.avatarUrl
    || user.imageUrl
    || user.avatar
    || user.avatarId
    || friend.avatarUrl
    || friend.imageUrl
    || friend.avatar
    || friend.avatarId
    || friend.profileAvatar
    || friend.friendAvatar
    || 'friend-girl.png';
}

function getMainMenuAvatarSrc(profile) {
  const avatar = normalizeProfileAvatarValue(getOwnProfileAvatarValue(profile));

  if (!avatar) {
    return asset('friend-girl.png');
  }

  if (/^(https?:)?\/\//i.test(avatar) || avatar.startsWith('/')) {
    return avatar;
  }

  if (/\.(png|jpe?g|webp|gif|svg)$/i.test(avatar)) {
    return avatar.includes('/') ? avatar : profileAsset(avatar);
  }

  return asset('friend-girl.png');
}

function formatCurrencyValue(value, fallback = '—') {
  if (value === null || value === undefined || value === '') {
    return fallback;
  }

  const numericValue = Number(String(value).replace(/,/g, ''));

  if (Number.isFinite(numericValue)) {
    return numericValue.toLocaleString();
  }

  if (typeof value === 'string' && value.trim()) {
    return value;
  }

  return fallback;
}

function CurrencyPill({ icon, value }) {
  return (
    <div className="currency-pill">
      <img src={asset(icon)} alt="" />
      <span>{value}</span>
    </div>
  );
}

function SakuraBrand() {
  return (
    <div className="sakura-brand" aria-label="Sakura Mahjong">
      <span className="sakura-brand-flower">✿</span>
      <div className="sakura-brand-text">
        <strong>SAKURA</strong>
        <span>MAHJONG</span>      </div>
    </div>
  );
}

function SakuraPass({ onOpen }) {
  return (
    <aside className='sakura-pass-card' style={{ backgroundImage: `url(${asset('sakura-pass.png')})` }}>
      <div className='pass-copy'>              </div>          </aside>
  );
}

function getRoomSparkleTheme(roomBg = '') {
  if (roomBg.includes('green')) return 'room-theme-green';
  if (roomBg.includes('blue')) return 'room-theme-blue';
  if (roomBg.includes('purple') || roomBg.includes('violet')) return 'room-theme-purple';
  if (roomBg.includes('gold') || roomBg.includes('yellow') || roomBg.includes('orange')) return 'room-theme-gold';
  return 'room-theme-green';
}

function RoomCard({ room, onPlay, t, tx }) {
  const sparkleTheme = getRoomSparkleTheme(room.bg);

  return (
    <article className={`sakura-room-card ${sparkleTheme}`} style={{ backgroundImage: `url(${asset(room.bg)})` }}>
      <div className="room-card-sparkles" aria-hidden="true">
        <span className="card-sparkle sparkle-1" />
        <span className="card-sparkle sparkle-2" />
        <span className="card-sparkle sparkle-3" />
        <span className="card-sparkle sparkle-4" />
        <span className="card-sparkle sparkle-5" />
        <span className="card-sparkle sparkle-6" />
        <span className="card-sparkle sparkle-7" />
        <span className="card-sparkle sparkle-8" />
        <span className="card-sparkle sparkle-9" />
        <span className="card-sparkle sparkle-10" />
        <span className="card-sparkle sparkle-11" />
        <span className="card-sparkle sparkle-12" />
      </div>

      <div className="room-card-header">
        <h3>{room.title}</h3>
        <p>{tx(room.level)}</p>
      </div>
      <div className='room-character-wrap' aria-hidden="true">
        <img className='room-character' src={asset(room.character)} alt="" />
      </div>
      <div className='room-stat-list'>
        <div className="players-online-stat"><span className='lui-c65c7da8 lui-1e673fb0'>{t('playersOnline')}</span><strong className='lui-f014cab0 lui-16b816a0'><img className="players-online-icon" src="/assets/friends/icon-friends.png" alt="" />{room.players}</strong></div>
        <div><span className='lui-6646a870 lui-a7479fb4'>{t('bet')}</span><strong className='lui-80d469b8 lui-bdcac1ee lui-d210bc28'><img src={asset('coin.png')} alt="" />{room.fee}</strong></div>
        <div><span className='lui-589aefc0 lui-5c5e0744'>{t('prizePool')}</span><strong className='lui-249bee60 lui-8ff2b4fc'><img src={asset('prize.png')} alt="" />{room.prize}</strong></div>
      </div>
      <button className="image-button room-play-button" type="button" onClick={onPlay} style={{ backgroundImage: `url(${asset(room.button)})` }}>
        {t('playNow')}
      </button>
    </article>
  );
}



function getDailyRewardImage(day) {
  return `day-${day}.png`;
}

function getDailyRewardLabel(reward = {}) {
  if (reward.coins) {
    return `${reward.coins} Coins`;
  }

  if (reward.diamonds) {
    return `${reward.diamonds} Gems`;
  }

  if (reward.chest) {
    return 'Chest';
  }

  return 'Reward';
}

function DailyLoginPopup({ status, onClose, onClaim }) {
  const rewardSchedule = Array.isArray(status?.rewardSchedule) && status.rewardSchedule.length > 0
    ? status.rewardSchedule
    : DEFAULT_DAILY_REWARD_SCHEDULE;
  const rawStreak = Number(status?.claimableDay ?? status?.currentStreak ?? status?.streak ?? status?.newStreak ?? 1);
  const streak = Number.isFinite(rawStreak) && rawStreak > 0 ? rawStreak : 1;
  const canClaimToday = Boolean(status?.canClaimToday);
  const activeDay = Math.min(Math.max(streak, 1), rewardSchedule.length);
  const streakUnit = activeDay === 1 ? 'Day' : 'Days';

  return (
    <div className="daily-login-overlay" role="dialog" aria-modal="true" aria-label="Daily Login rewards">
      <div className="daily-login-panel" style={{ backgroundImage: `url(${dailyAsset('panel.png')})` }}>
        <button className="daily-login-close" type="button" onClick={onClose} aria-label="Close daily login">×</button>

        <div className="daily-login-streak">
          <img src={dailyAsset('gift.png')} alt="" />
          <span>Current Streak:</span>
          <strong>{activeDay} {streakUnit}</strong>
        </div>

        <div className="daily-login-cards">
          {rewardSchedule.map((reward) => {
            const rewardDay = Number(reward.day) || 1;
            const isClaimable = rewardDay === activeDay && canClaimToday;
            const isClaimed = rewardDay < activeDay || (rewardDay === activeDay && !canClaimToday);
            const isLocked = rewardDay > activeDay;

            return (
              <article className={`daily-login-card${isClaimable ? ' is-active' : ''}`} key={rewardDay} title={getDailyRewardLabel(reward)}>
                <img className="daily-login-card-art" src={dailyAsset(getDailyRewardImage(rewardDay))} alt={`Day ${rewardDay} - ${getDailyRewardLabel(reward)}`} />

                {isClaimed && (
                  <div className="daily-login-claimed">
                    <span>✓</span>
                    <strong>CLAIMED</strong>
                  </div>
                )}

                {isClaimable && (
                  <button className="daily-login-claim" type="button" onClick={onClaim} style={{ backgroundImage: `url(${dailyAsset('claim-button.png')})` }}>
                    CLAIM
                  </button>
                )}

                {isLocked && (
                  <img className="daily-login-lock" src={dailyAsset('lock.png')} alt="Locked" />
                )}
              </article>
            );
          })}
        </div>
      </div>
    </div>
  );
}


function AddFriendPopup({ value, onChange, onAccept, onCancel, t }) {
  return (
    <div className="add-friend-overlay" role="dialog" aria-modal="true" aria-label={t('addFriendTitle')}>
      <div className="add-friend-modal">
        <h2>{t('addFriendTitle')}</h2>
        <input
          className="add-friend-input"
          type="text"
          value={value}
          onChange={(event) => onChange(event.target.value)}
          placeholder={t('addFriendPlaceholder')}
          autoFocus
        />
        <div className="add-friend-actions">
          <button className="add-friend-accept" type="button" onClick={onAccept}>{t('accept')}</button>
          <button className="add-friend-cancel" type="button" onClick={onCancel}>{t('cancel')}</button>
        </div>
      </div>
    </div>
  );
}

function FriendRequestModal({ requests, onClose, onAccept, onDecline }) {
  return (
    <div className="friend-request-overlay" role="dialog" aria-modal="true" aria-label="Friend Requests">
      <div className="friend-request-modal">
        <div className="friend-request-header">
          <div>
            <strong>FRIEND REQUESTS</strong>
            <span>{requests.length} pending</span>
          </div>
          <button className="friend-request-close" type="button" onClick={onClose} aria-label="Close friend requests">×</button>
        </div>

        <div className="friend-request-list">
          {requests.length ? (
            requests.map((request) => (
              <div className="friend-request-row" key={request.id}>
                <img src={getFriendAvatarSrc(request.avatar)} alt="" />
                <div className="friend-request-copy">
                  <strong>{request.name}</strong>
                  <span>{request.level}</span>
                </div>
                <div className="friend-request-actions">
                  <button className="accept-request" type="button" onClick={() => onAccept(request)}>ACCEPT</button>
                  <button className="decline-request" type="button" onClick={() => onDecline(request)}>DECLINE</button>
                </div>
              </div>
            ))
          ) : (
            <div className="friend-request-empty">No pending requests</div>
          )}
        </div>
      </div>
    </div>
  );
}

function FriendRow({ friend, tx, onRemove }) {
  return (
    <div className="friend-row">
      <img src={getFriendAvatarSrc(friend.avatar)} alt="" />
      <div>
        <strong>{friend.name}</strong>
        {friend.state && <span>{tx(friend.state)}</span>}
      </div>
      <button
        className="remove-friend-button"
        type="button"
        onClick={() => onRemove(friend)}
        disabled={friend.isRemoving}
      >
        {friend.isRemoving ? '...' : 'REMOVE'}
      </button>
    </div>
  );
}

export default function MainMenuPage() {
  const navigate = useNavigate();
  const { t, tx } = useLanguage();
  const [roomCards, setRoomCards] = useState([]);
  const [profile, setProfile] = useState(() => getStoredAuthUser() || EMPTY_MENU_PROFILE);
  const [friendList, setFriendList] = useState([]);
  const [friendRequests, setFriendRequests] = useState([]);
  const [friendsError, setFriendsError] = useState('');
  const [isFriendRequestsOpen, setIsFriendRequestsOpen] = useState(false);
  const [isAddFriendOpen, setIsAddFriendOpen] = useState(false);
  const [friendName, setFriendName] = useState('');
  const [isDailyLoginOpen, setIsDailyLoginOpen] = useState(false);
  const [balances, setBalances] = useState(() => ({
    coins: null,
    diamonds: null,
  }));
  const [dailyRewardStatus, setDailyRewardStatus] = useState(null);

  useEffect(() => {
    let isMounted = true;

    Promise.allSettled([getBalances(), getDailyRewardStatus(), getRoomTiers(), getFriends(), getIncomingFriendRequests()])
      .then(([balancesResult, rewardResult, roomTiersResult, friendsResult, requestsResult]) => {
        if (!isMounted) {
          return;
        }

        const economyBalances = balancesResult.status === 'fulfilled' ? balancesResult.value : null;
        const rewardStatus = rewardResult.status === 'fulfilled' ? rewardResult.value : null;

        if (balancesResult.status === 'rejected') {
          console.error('Failed to load balances:', balancesResult.reason);
        }

        if (rewardResult.status === 'rejected') {
          console.error('Failed to load daily reward status:', rewardResult.reason);
        }

        const roomTiers = roomTiersResult.status === 'fulfilled' ? roomTiersResult.value : null;

        if (roomTiersResult.status === 'rejected') {
          console.error('Failed to load room tiers:', roomTiersResult.reason);
        }

        setRoomCards(Array.isArray(roomTiers) ? roomTiers : []);
        setProfile((current) => current || EMPTY_MENU_PROFILE);

        if (economyBalances) {
          setBalances({
            coins: economyBalances.coins ?? null,
            diamonds: economyBalances.diamonds ?? economyBalances.gems ?? null,
          });
        }

        const backendFriends = friendsResult.status === 'fulfilled' ? friendsResult.value : null;
        const backendRequests = requestsResult.status === 'fulfilled' ? requestsResult.value : null;

        if (friendsResult.status === 'rejected') {
          console.error('Failed to load friends:', friendsResult.reason);
          setFriendsError('Failed to load friends');
          if (!isMockApiEnabled()) {
            setFriendList([]);
          }
        }

        if (requestsResult.status === 'rejected') {
          console.error('Failed to load friend requests:', requestsResult.reason);
          setFriendsError('Failed to load friend requests');
          if (!isMockApiEnabled()) {
            setFriendRequests([]);
          }
        }

        if (friendsResult.status === 'fulfilled') {
          const mappedFriends = backendFriends.map((friend) => {
            const userId = getFriendUserId(friend);

            return {
              id: userId || friend.username || friend.name,
              userId,
              name: getFriendDisplayName(friend),
              state: formatFriendStatus(getFriendBackendStatus(friend)),
              action: 'REMOVE',
              avatar: getFriendAvatarValue(friend, profile),
              raw: friend,
            };
          });

          setFriendList(mappedFriends);

          const friendUserIds = mappedFriends.map((friend) => friend.userId).filter(Boolean);
          if (friendUserIds.length) {
            getBulkFriendStatus(friendUserIds)
              .then((statuses) => {
                if (!isMounted || !statuses || typeof statuses !== 'object') {
                  return;
                }

                setFriendList((current) => current.map((friend) => ({
                  ...friend,
                  state: formatFriendStatus(statuses[friend.userId] ?? friend.state),
                })));
              })
              .catch((error) => {
                console.error('Failed to load friend online statuses:', error);
              });
          }
        }

        if (requestsResult.status === 'fulfilled') {
          setFriendRequests(backendRequests.map((request) => ({
            id: getFriendRequestId(request),
            userId: getFriendRequestUserId(request),
            name: getFriendRequestName(request),
            level: getFriendRequestLevel(request),
            avatar: getFriendRequestAvatar(request),
            raw: request,
          })).filter((request) => request.id));
        }

        setDailyRewardStatus(rewardStatus || null);
      });

    return () => {
      isMounted = false;
    };
  }, []);

  const handleClaimDailyReward = async () => {
    if (!dailyRewardStatus?.canClaimToday) {
      return;
    }

    try {
      const response = await claimDailyReward();
      const claimPayload = response?.data || response || {};
      const claimBalances = claimPayload.balances;

      if (claimBalances) {
        setBalances((current) => ({
          coins: claimBalances.coins ?? current.coins,
          diamonds: claimBalances.diamonds ?? claimBalances.gems ?? current.diamonds,
        }));
      }

      const [balancesResult, rewardStatusResult] = await Promise.allSettled([
        getBalances(),
        getDailyRewardStatus(),
      ]);

      if (balancesResult.status === 'fulfilled') {
        setBalances({
          coins: balancesResult.value?.coins ?? null,
          diamonds: balancesResult.value?.diamonds ?? balancesResult.value?.gems ?? null,
        });
      }

      if (rewardStatusResult.status === 'fulfilled') {
        setDailyRewardStatus(rewardStatusResult.value || null);
      } else {
        setDailyRewardStatus((current) => ({
          ...(current || {}),
          canClaimToday: false,
          currentStreak: claimPayload.streak?.current ?? claimPayload.newStreak ?? claimPayload.currentStreak ?? current?.currentStreak ?? 1,
        }));
      }
    } catch (error) {
      console.error('Failed to claim daily reward:', error);
    }
  };

  const handleAcceptAddFriend = async () => {
    const nextFriendQuery = friendName.trim();

    if (!nextFriendQuery) {
      return;
    }

    try {
      const searchResults = await searchFriendUsers(nextFriendQuery);
      const selectedUser = pickBestFriendSearchResult(searchResults, nextFriendQuery);
      const targetUserId = getFriendUserId(selectedUser);

      if (!targetUserId) {
        throw new Error('Friend not found. Search by username or Player ID.');
      }

      await sendFriendRequest(targetUserId);
      setFriendName('');
      setIsAddFriendOpen(false);
      setFriendsError('Friend request sent');
    } catch (error) {
      const message = getApiErrorMessage(error, 'Failed to send friend request');
      console.error('Failed to send friend request:', message, error);
      setFriendsError(message);
    }
  };

  const acceptFriendRequest = async (request) => {
    const requestId = getFriendRequestId(request);

    if (!requestId) {
      setFriendsError('Friend request id is missing');
      console.error('Failed to accept friend request: missing requestId', request);
      return;
    }

    try {
      await acceptFriendRequestApi(requestId);
      setFriendList((current) => [
        ...current,
        { id: request.userId || requestId, userId: request.userId, name: request.name, state: '', action: 'REMOVE', avatar: request.avatar },
      ]);
      setFriendRequests((current) => current.filter((item) => getFriendRequestId(item) !== requestId));
      setFriendsError('Friend request accepted');
    } catch (error) {
      const message = getApiErrorMessage(error, 'Failed to accept friend request');
      console.error('Failed to accept friend request:', message, error);
      setFriendsError(message);
    }
  };

  const declineFriendRequest = async (request) => {
    const requestId = getFriendRequestId(request);

    if (!requestId) {
      setFriendsError('Friend request id is missing');
      console.error('Failed to decline friend request: missing requestId', request);
      return;
    }

    try {
      await declineFriendRequestApi(requestId);
    } catch (error) {
      const message = getApiErrorMessage(error, 'Failed to decline friend request');
      console.error('Failed to decline friend request:', message, error);
      setFriendsError(message);
      return;
    }

    setFriendRequests((current) => current.filter((item) => getFriendRequestId(item) !== requestId));
  };


  const handleRemoveFriend = async (friend) => {
    const friendId = friend?.userId || friend?.id || getFriendUserId(friend?.raw || friend);

    if (!friendId) {
      setFriendsError('Friend id is missing');
      console.error('Failed to remove friend: missing friendId', friend);
      return;
    }

    setFriendList((current) => current.map((item) => (
      item.id === friend.id ? { ...item, isRemoving: true } : item
    )));

    try {
      await removeFriendApi(friendId);
      setFriendList((current) => current.filter((item) => item.id !== friend.id));
      setFriendsError('Friend removed');
    } catch (error) {
      const message = getApiErrorMessage(error, 'Failed to remove friend');
      console.error('Failed to remove friend:', message, error);
      setFriendsError(message);
      setFriendList((current) => current.map((item) => (
        item.id === friend.id ? { ...item, isRemoving: false } : item
      )));
    }
  };

  return (
    <section className="main-menu-ui main-menu-reference">
      <aside className="sakura-sidebar">
        <SakuraBrand />
        <SakuraPass onOpen={() => navigate(ROUTES.profile)} />
      </aside>

      <div className="main-menu-content">
        <header className="sakura-topbar">
          <div className="topbar-spacer" />
          <div className="topbar-actions">
            <CurrencyPill icon="coin.png" value={formatCurrencyValue(balances.coins)} />
            <CurrencyPill icon="gem.png" value={formatCurrencyValue(balances.diamonds)} />
            <button
              className="square-top-button leaderboard-menu-button"
              type="button"
              aria-label="Open leaderboard"
              onClick={() => navigate(ROUTES.leaderboard)}
              title="Open leaderboard"
            >
              <img src="/assets/leaderboard/icon-leaderboard.png" alt="" />
            </button>
            <button
              className="square-top-button missions-menu-button"
              type="button"
              aria-label="Open missions"
              onClick={() => navigate(ROUTES.missions)}
              title="Open missions"
            >
              <img src="/assets/missions/icon-missions.png" alt="" />
            </button>
            <button
              className="square-top-button friends-menu-button"
              type="button"
              aria-label={t('addFriendTitle')}
              onClick={() => setIsAddFriendOpen(true)}
              title={t('addFriendTitle')}
            >
              <img src="/assets/friends/icon-friends.png" alt="" />
            </button>
            <button
              className="square-top-button daily-login-menu-button"
              type="button"
              aria-label={t('rewards')}
              onClick={() => setIsDailyLoginOpen(true)}
              title="Open daily login"
            >
              <img src={dailyAsset('gift.png')} alt="" />
            </button>
            <button className="profile-pill" type="button" onClick={() => navigate(ROUTES.profile)} aria-label={t('openProfile')}>
              <img src={getMainMenuAvatarSrc(profile)} alt="" />
              <span>⌄</span>
            </button>
          </div>
        </header>

        <div className="main-dashboard">
          <main className='room-section'>
            <div className="hero-banner" style={{ backgroundImage: `url(${asset('bg.png')})` }} aria-hidden="true" />

            <div className="sakura-room-grid">
              {roomCards.length ? roomCards.map((room) => (
                <RoomCard
                  key={room.id || room.roomId || room.tierId || room.title}
                  room={room}
                  t={t}
                  tx={tx}
                  onPlay={() => {
                    const matchmakingState = {
                      roomId: room.roomId || room.id || room.tierId || room.title,
                      tierId: room.tierId || room.id || room.roomId || '',
                      maxPlayers: Number(room.maxPlayers) || 3,
                      source: 'room-card',
                    };
                    saveMatchmakingContext(matchmakingState);
                    navigate(ROUTES.matchmaking, { state: matchmakingState });
                  }}
                />
              )) : (
                <div className="rooms-empty-state">No rooms available.</div>
              )}
            </div>

            <div className="bottom-room-actions">
              <section className="small-action-panel private-room" style={{ backgroundImage: `url(${asset('private-room-art.png')})` }}>
                <div>
                  <h3>{t('createPrivateRoom')}</h3>
                  <p>{t('createPrivateRoomText')}</p>
                  <button type="button" onClick={() => navigate(ROUTES.createRoom)}>{t('createRoom')}</button>
                </div>
              </section>

              <section className="small-action-panel room-code join-room-entry-panel" style={{ backgroundImage: `url(${asset('room-code-art.png')})` }}>
                <div>
                  <h3>{t('joinRoom')}</h3>
                  <p>{t('joinRoomPanelText')}</p>
                  <button type="button" onClick={() => navigate(ROUTES.joinRoom)}>
                    {t('joinRoom')}
                  </button>
                </div>
              </section>
            </div>
          </main>

          <aside className="right-panel">
            <section className="friends-panel">
              <div className="friends-panel-header">
                <h2>{t('friendsOnline')} • {friendList.length}</h2>
                <button className="friend-requests-button" type="button" onClick={() => setIsFriendRequestsOpen(true)} aria-label="Open friend requests">
                  REQ
                  {friendRequests.length > 0 && <span>{friendRequests.length}</span>}
                </button>
              </div>
              {friendsError && <div className="friends-api-status">{friendsError}</div>}
              <div className="friend-list">
                {friendList.length > 0 ? friendList.map((friend) => (
                  <FriendRow key={`${friend.id || friend.name}-${friend.state}`} friend={friend} tx={tx} onRemove={handleRemoveFriend} />
                )) : <div className="friends-empty-state">No friends</div>}
              </div>
              <button className="view-all" type="button">{t('viewAllFriends')} <span>›</span></button>
            </section>

            <section className="cup-panel">
              <img src={asset('sakura-cup.png')} alt="" />
              <div className="cup-copy">                <p>{t('prizePool')}</p>
                <strong><img src={asset('coin.png')} alt="" />50,000</strong>
                <small>{t('endsIn')}</small>
                <button
                  type="button"
                  onClick={() => {
                    const matchmakingContext = { tierId: SAKURA_CUP_TIER_ID, maxPlayers: 3, source: 'sakura-cup' };
                    saveMatchmakingContext(matchmakingContext);
                    navigate(ROUTES.matchmaking, { state: matchmakingContext });
                  }}
                >
                  {t('joinNow')}
                </button>
              </div>
            </section>
          </aside>
        </div>

        {isAddFriendOpen && (
          <AddFriendPopup
            value={friendName}
            onChange={setFriendName}
            onAccept={handleAcceptAddFriend}
            t={t}
            onCancel={() => {
              setFriendName('');
              setIsAddFriendOpen(false);
            }}
          />
        )}

        {isDailyLoginOpen && (
          <DailyLoginPopup
            status={dailyRewardStatus}
            onClose={() => setIsDailyLoginOpen(false)}
            onClaim={handleClaimDailyReward}
          />
        )}

        {isFriendRequestsOpen && (
          <FriendRequestModal
            requests={friendRequests}
            onClose={() => setIsFriendRequestsOpen(false)}
            onAccept={acceptFriendRequest}
            onDecline={declineFriendRequest}
          />
        )}

        <footer className="sakura-footer">
          <div>
            <strong>{t('fairPlayGuaranteed')}</strong>
            <small>{t('fairPlayText')}</small>
          </div>
          <span>{t('terms')}</span>
          <span>{t('privacy')}</span>
          <span>{t('support')}</span>
          <span>{t('copyright').replace('© ', '')}</span>
        </footer>
      </div>
    </section>
  );
}
