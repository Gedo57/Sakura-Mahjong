import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ROUTES } from '../router/routes.js';
import { getProfile, normalizeProfileStats, updateProfile } from '../services/profileService.js';
import { claimAchievement, getAchievements } from '../services/achievementsService.js';
import { getStoredAuthUser, logout } from '../services/authService.js';
import { useLanguage } from '../i18n/useLanguage.js';

const asset = (name) => `/assets/profile/${name}`;
const DEFAULT_PROFILE_AVATAR = 'ICO.png';
const PROFILE_AVATAR_STORAGE_KEY = 'sakura_profile_avatar';
const AUTH_USER_STORAGE_KEY = 'sakura_auth_user';
const PROFILE_AVATAR_ID_TO_FILE = {
  dragon_avatar: 'ICO.png',
  default: 'ICO.png',
  default_avatar: 'ICO.png',
  stevie: 'avatar-stevie.png',
  kiki: 'avatar-kiki.png',
  bunbun: 'avatar-bunbun.png',
  panda: 'avatar-panda.png',
};
const PROFILE_AVATAR_OPTIONS = [
  { id: 'stevie', label: 'Stevie', file: 'avatar-stevie.png' },
  { id: 'kiki', label: 'Kiki', file: 'avatar-kiki.png' },
  { id: 'bunbun', label: 'Bunbun', file: 'avatar-bunbun.png' },
  { id: 'panda', label: 'Panda', file: 'avatar-panda.png' },
];
const PROFILE_TITLE_OPTIONS = ['Novice', 'Apprentice', 'Master', 'Grand Master', 'Legendary'];
const XP_TRACK_ASSET = 'profile-xp-track.png';
const XP_FILL_ASSET = 'profile-xp-fill.png';
const ACHIEVEMENT_CARD_ASSETS = ['C1.png', 'C2.png', 'C3.png', 'C4.png'];

const EMPTY_PROFILE = {
  id: '',
  userId: '',
  playerId: '',
  username: 'Player',
  name: 'Player',
  level: 0,
  trophies: 0,
  title: 'Novice',
  avatar: DEFAULT_PROFILE_AVATAR,
  avatarId: 'dragon_avatar',
  rank: {
    title: 'Novice',
    progressText: '',
    currentXP: 0,
    requiredXP: 0,
  },
  wallet: {
    coins: 0,
    gems: 0,
  },
};


function getStoredProfileAvatar() {
  try {
    return window.localStorage.getItem(PROFILE_AVATAR_STORAGE_KEY) || '';
  } catch {
    return '';
  }
}

function persistProfileAvatar(avatar) {
  try {
    if (!avatar) {
      window.localStorage.removeItem(PROFILE_AVATAR_STORAGE_KEY);
      return;
    }

    window.localStorage.setItem(PROFILE_AVATAR_STORAGE_KEY, avatar);
  } catch {
    // Local storage is optional. Ignore quota/privacy errors.
  }
}

function persistAuthUserAvatar(avatar) {
  try {
    const rawUser = window.localStorage.getItem(AUTH_USER_STORAGE_KEY);
    const user = rawUser ? JSON.parse(rawUser) : null;

    if (!user || typeof user !== 'object') {
      return;
    }

    window.localStorage.setItem(AUTH_USER_STORAGE_KEY, JSON.stringify({
      ...user,
      avatar,
      avatarId: avatar,
    }));
  } catch {
    // Local storage is optional. Ignore invalid stored auth payloads.
  }
}

function parseNumber(value) {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }

  if (typeof value !== 'string') {
    return 0;
  }

  const parsed = Number(value.replace(/[^0-9.-]/g, ''));
  return Number.isFinite(parsed) ? parsed : 0;
}

function parseProgressText(progressText) {
  if (typeof progressText !== 'string') {
    return null;
  }

  const match = progressText.match(/([\d,.]+)\s*\/\s*([\d,.]+)/);

  if (!match) {
    return null;
  }

  return {
    current: parseNumber(match[1]),
    target: parseNumber(match[2]),
  };
}

