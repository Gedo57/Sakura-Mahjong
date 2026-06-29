import { mockApi } from '../mocks/mockApi.js';

const DEFAULT_BACKEND_URL = 'https://mahjong-game-backend.onrender.com';
const DEFAULT_API_PREFIX = '/api';

const rawBackendUrl = import.meta.env.VITE_API_BASE_URL || DEFAULT_BACKEND_URL;
const rawApiPrefix = import.meta.env.VITE_API_PREFIX ?? DEFAULT_API_PREFIX;
const USE_MOCK_API = import.meta.env.VITE_USE_MOCK_API === 'true';

const ACCESS_TOKEN_STORAGE_KEY = 'sakura_access_token';
const REFRESH_TOKEN_STORAGE_KEY = 'sakura_refresh_token';
const LEGACY_TOKEN_STORAGE_KEY = 'sakura_auth_token';

function stripTrailingSlash(value = '') {
  return String(value).replace(/\/+$/, '');
}

function normalizePrefix(prefix = '') {
  if (!prefix) return '';
  return `/${String(prefix).replace(/^\/+|\/+$/g, '')}`;
}

const BACKEND_URL = stripTrailingSlash(rawBackendUrl);
const API_PREFIX = normalizePrefix(rawApiPrefix);
const API_BASE_URL = `${BACKEND_URL}${API_PREFIX}`;

let refreshTokenPromise = null;

export function isMockApiEnabled() {
  return USE_MOCK_API;
}

export function getBackendUrl() {
  return BACKEND_URL;
}

export function getApiBaseUrl() {
  return API_BASE_URL;
}

