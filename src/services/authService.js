import { clearAuthTokens, getAuthToken, getRefreshToken, isMockApiEnabled, postToApi, setAuthTokens, getFromApi } from './api.js';

const AUTH_USER_STORAGE_KEY = 'sakura_auth_user';

function normalizeAuthUser(response) {
  const user = response?.user || response?.profile || response?.data?.user || response?.data?.profile || null;

  if (!user || typeof user !== 'object') {
    return null;
  }

  // Keep the auth user small, but do not force backend avatar values into the UI
  // unless they are real image URLs or filenames. Invalid avatar IDs were breaking
  // the profile image by producing paths like /assets/profile/default.
  const avatarValue = user.avatarUrl || user.imageUrl || user.avatar || user.avatarId;
  const hasUsableAvatar = typeof avatarValue === 'string' && (
    /^(https?:)?\/\//i.test(avatarValue.trim()) ||
    avatarValue.trim().startsWith('/') ||
    /\.(png|jpe?g|webp|gif|svg)$/i.test(avatarValue.trim())
  );

  if (hasUsableAvatar) {
    return user;
  }

  const { avatar, avatarId, avatarUrl, imageUrl, ...restUser } = user;
  return restUser;
}

function persistAuthUser(user) {
  try {
    if (!user) {
      window.localStorage.removeItem(AUTH_USER_STORAGE_KEY);
      return;
    }

    window.localStorage.setItem(AUTH_USER_STORAGE_KEY, JSON.stringify(user));
  } catch {
    // Local storage is optional. Ignore quota/privacy errors.
  }
}

export function getStoredAuthUser() {
  try {
    const rawUser = window.localStorage.getItem(AUTH_USER_STORAGE_KEY);
    return rawUser ? JSON.parse(rawUser) : null;
  } catch {
    return null;
  }
}



export function isUserLoggedIn() {
  // A cached profile is not a valid session.
  // The backend-protected screens must only be treated as logged in when a token exists.
  return Boolean(getAuthToken() || getRefreshToken());
}

function extractAccessToken(response) {
  return response?.accessToken
    || response?.access_token
    || response?.token
    || response?.authToken
    || response?.jwt
    || response?.data?.accessToken
    || response?.data?.access_token
    || response?.data?.token
    || response?.data?.authToken
    || response?.data?.jwt
    || response?.data?.tokens?.accessToken
    || response?.data?.tokens?.access_token
    || response?.tokens?.accessToken
    || response?.tokens?.access_token
    || null;
}

function extractRefreshToken(response) {
  return response?.refreshToken
    || response?.refresh_token
    || response?.data?.refreshToken
    || response?.data?.refresh_token
    || response?.data?.tokens?.refreshToken
    || response?.data?.tokens?.refresh_token
    || response?.tokens?.refreshToken
    || response?.tokens?.refresh_token
    || null;
}

function persistAuthSession(response) {
  const accessToken = extractAccessToken(response);
  const refreshToken = extractRefreshToken(response);

  setAuthTokens({
    accessToken: accessToken || undefined,
    refreshToken: refreshToken || undefined,
  });

  const user = normalizeAuthUser(response);
  if (user) {
    persistAuthUser(user);
  }

  return response;
}

export async function registerUser(payload) {
  const response = await postToApi('/auth/register', payload, (mockApi) => mockApi.registerUser(payload));
  return persistAuthSession(response);
}

export async function login(credentials) {
  const response = await postToApi('/auth/login', credentials, (mockApi) => mockApi.login(credentials), {
    retryOnUnauthorized: false,
  });

  return persistAuthSession(response);
}

export async function refreshToken() {
  const response = await postToApi('/auth/refresh', undefined, (mockApi) => mockApi.refreshToken(), {
    retryOnUnauthorized: false,
  });

  return persistAuthSession(response);
}

export async function continueAsGuest() {
  if (!isMockApiEnabled()) {
    clearAuthTokens();
    const response = {
      message: 'Continuing as guest',
      user: { id: 'guest_player', username: 'Guest', name: 'Guest' },
    };
    persistAuthUser(response.user);
    return response;
  }

  const response = await postToApi('/auth/guest', undefined, (mockApi) => mockApi.continueAsGuest());
  return persistAuthSession(response);
}

export function logout() {
  clearAuthTokens();
  persistAuthUser(null);
  
  // Clear all storages to ensure no stale data remains
  localStorage.clear();
  sessionStorage.clear();
  
  // Clean up any lingering websocket connections globally
  import('./socket.js').then(({ disconnectGameSocket }) => {
    disconnectGameSocket();
  }).catch(() => {});
}

export async function getUserMatchHistory() {
  if (isMockApiEnabled()) {
    return { success: true, history: [] }; // Return mock data for now
  }
  
  const response = await getFromApi('/auth/history', () => ({ success: true, history: [] }));
  return response?.history || [];
}