function clampPercent(value) {
  if (!Number.isFinite(value)) {
    return 0;
  }

  return Math.max(0, Math.min(100, value));
}

function getProgressPercent(current, target) {
  if (!target || target <= 0) {
    return 0;
  }

  return clampPercent((current / target) * 100);
}

function getProfileXpData(profile) {
  const parsedRankProgress = parseProgressText(profile?.rank?.progressText);
  const current = parseNumber(
    profile?.currentXP ??
      profile?.currentXp ??
      profile?.xp ??
      profile?.rank?.currentXP ??
      profile?.rank?.currentXp ??
      parsedRankProgress?.current ??
      0,
  );
  const target = parseNumber(
    profile?.requiredXP ??
      profile?.requiredXp ??
      profile?.nextLevelXP ??
      profile?.nextLevelXp ??
      profile?.rank?.requiredXP ??
      profile?.rank?.requiredXp ??
      profile?.rank?.nextLevelXP ??
      profile?.rank?.nextLevelXp ??
      parsedRankProgress?.target ??
      0,
  );

  return {
    current,
    target,
    percent: getProgressPercent(current, target),
    text: profile?.rank?.progressText || `${current.toLocaleString()} / ${target.toLocaleString()}`,
  };
}

function getProgressObjectValue(value, ...keys) {
  if (!value || typeof value !== 'object') return undefined;
  for (const key of keys) {
    if (value[key] !== undefined && value[key] !== null) return value[key];
  }
  return undefined;
}

function getAchievementProgressData(item) {
  const progressObject = item?.progress && typeof item.progress === 'object' ? item.progress : null;
  const parsedProgress = parseProgressText(typeof item?.progress === 'string' ? item.progress : item?.progressText);
  const progressNumber = typeof item?.progress === 'number' ? item.progress : null;
  const current = parseNumber(
    item?.currentXP
      ?? item?.currentXp
      ?? item?.currentProgress
      ?? item?.progressCurrent
      ?? item?.lifetimeProgress
      ?? item?.userProgress
      ?? item?.completedCount
      ?? item?.count
      ?? item?.xp
      ?? item?.current
      ?? getProgressObjectValue(progressObject, 'current', 'value', 'progress', 'count', 'completed')
      ?? progressNumber
      ?? parsedProgress?.current
      ?? 0,
  );
  const target = parseNumber(
    item?.requiredXP
      ?? item?.requiredXp
      ?? item?.targetXP
      ?? item?.targetXp
      ?? item?.targetProgress
      ?? item?.requiredProgress
      ?? item?.required
      ?? item?.goal
      ?? item?.max
      ?? item?.total
      ?? item?.target
      ?? getProgressObjectValue(progressObject, 'target', 'required', 'goal', 'max', 'total')
      ?? parsedProgress?.target
      ?? (item?.complete || item?.completed || item?.isComplete || item?.unlocked ? current || 1 : 1),
  );

  return {
    current,
    target,
    percent: item?.complete || item?.completed || item?.isComplete || item?.unlocked ? 100 : getProgressPercent(current, target),
    text: (item?.complete || item?.completed || item?.isComplete || item?.unlocked) && !target ? 'Completed' : `${current}/${target}`,
  };
}

function XpProgressBar({ className = '', percent, label }) {
  return (
    <div
      aria-label={label}
      aria-valuemax="100"
      aria-valuemin="0"
      aria-valuenow={Math.round(clampPercent(percent))}
      className={`profile-xp-progress ${className}`.trim()}
      role="progressbar"
      style={{ '--xp-progress': `${clampPercent(percent)}%` }}
    >
      <img className="profile-xp-progress-track" src={asset(XP_TRACK_ASSET)} alt="" />
      <div className="profile-xp-progress-fill-clip">
        <img className="profile-xp-progress-fill" src={asset(XP_FILL_ASSET)} alt="" />
      </div>
    </div>
  );
}