function readStorage(key) {
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

function writeStorage(key, value) {
  try {
    if (!value) {
      window.localStorage.removeItem(key);
      return;
    }

    window.localStorage.setItem(key, value);
  } catch {
    // Local storage is optional. Ignore quota/privacy errors.
  }
}

export function getAuthToken() {
  return readStorage(ACCESS_TOKEN_STORAGE_KEY) || readStorage(LEGACY_TOKEN_STORAGE_KEY);
}

export function getRefreshToken() {
  return readStorage(REFRESH_TOKEN_STORAGE_KEY);
}

export function setAuthToken(token) {
  writeStorage(ACCESS_TOKEN_STORAGE_KEY, token || null);

  // Keep the old key in sync so older code/builds do not leave a stale token behind.
  writeStorage(LEGACY_TOKEN_STORAGE_KEY, token || null);
}

export function setRefreshToken(token) {
  writeStorage(REFRESH_TOKEN_STORAGE_KEY, token || null);
}

export function setAuthTokens({ accessToken, refreshToken } = {}) {
  if (accessToken !== undefined) {
    setAuthToken(accessToken || null);
  }

  if (refreshToken !== undefined) {
    setRefreshToken(refreshToken || null);
  }
}

export function clearAuthTokens() {
  setAuthToken(null);
  setRefreshToken(null);
}

function buildUrl(path) {
  const normalizedPath = String(path || '').startsWith('/') ? path : `/${path}`;
  return `${API_BASE_URL}${normalizedPath}`;
}

function buildHeaders(options = {}) {
  const token = options.authTokenOverride || getAuthToken();
  const headers = {
    ...(options.body !== undefined ? { 'Content-Type': 'application/json' } : {}),
    ...(options.headers || {}),
  };

  if (token && !headers.Authorization) {
    headers.Authorization = `Bearer ${token}`;
  }

  return headers;
}

async function parseResponse(response) {
  const contentType = response.headers.get('content-type') || '';

  if (response.status === 204) {
    return null;
  }

  return contentType.includes('application/json')
    ? response.json()
    : response.text();
}

function getErrorMessage(payload, response) {
  if (payload && typeof payload === 'object') {
    return payload.message || payload.error || payload.detail || `API request failed with status ${response.status}`;
  }

  if (typeof payload === 'string' && payload.trim()) {
    return payload;
  }

  return `API request failed with status ${response.status}`;
}

function extractAccessToken(payload) {
  return payload?.accessToken
    || payload?.access_token
    || payload?.token
    || payload?.authToken
    || payload?.jwt
    || payload?.data?.accessToken
    || payload?.data?.access_token
    || payload?.data?.token
    || payload?.data?.authToken
    || payload?.data?.jwt
    || payload?.data?.tokens?.accessToken
    || payload?.data?.tokens?.access_token
    || payload?.tokens?.accessToken
    || payload?.tokens?.access_token
    || null;
}

function extractRefreshToken(payload) {
  return payload?.refreshToken
    || payload?.refresh_token
    || payload?.data?.refreshToken
    || payload?.data?.refresh_token
    || payload?.data?.tokens?.refreshToken
    || payload?.data?.tokens?.refresh_token
    || payload?.tokens?.refreshToken
    || payload?.tokens?.refresh_token
    || null;
}

async function requestFreshAccessToken() {
  // The current backend API reference says POST /auth/refresh relies on
  // the secure HTTP-only refresh cookie. Do not send a refresh token in
  // the body or Authorization header in real API mode.
  const response = await fetch(buildUrl('/auth/refresh'), {
    method: 'POST',
    credentials: 'include',
  });

  const payload = await parseResponse(response);
  const nextAccessToken = extractAccessToken(payload);
  const nextRefreshToken = extractRefreshToken(payload);

  if (!response.ok || !nextAccessToken) {
    clearAuthTokens();
    throw new Error(getErrorMessage(payload, response) || 'Session expired. Please login again.');
  }

  setAuthToken(nextAccessToken);

  // Keep backward compatibility for older/mock builds that may still return
  // a refresh token, but the real backend should continue using cookies.
  if (nextRefreshToken) {
    setRefreshToken(nextRefreshToken);
  }

  return nextAccessToken;
}

async function refreshAccessToken() {
  if (!refreshTokenPromise) {
    refreshTokenPromise = requestFreshAccessToken().finally(() => {
      refreshTokenPromise = null;
    });
  }

  return refreshTokenPromise;
}

export async function healthCheck() {
  if (USE_MOCK_API) {
    return { status: 'mock', backendUrl: BACKEND_URL };
  }

  const response = await fetch(`${BACKEND_URL}/health`, {
    method: 'GET',
    credentials: 'include',
  });

  const payload = await parseResponse(response);

  if (!response.ok) {
    throw new Error(getErrorMessage(payload, response));
  }

  return payload;
}

export async function apiRequest(path, options = {}) {
  if (USE_MOCK_API) {
    throw new Error(`apiRequest("${path}") was called while mock API mode is enabled.`);
  }

  const requestOptions = {
    ...options,
    credentials: options.credentials || 'include',
    headers: buildHeaders(options),
  };

  let response = await fetch(buildUrl(path), requestOptions);

  const hasKnownSessionToken = Boolean(getAuthToken() || getRefreshToken());
  if (response.status === 401 && options.retryOnUnauthorized !== false && hasKnownSessionToken) {
    const nextAccessToken = await refreshAccessToken();
    response = await fetch(buildUrl(path), {
      ...requestOptions,
      headers: buildHeaders({ ...options, authTokenOverride: nextAccessToken }),
    });
  }

  const payload = await parseResponse(response);

  if (!response.ok) {
    throw new Error(getErrorMessage(payload, response));
  }

  return payload;
}

export async function getFromApi(path, mockResolver) {
  if (USE_MOCK_API) {
    return mockResolver(mockApi);
  }

  return apiRequest(path);
}

export async function postToApi(path, body, mockResolver, options = {}) {
  if (USE_MOCK_API) {
    return mockResolver(mockApi);
  }

  return apiRequest(path, {
    method: 'POST',
    body: body === undefined ? undefined : JSON.stringify(body),
    ...options,
  });
}

export async function patchToApi(path, body, mockResolver) {
  if (USE_MOCK_API) {
    return mockResolver(mockApi);
  }

  return apiRequest(path, {
    method: 'PATCH',
    body: JSON.stringify(body ?? {}),
  });
}

export async function deleteFromApi(path, mockResolver) {
  if (USE_MOCK_API) {
    return mockResolver(mockApi);
  }

  return apiRequest(path, {
    method: 'DELETE',
  });
}
