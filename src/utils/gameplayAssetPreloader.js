import { PROFILE_AVATAR_SOURCES, preloadImage } from './avatarAssets.js';

const gameplayAsset = (name) => `/assets/gameplay/${name}`;
const winScreenAsset = (name) => `/assets/win-screen/${name}`;

export const GAMEPLAY_TILE_ASSET_NAMES = Object.freeze([
  'tile_back.png',
  'p_1.png',
  'p_2.png',
  'p_3.png',
  'p_4.png',
  'p_5.png',
  'p_6.png',
  'p_7.png',
  'p_8.png',
  'p_9.png',
  'w_e.png',
  'w_s.png',
  'w_w.png',
  'w_n.png',
  'd_r.png',
  'd_w.png',
  'd_g.png',
  'fl_spring.png',
  'fl_summer.png',
  'fl_autumn.png',
  'fl_winter.png',
  'sn_plum.png',
  'sn_orchid.png',
  'sn_chrysanthemum.png',
  'sn_bamboo.png',
  'an_cat.png',
  'an_mouse.png',
  'an_chicken.png',
  'an_centipede.png',
  'joker_clown.png',
  'fei.png',
]);

export const GAMEPLAY_UI_ASSET_NAMES = Object.freeze([
  'BG.png',
  'table.png',
  'exit.png',
]);

const unique = (items) => Array.from(new Set(items.filter(Boolean)));

let preloadPromise = null;

export function getGameplayPreloadSources(extraSources = []) {
  return unique([
    ...GAMEPLAY_TILE_ASSET_NAMES.map(gameplayAsset),
    ...GAMEPLAY_UI_ASSET_NAMES.map(gameplayAsset),
    ...PROFILE_AVATAR_SOURCES,
    winScreenAsset('ic1.png'),
    winScreenAsset('ic2.png'),
    winScreenAsset('ic3.png'),
    ...extraSources,
  ]);
}

export async function preloadGameplayAssets({ extraSources = [], timeoutMs = 3500, force = false } = {}) {
  if (!force && preloadPromise) {
    return preloadPromise;
  }

  const sources = getGameplayPreloadSources(extraSources);
  preloadPromise = Promise.allSettled(sources.map((src) => preloadImage(src, { timeoutMs })))
    .then((results) => {
      const loaded = results.filter((result) => result.status === 'fulfilled' && result.value?.ok).length;
      return {
        loaded,
        total: results.length,
        failed: Math.max(0, results.length - loaded),
        results,
      };
    });

  return preloadPromise;
}
