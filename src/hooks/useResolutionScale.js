import { useEffect, useState } from 'react';
import {
  DESKTOP_RESOLUTION,
  getDesignResolution,
  getEffectiveDeviceMode,
  getLayoutMode,
  getPhysicalDeviceMode,
  getViewportOrientation,
} from '../utils/resolution.js';

const SAFARI_EXCLUSION_PATTERN = /CriOS|FxiOS|EdgiOS|OPiOS|Chrome|Chromium|Edg|OPR|SamsungBrowser/i;
const CHROME_PATTERN = /CriOS|Chrome|Chromium/i;
const CHROME_EXCLUSION_PATTERN = /FxiOS|EdgiOS|OPiOS|Edg|OPR|SamsungBrowser/i;

let lastStableMobileViewport = null;
let lastStableMobileOrientation = '';

function isSafariBrowser() {
  if (typeof window === 'undefined') return false;

  const userAgent = window.navigator.userAgent || '';
  const vendor = window.navigator.vendor || '';

  return /Safari/i.test(userAgent)
    && /Apple/i.test(vendor)
    && !SAFARI_EXCLUSION_PATTERN.test(userAgent);
}

function isChromeBrowser() {
  if (typeof window === 'undefined') return false;

  const userAgent = window.navigator.userAgent || '';

  return CHROME_PATTERN.test(userAgent)
    && !CHROME_EXCLUSION_PATTERN.test(userAgent);
}

function getBrowserName() {
  if (isSafariBrowser()) return 'safari';
  if (isChromeBrowser()) return 'chrome';
  return '';
}

function getBaseViewportSize() {
  if (typeof window === 'undefined') {
    return DESKTOP_RESOLUTION;
  }

  const documentElement = document.documentElement;

  return {
    width: window.innerWidth || documentElement?.clientWidth || DESKTOP_RESOLUTION.width,
    height: window.innerHeight || documentElement?.clientHeight || DESKTOP_RESOLUTION.height,
  };
}

function getVisualViewportSize() {
  if (typeof window === 'undefined') {
    return DESKTOP_RESOLUTION;
  }

  const visualViewport = window.visualViewport;
  const documentElement = document.documentElement;
  const fallbackViewport = getBaseViewportSize();

  return {
    // iOS Safari and iOS Chrome can report a larger layout viewport while the
    // visible viewport is smaller because of browser toolbars. visualViewport
    // gives the actual visible area and keeps the fixed UI canvas fitted.
    width: Math.floor(visualViewport?.width || fallbackViewport.width || documentElement?.clientWidth || DESKTOP_RESOLUTION.width),
    height: Math.floor(visualViewport?.height || documentElement?.clientHeight || fallbackViewport.height || DESKTOP_RESOLUTION.height),
  };
}

function shouldUseVisualViewport(browserName) {
  return browserName === 'safari' || browserName === 'chrome';
}

function getViewportSize(browserName) {
  return shouldUseVisualViewport(browserName) ? getVisualViewportSize() : getBaseViewportSize();
}

function isEditableElement(element) {
  if (!element) return false;

  const tagName = element.tagName?.toLowerCase();
  return tagName === 'input' || tagName === 'textarea' || tagName === 'select' || element.isContentEditable;
}

function isMobileKeyboardLikelyOpen(physicalDevice, browserName, viewport) {
  if (physicalDevice !== 'mobile' || !shouldUseVisualViewport(browserName)) return false;

  const visualViewport = window.visualViewport;
  const baseViewport = getBaseViewportSize();
  const activeEditable = isEditableElement(document.activeElement);
  const visualHeight = Number(visualViewport?.height || viewport?.height || 0);
  const baseHeight = Number(baseViewport.height || 0);
  const keyboardConsumesViewport = baseHeight > 0 && visualHeight > 0 && baseHeight - visualHeight > 80;

  return activeEditable || keyboardConsumesViewport;
}

function applyRootState(layout) {
  if (typeof document === 'undefined') return;

  const root = document.documentElement;

  root.dataset.device = layout.device;
  root.dataset.physicalDevice = layout.physicalDevice;
  root.dataset.orientation = layout.orientation;
  root.dataset.layout = layout.layout;

  if (layout.browser) {
    root.dataset.browser = layout.browser;
  } else {
    delete root.dataset.browser;
  }

  root.classList.toggle('keyboard-open', Boolean(layout.keyboardOpen));
  document.body?.classList.toggle('keyboard-open', Boolean(layout.keyboardOpen));

  if (shouldUseVisualViewport(layout.browser)) {
    root.style.setProperty('--app-viewport-width', `${layout.viewport.width}px`);
    root.style.setProperty('--app-viewport-height', `${layout.viewport.height}px`);
  } else {
    root.style.removeProperty('--app-viewport-width');
    root.style.removeProperty('--app-viewport-height');
  }
}

