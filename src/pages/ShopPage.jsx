import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ROUTES } from '../router/routes.js';
import { getBalances } from '../services/economyService.js';
import { getShopCatalog, purchaseShopItem } from '../services/shopService.js';
import { useLanguage } from '../i18n/useLanguage.js';

const shopAsset = (name) => `/assets/shop/${name}`;
const mainMenuAsset = (name) => `/assets/main-menu/${name}`;

const coinPacks = [
  { id: 'coin_pack_1', itemId: 'coin_pack_1', type: 'coins', image: '1.png', amount: '10,000 COINS', price: '120', currency: 'diamonds', badge: 'POPULAR' },
  { id: 'coin_pack_2', itemId: 'coin_pack_2', type: 'coins', image: '2.png', amount: '50,000 COINS', price: '500', currency: 'diamonds' },
  { id: 'coin_pack_3', itemId: 'coin_pack_3', type: 'coins', image: '4.png', amount: '120,000 COINS', price: '1,050', currency: 'diamonds', badge: 'BEST VALUE' },
  { id: 'coin_pack_4', itemId: 'coin_pack_4', type: 'coins', image: '3.png', amount: '300,000 COINS', price: '2,400', currency: 'diamonds' },
];

const gemPacks = [
  { id: 'gem_pack_1', itemId: 'gem_pack_1', type: 'diamonds', backendCurrency: 'fiat', image: '5.png', amount: '260 GEMS', price: '$1.99', currency: 'usd', badge: 'POPULAR' },
  { id: 'gem_pack_2', itemId: 'gem_pack_2', type: 'diamonds', backendCurrency: 'fiat', image: '6.png', amount: '1,300 GEMS', price: '$8.99', currency: 'usd' },
  { id: 'gem_pack_3', itemId: 'gem_pack_3', type: 'diamonds', backendCurrency: 'fiat', image: '7.png', amount: '2,800 GEMS', price: '$17.99', currency: 'usd', badge: 'BEST VALUE' },
  { id: 'gem_pack_4', itemId: 'gem_pack_4', type: 'diamonds', backendCurrency: 'fiat', image: '8.png', amount: '7,500 GEMS', price: '$44.99', currency: 'usd' },
];

const boxPack = {
  id: 'basic_box',
  itemId: 'basic_box',
  type: 'chest',
  image: '9.png',
  amount: 'BASIC BOX',
  price: '25',
  currency: 'diamonds',
};

const fallbackShopItems = [...coinPacks, boxPack, ...gemPacks];

function formatBalance(value) {
  const numericValue = Number(value);

  if (Number.isFinite(numericValue)) {
    return numericValue.toLocaleString();
  }

  return '0';
}


function parsePrice(value) {
  const numericValue = Number(String(value).replace(/[^0-9.]/g, ''));
  return Number.isFinite(numericValue) ? numericValue : 0;
}

function BalancePill({ icon, value, label }) {
  return (
    <div className="shop-balance-pill" aria-label={label}>
      <img src={mainMenuAsset(icon)} alt="" />
      <strong>{formatBalance(value)}</strong>
    </div>
  );
}

function ShopPrice({ item, onPurchase, disabled = false }) {
  const isDiamondPrice = item.currency === 'diamonds';

  return (
    <button className="shop-price-button" type="button" onClick={() => onPurchase(item)} disabled={disabled} style={{ backgroundImage: `url(${shopAsset('66.png')})` }}>
      {isDiamondPrice && <img src={mainMenuAsset('gem.png')} alt="" />}
      <span>{item.price}</span>
    </button>
  );
}

function ShopCard({ item, variant = 'coin', onPurchase, disabled = false }) {
  return (
    <article className={`shop-item-card shop-item-card--${variant}`} aria-label={item.amount}>
      <img className="shop-card-art" src={shopAsset(item.image)} alt="" />
      {item.badge && (
        <span className={`shop-card-badge ${item.badge === 'BEST VALUE' ? 'is-red' : 'is-green'}`}>
          {item.badge}
        </span>
      )}
      <ShopPrice item={item} onPurchase={onPurchase} disabled={disabled} />
    </article>
  );
}