function getDisplayName(profile) {
  return profile?.username || profile?.name || 'Player';
}


function getProfilePlayerId(profile) {
  const rawPlayerId = profile?.playerId ?? profile?.playerID ?? profile?.publicId ?? '';

  if (rawPlayerId === null || rawPlayerId === undefined) {
    return '';
  }

  return String(rawPlayerId).trim();
}

function getInitialStoredProfile() {
  const storedUser = getStoredAuthUser();

  if (!storedUser || typeof storedUser !== 'object') {
    return null;
  }

  // Only keep identity fields for the first paint. XP, rank, trophies and
  // stats must come from GET /api/auth/profile, not from old mock/localStorage.
  const { id, userId, playerId, username, name, email, avatar, avatarId, avatarUrl, imageUrl } = storedUser;
  return { id, userId, playerId, username, name, email, avatar, avatarId, avatarUrl, imageUrl };
}

function getProfileWithDefaults(profile) {
  const storedAvatar = getStoredProfileAvatar();
  const safeProfile = profile && typeof profile === 'object' ? profile : {};

  return {
    ...EMPTY_PROFILE,
    ...safeProfile,
    ...(storedAvatar ? { avatar: storedAvatar } : {}),
    rank: {
      ...EMPTY_PROFILE.rank,
      ...(safeProfile.rank && typeof safeProfile.rank === 'object' ? safeProfile.rank : {}),
    },
    wallet: {
      ...EMPTY_PROFILE.wallet,
      ...(safeProfile.wallet && typeof safeProfile.wallet === 'object' ? safeProfile.wallet : {}),
    },
  };
}


function getAchievementId(item, fallbackId = '') {
  return item?.achievementId
    || item?.achievement_id
    || item?.achievement?.id
    || item?.achievement?._id
    || item?.id
    || item?._id
    || item?.slug
    || item?.key
    || item?.code
    || item?.name
    || fallbackId
    || '';
}

function isAchievementComplete(item) {
  if (item?.complete ?? item?.completed ?? item?.isComplete ?? item?.unlocked ?? item?.isUnlocked) {
    return true;
  }

  if (String(item?.status || '').toLowerCase() === 'completed') {
    return true;
  }

  const progressData = getAchievementProgressData(item);
  return progressData.target > 0 && progressData.current >= progressData.target;
}

function isAchievementClaimable(item) {
  if (item?.claimed || item?.isClaimed || item?.rewardClaimed) {
    return false;
  }

  if (String(item?.status || '').toLowerCase() === 'claimed') {
    return false;
  }

  if (String(item?.status || '').toLowerCase() === 'claimable') {
    return true;
  }

  return Boolean(item?.claimable ?? item?.canClaim ?? item?.readyToClaim ?? isAchievementComplete(item));
}

function normalizeAchievements(items) {
  if (!Array.isArray(items)) {
    return [];
  }

  return items
    .filter((item) => item && typeof item === 'object')
    .map((item, index) => {
      const achievement = item?.achievement && typeof item.achievement === 'object' ? item.achievement : {};
      const title = item?.title || item?.name || item?.achievementName || achievement?.title || achievement?.name || `Achievement ${index + 1}`;
      const description = item?.description || item?.details || achievement?.description || achievement?.details || '';
      const id = getAchievementId(item, title);

      return {
        ...item,
        id,
        achievementId: id,
        title,
        description,
        progress: item?.progress ?? achievement?.progress,
        card: item?.card || item?.cardAsset || item?.background || achievement?.card || achievement?.cardAsset || achievement?.background || ACHIEVEMENT_CARD_ASSETS[index % ACHIEVEMENT_CARD_ASSETS.length],
        complete: isAchievementComplete(item),
        claimed: Boolean(item?.claimed ?? item?.isClaimed ?? item?.rewardClaimed ?? String(item?.status || '').toLowerCase() === 'claimed'),
        claimable: isAchievementClaimable(item),
      };
    });
}

