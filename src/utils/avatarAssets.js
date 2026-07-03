import avatarBunbun from '../assets/profile/avatar-bunbun.png';
import avatarKiki from '../assets/profile/avatar-kiki.png';
import avatarPanda from '../assets/profile/avatar-panda.png';
import avatarStevie from '../assets/profile/avatar-stevie.png';

const AVATAR_DEFAULT_SRC = avatarStevie;

const normalizeAvatarKey = (value) => {
  const raw = String(value || '').trim();
  if (!raw) return '';

  const withoutQuery = raw.split(/[?#]/)[0];
  const fileName = withoutQuery.split(/[\\/]/).pop() || withoutQuery;
  return fileName.trim().toLowerCase();
};

export const PROFILE_AVATAR_SOURCES = [avatarStevie, avatarKiki, avatarBunbun, avatarPanda];

export const PROFILE_AVATAR_ID_TO_SRC = Object.freeze({
  stevie: avatarStevie,
  'stevie.png': avatarStevie,
  'avatar-stevie.png': avatarStevie,
  kiki: avatarKiki,
  'kiki.png': avatarKiki,
  'avatar-kiki.png': avatarKiki,
  bunbun: avatarBunbun,
  'bunbun.png': avatarBunbun,
  'avatar-bunbun.png': avatarBunbun,
  panda: avatarPanda,
  'panda.png': avatarPanda,
  'avatar-panda.png': avatarPanda,
  ico: avatarStevie,
  'ico.png': avatarStevie,
  default: avatarStevie,
  default_avatar: avatarStevie,
  'default_avatar.png': avatarStevie,
  dragon_avatar: avatarStevie,
  avatar_1: avatarStevie,
  'avatar_1.png': avatarStevie,
  bot_1: avatarKiki,
  'bot_1.png': avatarKiki,
  bot_2: avatarPanda,
  'bot_2.png': avatarPanda,
  bot_3: avatarBunbun,
  'bot_3.png': avatarBunbun,
  bot_kiki: avatarKiki,
  bot_panda: avatarPanda,
  bot_bunbun: avatarBunbun,
  bot_stevie: avatarStevie,
});

export function isDefaultProfileAvatarValue(value) {
  const key = normalizeAvatarKey(value);
  return !key
    || key === 'default'
    || key === 'default.png'
    || key === 'default_avatar'
    || key === 'default_avatar.png'
    || key === 'dragon_avatar'
    || key === 'avatar_1'
    || key === 'avatar_1.png';
}

export function resolveProfileAvatarSrc(avatar, fallbackAvatar = 'stevie') {
  const value = String(avatar || '').trim();
  const fallbackKey = normalizeAvatarKey(fallbackAvatar);
  const fallbackSrc = PROFILE_AVATAR_ID_TO_SRC[fallbackKey] || AVATAR_DEFAULT_SRC;

  if (!value || isDefaultProfileAvatarValue(value)) {
    return fallbackSrc;
  }

  const key = normalizeAvatarKey(value);
  if (PROFILE_AVATAR_ID_TO_SRC[key]) {
    return PROFILE_AVATAR_ID_TO_SRC[key];
  }

  if (/^(https?:|data:|blob:|\/)/i.test(value)) {
    return value;
  }

  return fallbackSrc;
}

export function handleProfileAvatarError(event, fallbackAvatar = 'stevie') {
  const img = event?.currentTarget;
  if (!img || img.dataset.avatarFallbackApplied === 'true') return;

  img.dataset.avatarFallbackApplied = 'true';
  img.src = resolveProfileAvatarSrc(fallbackAvatar);
}

export function preloadImage(src, { timeoutMs = 3500 } = {}) {
  if (typeof window === 'undefined' || typeof Image === 'undefined') {
    return Promise.resolve({ src, ok: true, skipped: true });
  }

  return new Promise((resolve) => {
    if (!src) {
      resolve({ src, ok: false, skipped: true });
      return;
    }

    const image = new Image();
    let settled = false;
    let timeoutId = null;

    const finish = (ok) => {
      if (settled) return;
      settled = true;
      if (timeoutId) window.clearTimeout(timeoutId);
      resolve({ src, ok });
    };

    image.onload = () => finish(true);
    image.onerror = () => finish(false);
    timeoutId = window.setTimeout(() => finish(false), timeoutMs);
    image.src = src;
  });
}