export default function ShopPage() {
  const navigate = useNavigate();
  const { t } = useLanguage();
  const [balances, setBalances] = useState({ coins: 0, diamonds: 0 });
  const [shopItems, setShopItems] = useState(fallbackShopItems);
  const [isPurchasingItemId, setIsPurchasingItemId] = useState('');
  const [shopMessage, setShopMessage] = useState('');

  useEffect(() => {
    let isMounted = true;

    Promise.allSettled([getBalances(), getShopCatalog()])
      .then(([balancesResult, catalogResult]) => {
        if (!isMounted) {
          return;
        }

        if (balancesResult.status === 'fulfilled') {
          const economyBalances = balancesResult.value;
          setBalances({
            coins: economyBalances?.coins ?? 0,
            diamonds: economyBalances?.diamonds ?? economyBalances?.gems ?? 0,
          });
        } else {
          console.error('Failed to load shop balances:', balancesResult.reason);
        }

        if (catalogResult.status === 'fulfilled' && catalogResult.value?.length) {
          setShopItems(catalogResult.value);
        } else if (catalogResult.status === 'rejected') {
          console.error('Failed to load shop catalog:', catalogResult.reason);
        }
      });

    return () => {
      isMounted = false;
    };
  }, []);


  const setTimedShopMessage = (message) => {
    setShopMessage(message);
    window.clearTimeout(window.__sakuraShopMessageTimer);
    window.__sakuraShopMessageTimer = window.setTimeout(() => setShopMessage(''), 2200);
  };

  const handlePurchase = async (item) => {
    if (!item?.itemId && !item?.id) return;

    if (item.currency === 'diamonds') {
      const requiredDiamonds = parsePrice(item.price);
      const currentDiamonds = Number(balances.diamonds || 0);

      if (currentDiamonds < requiredDiamonds) {
        setTimedShopMessage(t('insufficientDiamonds'));
        return;
      }
    }

    const itemId = item.itemId || item.id;
    setIsPurchasingItemId(itemId);

    try {
      await purchaseShopItem(itemId);
      const nextBalances = await getBalances();
      setBalances({
        coins: nextBalances?.coins ?? 0,
        diamonds: nextBalances?.diamonds ?? nextBalances?.gems ?? 0,
      });
      setTimedShopMessage(t('purchaseSuccessful'));

    } catch (error) {
      console.error('Shop purchase failed:', error);
      const message = /insufficient/i.test(error.message || '') ? t('insufficientDiamonds') : (error.message || 'Purchase failed');
      setTimedShopMessage(message);
    } finally {
      setIsPurchasingItemId('');
    }
  };

  const topRowItems = shopItems.filter((item) => item.type === 'coins' || item.type === 'chest').slice(0, 5);
  const bottomRowItems = shopItems.filter((item) => item.type === 'diamonds' || item.backendCurrency === 'fiat' || item.currency === 'usd').slice(0, 4);

  return (
    <section className="shop-page" style={{ backgroundImage: `url(${shopAsset('552134.png')})` }}>
      <button className="shop-back-button" type="button" onClick={() => navigate(ROUTES.mainMenu)} aria-label="Back to main menu">
        ‹ BACK
      </button>

      <div className="shop-balance-bar">
        <BalancePill icon="coin.png" value={balances.coins} label="Coins balance" />
        <BalancePill icon="gem.png" value={balances.diamonds} label="Diamonds balance" />
      </div>

      {shopMessage && <div className="shop-feedback" role="status">{shopMessage}</div>}

      <div className="shop-content-frame">
        <div className="shop-row shop-row--top">
          {topRowItems.map((item) => (
            <ShopCard key={item.id} item={item} variant={item.type === 'chest' ? 'box' : 'coin'} onPurchase={handlePurchase} disabled={isPurchasingItemId === (item.itemId || item.id)} />
          ))}
        </div>

        <div className="shop-row shop-row--bottom">
          {bottomRowItems.map((item) => (
            <ShopCard key={item.id} item={item} variant="gem" onPurchase={handlePurchase} disabled={isPurchasingItemId === (item.itemId || item.id)} />
          ))}
        </div>
      </div>
    </section>
  );
}