function getProfileAvatarFile(value) {
  if (typeof value !== 'string') {
    return '';
  }

  const avatar = value.trim();

  if (!avatar) {
    return '';
  }

  return PROFILE_AVATAR_ID_TO_FILE[avatar] || avatar;
}

function getAvatarSrc(profile) {
  const avatar = getProfileAvatarFile(profile?.avatarUrl || profile?.imageUrl || profile?.avatar || profile?.avatarId);

  if (!avatar) {
    return asset(DEFAULT_PROFILE_AVATAR);
  }

  if (/^(https?:)?\/\//i.test(avatar) || avatar.startsWith('/')) {
    return avatar;
  }

  if (/\.(png|jpe?g|webp|gif|svg)$/i.test(avatar)) {
    return asset(avatar);
  }

  return asset(DEFAULT_PROFILE_AVATAR);
}

function normalizeProfileTitle(title) {
  if (typeof title !== 'string') {
    return PROFILE_TITLE_OPTIONS[0];
  }

  const normalizedTitle = title.trim();
  return PROFILE_TITLE_OPTIONS.includes(normalizedTitle) ? normalizedTitle : PROFILE_TITLE_OPTIONS[0];
}

function getProfileTitle(profile) {
  return normalizeProfileTitle(profile?.rank?.title || profile?.title);
}

function getProfileAvatarId(profile, fallbackAvatarId = 'dragon_avatar') {
  const avatarValue = profile?.avatarId || profile?.avatar;

  if (typeof avatarValue !== 'string') {
    return fallbackAvatarId;
  }

  const avatarId = avatarValue.trim();

  if (!avatarId) {
    return fallbackAvatarId;
  }

  if (/\.(png|jpe?g|webp|gif|svg)$/i.test(avatarId) || avatarId.startsWith('/')) {
    return fallbackAvatarId;
  }

  return avatarId;
}

function getProfileUpdatePayload(_profile, overrides = {}) {
  const payload = {};

  if (Object.prototype.hasOwnProperty.call(overrides, 'avatarId') && overrides.avatarId) {
    payload.avatarId = overrides.avatarId;
  }

  if (Object.prototype.hasOwnProperty.call(overrides, 'title')) {
    const safeTitle = normalizeProfileTitle(overrides.title);

    if (PROFILE_TITLE_OPTIONS.includes(safeTitle)) {
      payload.title = safeTitle;
    }
  }

  return payload;
}

function normalizeProfileUpdateResponse(response, currentProfile, fallbackValues = {}) {
  const responseProfile = response?.profile || response?.user || response;

  return getProfileWithDefaults({
    ...currentProfile,
    ...(responseProfile && typeof responseProfile === 'object' ? responseProfile : {}),
    ...fallbackValues,
    rank: {
      ...currentProfile.rank,
      ...(responseProfile?.rank && typeof responseProfile.rank === 'object' ? responseProfile.rank : {}),
      ...(fallbackValues.rank && typeof fallbackValues.rank === 'object' ? fallbackValues.rank : {}),
    },
  });
}

function normalizeUpdatedProfile(response, currentProfile, username) {
  const nextProfile = response?.profile || response?.user || response;

  return {
    ...currentProfile,
    ...(nextProfile && typeof nextProfile === 'object' ? nextProfile : {}),
    username,
    name: username,
  };
}