function computeResolutionState() {
  if (typeof window === 'undefined') {
    return {
      scale: 1,
      device: 'desktop',
      physicalDevice: 'desktop',
      orientation: 'landscape',
      layout: 'landscape',
      browser: '',
      viewport: DESKTOP_RESOLUTION,
      width: DESKTOP_RESOLUTION.width,
      height: DESKTOP_RESOLUTION.height,
      keyboardOpen: false,
    };
  }

  const physicalDevice = getPhysicalDeviceMode();
  const browser = getBrowserName();
  const measuredViewport = getViewportSize(browser);
  const measuredOrientation = getViewportOrientation(measuredViewport);
  const keyboardOpen = isMobileKeyboardLikelyOpen(physicalDevice, browser, measuredViewport);

  let viewport = measuredViewport;
  let orientation = measuredOrientation;

  if (physicalDevice === 'mobile' && keyboardOpen) {
    if (lastStableMobileViewport && lastStableMobileOrientation === measuredOrientation) {
      viewport = lastStableMobileViewport;
      orientation = lastStableMobileOrientation;
    } else {
      const baseViewport = getBaseViewportSize();
      viewport = baseViewport.width && baseViewport.height ? baseViewport : measuredViewport;
      orientation = getViewportOrientation(viewport);
    }
  } else if (physicalDevice === 'mobile') {
    lastStableMobileViewport = measuredViewport;
    lastStableMobileOrientation = measuredOrientation;
  }

  const device = getEffectiveDeviceMode(physicalDevice, orientation);
  const layout = getLayoutMode(device, orientation);
  const resolution = getDesignResolution(device, orientation);
  const scale = Math.min(viewport.width / resolution.width, viewport.height / resolution.height);

  return {
    scale,
    device,
    physicalDevice,
    orientation,
    layout,
    browser,
    viewport,
    width: resolution.width,
    height: resolution.height,
    keyboardOpen,
  };
}

export function useResolutionScale() {
  const [state, setState] = useState(() => computeResolutionState());

  useEffect(() => {
    let animationFrame = 0;
    const delayedUpdates = new Set();

    const runUpdate = () => {
      const nextState = computeResolutionState();
      applyRootState(nextState);
      setState(nextState);
    };

    const update = () => {
      if (animationFrame) window.cancelAnimationFrame(animationFrame);
      animationFrame = window.requestAnimationFrame(() => {
        animationFrame = 0;
        runUpdate();
      });
    };

    const updateAfterBrowserChromeSettles = () => {
      update();

      // iOS Chrome/Safari update visualViewport in phases while the address and
      // bottom toolbars animate. Rechecking avoids stale scale/orientation data.
      [80, 240, 520].forEach((delay) => {
        const timerId = window.setTimeout(() => {
          delayedUpdates.delete(timerId);
          update();
        }, delay);
        delayedUpdates.add(timerId);
      });
    };

    const handleFocusChange = () => {
      update();

      const timerId = window.setTimeout(() => {
        delayedUpdates.delete(timerId);
        update();
      }, 180);
      delayedUpdates.add(timerId);
    };

    const visualViewport = window.visualViewport;

    window.addEventListener('resize', update);
    window.addEventListener('orientationchange', updateAfterBrowserChromeSettles);
    document.addEventListener('focusin', handleFocusChange);
    document.addEventListener('focusout', handleFocusChange);
    visualViewport?.addEventListener('resize', update);
    visualViewport?.addEventListener('scroll', update);

    updateAfterBrowserChromeSettles();

    return () => {
      if (animationFrame) window.cancelAnimationFrame(animationFrame);
      delayedUpdates.forEach((timerId) => window.clearTimeout(timerId));
      delayedUpdates.clear();
      window.removeEventListener('resize', update);
      window.removeEventListener('orientationchange', updateAfterBrowserChromeSettles);
      document.removeEventListener('focusin', handleFocusChange);
      document.removeEventListener('focusout', handleFocusChange);
      visualViewport?.removeEventListener('resize', update);
      visualViewport?.removeEventListener('scroll', update);
      document.documentElement.style.removeProperty('--app-viewport-width');
      document.documentElement.style.removeProperty('--app-viewport-height');
      document.documentElement.classList.remove('keyboard-open');
      document.body?.classList.remove('keyboard-open');
      delete document.documentElement.dataset.browser;
      delete document.documentElement.dataset.layout;
    };
  }, []);

  return state;
}
