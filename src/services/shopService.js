import { apiRequest, isMockApiEnabled } from './api.js';

const FALLBACK_SHOP_ITEMS = [
  { itemId: 'coin_pack_1', name: '10,000 Coins', type: 'coins', amount: 10000, cost: 120, currency: 'diamonds' },
  { itemId: 'coin_pack_2', name: '50,000 Coins', type: 'coins', amount: 50000, cost: 500, currency: 'diamonds' },
  { itemId: 'coin_pack_3', name: '120,000 Coins', type: 'coins', amount: 120000, cost: 1050, currency: 'diamonds' },
  { itemId: 'coin_pack_4', name: '300,000 Coins', type: 'coins', amount: 300000, cost: 2400, currency: 'diamonds' },
  { itemId: 'basic_box', name: 'Basic Box', type: 'chest', amount: 1, cost: 25, currency: 'diamonds', chestId: 'basic_chest' },
  { itemId: 'gem_pack_1', name: '260 Gems', type: 'diamonds', amount: 260, cost: 1.99, currency: 'fiat' },
  { itemId: 'gem_pack_2', name: '1,300 Gems', type: 'diamonds', amount: 1300, cost: 8.99, currency: 'fiat' },
  { itemId: 'gem_pack_3', name: '2,800 Gems', type: 'diamonds', amount: 2800, cost: 17.99, currency: 'fiat' },
  { itemId: 'gem_pack_4', name: '7,500 Gems', type: 'diamonds', amount: 7500, cost: 44.99, currency: 'fiat' },
];

const ITEM_IMAGE_BY_ID = {
  coin_pack_1: '1.png',
  coin_pack_2: '2.png',
  coin_pack_3: '4.png',
  coin_pack_4: '3.png',
  basic_box: '9.png',
  gem_pack_1: '5.png',
  gem_pack_2: '6.png',
  gem_pack_3: '7.png',
  gem_pack_4: '8.png',
};

const ITEM_BADGE_BY_ID = {
  coin_pack_1: 'POPULAR',
  coin_pack_3: 'BEST VALUE',
  gem_pack_1: 'POPULAR',
  gem_pack_3: 'BEST VALUE',
};

function unwrapPayload(response) {
  if (response?.data && typeof response.data === 'object') return response.data;
  return response && typeof response === 'object' ? response : {};
}

function firstArray(...values) {
  return values.find(Array.isArray) || [];
}

function formatAmount(item = {}) {
  const type = String(item.type || '').toLowerCase();
  const amount = Number(item.amount || 0);

  if (type === 'coins') return `${amount.toLocaleString('en-US')} COINS`;
  if (type === 'diamonds') return `${amount.toLocaleString('en-US')} GEMS`;
  if (type === 'chest') return String(item.name || 'BASIC BOX').toUpperCase();

  return String(item.name || item.itemId || 'SHOP ITEM').toUpperCase();
}

function formatPrice(item = {}) {
  const cost = Number(item.cost ?? item.price ?? 0);
  const currency = String(item.currency || '').toLowerCase();

  if (currency === 'fiat' || currency === 'usd') {
    return `$${cost.toFixed(2)}`;
  }

  return Number.isFinite(cost) ? cost.toLocaleString('en-US') : String(item.cost ?? item.price ?? '0');
}

function normalizeShopItem(item = {}, index = 0) {
  const itemId = item.itemId || item.id || item.key || `shop_item_${index + 1}`;
  const currency = String(item.currency || '').toLowerCase();
  const type = String(item.type || '').toLowerCase();

  return {
    ...item,
    id: itemId,
    itemId,
    type,
    image: item.image || item.asset || ITEM_IMAGE_BY_ID[itemId] || `${index + 1}.png`,
    amount: item.amountLabel || item.label || formatAmount({ ...item, type }),
    price: item.priceLabel || formatPrice(item),
    cost: Number(item.cost ?? item.price ?? 0) || 0,
    currency: currency === 'fiat' ? 'usd' : currency,
    backendCurrency: currency,
    badge: item.badge || ITEM_BADGE_BY_ID[itemId] || '',
  };
}

export function normalizeShopCatalog(response = {}) {
  const payload = unwrapPayload(response);
  const catalog = firstArray(
    payload.catalog,
    payload.items,
    payload.shopItems,
    payload.results,
    payload.data?.catalog,
    payload.data?.items,
    response,
  );

  const source = catalog.length ? catalog : FALLBACK_SHOP_ITEMS;
  return source.map(normalizeShopItem);
}

export async function getShopCatalog() {
  if (isMockApiEnabled()) {
    return normalizeShopCatalog(FALLBACK_SHOP_ITEMS);
  }

  const response = await apiRequest('/shop/catalog');
  return normalizeShopCatalog(response);
}

export async function purchaseShopItem(itemId) {
  if (!itemId) {
    throw new Error('itemId is required to purchase a shop item.');
  }

  if (isMockApiEnabled()) {
    return { success: true, itemId };
  }

  return apiRequest('/shop/purchase', {
    method: 'POST',
    body: JSON.stringify({ itemId }),
  });
}