function AvatarPickerPanel({ activeAvatar, onClose, onSelect, t }) {
  return (
    <div className="profile-avatar-modal-backdrop" role="presentation" onMouseDown={(event) => {
      if (event.target === event.currentTarget) {
        onClose();
      }
    }}>
      <section className="profile-avatar-modal" aria-label={t('chooseAvatar')}>
        <div className="profile-avatar-modal-header">
          <h2>{t('chooseAvatar')}</h2>
          <button className="profile-avatar-modal-close" type="button" onClick={onClose} aria-label={t('close')}>×</button>
        </div>
        <div className="profile-avatar-option-grid">
          {PROFILE_AVATAR_OPTIONS.map((option) => {
            const isActive = activeAvatar === option.file || activeAvatar === option.id;

            return (
              <button
                className={`profile-avatar-option${isActive ? ' active' : ''}`}
                key={option.id}
                type="button"
                onClick={() => onSelect(option)}
              >
                <img src={asset(option.file)} alt={option.label} />
                <span>{option.label}</span>
                {isActive ? <strong>{t('selectedAvatar')}</strong> : null}
              </button>
            );
          })}
        </div>
      </section>
    </div>
  );
}

function TitlePickerPanel({ activeTitle, isSaving, onClose, onSelect, t, tx }) {
  return (
    <div className="profile-avatar-modal-backdrop" role="presentation" onMouseDown={(event) => {
      if (event.target === event.currentTarget) {
        onClose();
      }
    }}>
      <section className="profile-avatar-modal profile-title-modal" aria-label={t('chooseTitle')}>
        <div className="profile-avatar-modal-header">
          <h2>{t('chooseTitle')}</h2>
          <button className="profile-avatar-modal-close" type="button" onClick={onClose} aria-label={t('close')}>×</button>
        </div>
        <div className="profile-title-option-grid">
          {PROFILE_TITLE_OPTIONS.map((title) => {
            const isActive = activeTitle === title;

            return (
              <button
                className={`profile-title-modal-option${isActive ? ' active' : ''}`}
                disabled={isSaving}
                key={title}
                type="button"
                onClick={() => onSelect(title)}
              >
                <span>{tx(title)}</span>
                {isActive ? <strong>{t('selectedTitle')}</strong> : null}
              </button>
            );
          })}
        </div>
      </section>
    </div>
  );
}

export default function ProfilePage() {
  const navigate = useNavigate();
  const { t, tx } = useLanguage();
  const [profile, setProfile] = useState(() => getProfileWithDefaults(getInitialStoredProfile()));
  const [stats, setStats] = useState([]);
  const [achievements, setAchievements] = useState([]);
  const [loadError, setLoadError] = useState('');
  const [isEditingName, setIsEditingName] = useState(false);
  const [isAvatarPickerOpen, setIsAvatarPickerOpen] = useState(false);
  const [isTitlePickerOpen, setIsTitlePickerOpen] = useState(false);
  const [draftName, setDraftName] = useState(() => getDisplayName(getProfileWithDefaults(getInitialStoredProfile())));
  const [saveStatus, setSaveStatus] = useState('idle');
  const [saveError, setSaveError] = useState('');
  const [selectedTitle, setSelectedTitle] = useState(() => getProfileTitle(getProfileWithDefaults(getInitialStoredProfile())));
  const [isSavingTitle, setIsSavingTitle] = useState(false);
  const [titleSaveStatus, setTitleSaveStatus] = useState('idle');
  const [titleSaveError, setTitleSaveError] = useState('');
  const [claimingAchievementId, setClaimingAchievementId] = useState('');
  const [achievementClaimError, setAchievementClaimError] = useState('');
  const [achievementClaimMessage, setAchievementClaimMessage] = useState('');

  useEffect(() => {
    let isMounted = true;

    Promise.all([getProfile(), getAchievements()])
      .then(([playerProfile, playerAchievements]) => {
        if (!isMounted) {
          return;
        }

        const nextProfile = getProfileWithDefaults(playerProfile);
        setProfile(nextProfile);
        setDraftName(getDisplayName(nextProfile));
        setSelectedTitle(getProfileTitle(nextProfile));
        setStats(normalizeProfileStats(nextProfile));
        setAchievements(normalizeAchievements(playerAchievements));
      })
      .catch((error) => {
        console.error('Failed to load profile:', error);
        if (isMounted) {
          setLoadError(error.message || t('profileLoadFailed'));
        }
      });

    return () => {
      isMounted = false;
    };
  }, []);

  function handleLogout() {
    logout();
    navigate(ROUTES.start, { replace: true });
  }

  function startEditingName() {
    setDraftName(getDisplayName(profile));
    setSaveError('');
    setSaveStatus('idle');
    setIsEditingName(true);
  }

  function cancelEditingName() {
    setDraftName(getDisplayName(profile));
    setSaveError('');
    setSaveStatus('idle');
    setIsEditingName(false);
  }


  async function selectProfileAvatar(option) {
    if (!option) {
      return;
    }

    const nextAvatarId = typeof option === 'string' ? getProfileAvatarId({ avatarId: option }) : option.id;
    const nextAvatarFile = typeof option === 'string' ? option : option.file;

    if (!nextAvatarId || !nextAvatarFile) {
      return;
    }

    persistProfileAvatar(nextAvatarFile);
    persistAuthUserAvatar(nextAvatarId);

    setProfile((currentProfile) => ({
      ...currentProfile,
      avatar: nextAvatarFile,
      avatarId: nextAvatarId,
    }));
    setIsAvatarPickerOpen(false);

    try {
      await updateProfile(getProfileUpdatePayload(profile, { avatarId: nextAvatarId }));
    } catch (error) {
      // The avatar should still update locally even when the backend endpoint is unavailable.
      console.warn('Failed to sync profile avatar:', error);
    }
  }

  async function selectProfileTitle(nextTitle) {
    const safeTitle = normalizeProfileTitle(nextTitle);

    if (!PROFILE_TITLE_OPTIONS.includes(safeTitle) || isSavingTitle || safeTitle === getProfileTitle(profile)) {
      return;
    }

    const previousTitle = getProfileTitle(profile);

    setSelectedTitle(safeTitle);
    setIsTitlePickerOpen(false);
    setTitleSaveError('');
    setTitleSaveStatus('saving');
    setIsSavingTitle(true);

    setProfile((currentProfile) => ({
      ...currentProfile,
      title: safeTitle,
      rank: {
        ...currentProfile.rank,
        title: safeTitle,
      },
    }));

    try {
      const response = await updateProfile(getProfileUpdatePayload(profile, { title: safeTitle }));
      const mergedProfile = normalizeProfileUpdateResponse(response, profile, {
        title: safeTitle,
        rank: {
          title: safeTitle,
        },
      });

      setProfile(mergedProfile);
      setSelectedTitle(getProfileTitle(mergedProfile));
      setTitleSaveStatus('saved');
    } catch (error) {
      console.error('Failed to update profile title:', error);
      setProfile((currentProfile) => ({
        ...currentProfile,
        title: previousTitle,
        rank: {
          ...currentProfile.rank,
          title: previousTitle,
        },
      }));
      setSelectedTitle(previousTitle);
      setTitleSaveStatus('error');
      setTitleSaveError(error.message || t('profileTitleUpdateFailed'));
    } finally {
      setIsSavingTitle(false);
    }
  }

  async function saveProfileName(event) {
    event.preventDefault();

    const nextName = draftName.trim();

    if (!nextName) {
      setSaveError(t('nameRequired'));
      return;
    }

    if (nextName === getDisplayName(profile)) {
      setIsEditingName(false);
      setSaveError('');
      return;
    }

    try {
      setSaveStatus('saving');
      setSaveError('');
      const response = await updateProfile({ username: nextName });
      setProfile((currentProfile) => normalizeUpdatedProfile(response, currentProfile, nextName));
      setDraftName(nextName);
      setSaveStatus('saved');
      setIsEditingName(false);
    } catch (error) {
      console.error('Failed to update profile name:', error);
      setSaveStatus('error');
      setSaveError(error.message || t('profileUpdateFailed'));
    }
  }


  async function reloadAchievements() {
    const freshAchievements = await getAchievements();
    setAchievements(normalizeAchievements(freshAchievements));
  }

  async function handleClaimAchievement(item) {
    const achievementId = getAchievementId(item);

    if (!achievementId || claimingAchievementId) {
      return;
    }

    try {
      setClaimingAchievementId(achievementId);
      setAchievementClaimError('');
      setAchievementClaimMessage('');
      await claimAchievement(achievementId);
      setAchievementClaimMessage(t('achievementClaimed'));
      await reloadAchievements();
    } catch (error) {
      console.error('Failed to claim achievement:', error);
      setAchievementClaimError(error.message || t('achievementClaimFailed'));
    } finally {
      setClaimingAchievementId('');
    }
  }

  const profileXp = getProfileXpData(profile);
  const playerId = getProfilePlayerId(profile);
  const recentAchievements = achievements.slice(0, 4);

  return (
    <section className="profile-screen-ui" aria-label={t('profileTitle')}>
      <aside className="profile-sidebar profile-sidebar--compact">
        <button className="profile-back-line" type="button" onClick={() => navigate(ROUTES.mainMenu)}>
          <img src={asset('Back.png')} alt="" />
          <span>{t('profileTitle')}</span>
        </button>
        <div className="profile-tabs profile-tabs--nav">
          <button className="active" type="button" onClick={() => navigate(ROUTES.profile)}>
            {t('profileTitle')}
          </button>
          <button type="button" onClick={() => navigate(ROUTES.achievements)}>
            {t('achievementsTitle')}
          </button>
          <button type="button" onClick={() => navigate(ROUTES.matchHistory)}>
            {t('matchHistory') || 'Match History'}
          </button>
        </div>
        <button className="profile-logout-button" type="button" onClick={handleLogout}>
          {t('logout')}
        </button>
      </aside>

      <main className='profile-content profile-content--compact lui-55e35a30'>
        <header className="profile-header">
          <div className="profile-identity">
            <button className="profile-avatar-button" type="button" onClick={() => setIsAvatarPickerOpen(true)} aria-label={t('chooseAvatar')}>
              <img className="profile-avatar" src={getAvatarSrc(profile)} alt={`${getDisplayName(profile)} avatar`} />
              <span className="profile-avatar-edit-badge">✎</span>
            </button>
            <div className="profile-name-block">
              {!isEditingName ? (
                <div className="profile-name-display-row">
                  <h1>{getDisplayName(profile)}</h1>
                  <button className="profile-edit-name-button" type="button" onClick={startEditingName}>
                    {t('editName')}
                  </button>
                </div>
              ) : (
                <form className="profile-name-edit-form" onSubmit={saveProfileName}>
                  <input
                    aria-label={t('avatarName')}
                    maxLength={24}
                    name="profileName"
                    onChange={(event) => setDraftName(event.target.value)}
                    type="text"
                    value={draftName}
                  />
                  <button className="profile-name-save-button" disabled={saveStatus === 'saving'} type="submit">
                    {saveStatus === 'saving' ? t('saving') : t('save')}
                  </button>
                  <button className="profile-name-cancel-button" disabled={saveStatus === 'saving'} type="button" onClick={cancelEditingName}>
                    {t('cancel')}
                  </button>
                </form>
              )}
              {saveError ? <p className="profile-save-error" role="alert">{saveError}</p> : null}
              {saveStatus === 'saved' ? <p className="profile-save-success">{t('profileNameUpdated')}</p> : null}
              {playerId ? <p className="profile-user-id">Player ID: {playerId}</p> : null}
              <p className="profile-api-meta">{t('level')} {profile.level || 1} · {profile.trophies ?? 0} {t('trophies')}</p>
              <div className="profile-rank-row">
                <div className="profile-rank-copy">
                  <button
                    className="profile-title-inline-button"
                    disabled={isSavingTitle}
                    type="button"
                    onClick={() => setIsTitlePickerOpen(true)}
                    aria-label={t('chooseTitle')}
                  >
                    {tx(getProfileTitle(profile))}
                  </button>
                  <span>{profileXp.text}</span>
                  <XpProgressBar className="profile-rank-xp-bar" percent={profileXp.percent} label={t('xpProgress')} />
                </div>
              </div>
              {titleSaveError ? <p className="profile-title-save-state profile-title-save-state--error" role="alert">{titleSaveError}</p> : null}
              {titleSaveStatus === 'saved' ? <p className="profile-title-save-state">{t('profileTitleUpdated')}</p> : null}
            </div>
          </div>

          {loadError ? <p className="profile-load-error" role="alert">{loadError}</p> : null}

          <div className="profile-stat-panel">
            {stats.length === 0 ? (
              <div className="profile-stat-empty">
                <span className='lui-68cf83ec'>{t('statsUnavailable')}</span>
                <strong>—</strong>
              </div>
            ) : stats.map((stat) => (
              <div key={stat.label}>
                <span className='lui-68cf83ec'>{tx(stat.label)}</span>
                <strong>{stat.value}</strong>
              </div>
            ))}
          </div>
        </header>

        <section className='profile-section achievements-section lui-44c3f0d0'>
          <h2>{t('recentAchievements')}</h2>
          {achievementClaimError ? <p className="profile-achievement-claim-state profile-achievement-claim-state--error" role="alert">{achievementClaimError}</p> : null}
          {achievementClaimMessage ? <p className="profile-achievement-claim-state">{achievementClaimMessage}</p> : null}
          {recentAchievements.length === 0 ? (
            <p className="profile-achievements-empty">{t('noAchievementsYet')}</p>
          ) : (
            <div className="profile-achievement-grid">
              {recentAchievements.map((item) => {
                const achievementProgress = getAchievementProgressData(item);
                const achievementId = getAchievementId(item);
                const isClaiming = claimingAchievementId === achievementId;

                return (
                  <article
                    className='profile-achievement-card lui-4e595040'
                    key={achievementId || item.title}
                    style={{ backgroundImage: `url(${asset(item.card)})` }}
                  >
                    <div className="profile-achievement-copy">
                      <h3 className='lui-9ac37510'>{tx(item.title)}</h3>
                      <p className='lui-7bc2a8ec'>{tx(item.description)}</p>
                    </div>

                    <div className="profile-achievement-footer">
                      <XpProgressBar
                        className="profile-achievement-xp-bar"
                        percent={achievementProgress.percent}
                        label={`${tx(item.title)} ${t('xpProgress')}`}
                      />
                      <span className="profile-achievement-progress-text">{tx(achievementProgress.text)}</span>
                      {item.claimed ? (
                        <span className="profile-achievement-claimed-label">{t('claimed')}</span>
                      ) : item.claimable ? (
                        <button
                          className="profile-achievement-complete-button"
                          disabled={isClaiming}
                          type="button"
                          onClick={() => handleClaimAchievement(item)}
                        >
                          {isClaiming ? t('claiming') : t('complete')}
                        </button>
                      ) : null}
                    </div>
                  </article>
                );
              })}
            </div>
          )}
        </section>


        {isTitlePickerOpen ? (
          <TitlePickerPanel
            activeTitle={getProfileTitle(profile)}
            isSaving={isSavingTitle}
            onClose={() => setIsTitlePickerOpen(false)}
            onSelect={selectProfileTitle}
            t={t}
            tx={tx}
          />
        ) : null}

        {isAvatarPickerOpen ? (
          <AvatarPickerPanel
            activeAvatar={profile?.avatar || profile?.avatarId || DEFAULT_PROFILE_AVATAR}
            onClose={() => setIsAvatarPickerOpen(false)}
            onSelect={selectProfileAvatar}
            t={t}
          />
        ) : null}
      </main>
    </section>
  );
}
