export const DESKTOP_RESOLUTION = { width: 1280, height: 720 };
export const MOBILE_PORTRAIT_RESOLUTION = { width: 720, height: 1280 };
export const MOBILE_LANDSCAPE_RESOLUTION = { width: 1280, height: 720 };

export function getViewportOrientation(viewport = {}) {
  const width = Number(viewport.width || 0);
  const height = Number(viewport.height || 0);
  return width >= height ? 'landscape' : 'portrait';
}

export function getPhysicalDeviceMode() {
  if (typeof window === 'undefined') {
    return 'desktop';
  }

  const coarsePointer = window.matchMedia?.('(pointer: coarse)').matches;
  const smallScreen = window.matchMedia?.('(max-width: 1024px), (max-height: 540px)').matches;

  return coarsePointer || smallScreen ? 'mobile' : 'desktop';
}

export function getEffectiveDeviceMode(physicalDevice, orientation) {
  // Rotated phones/tablets should use the existing 1280x720 landscape layout.
  // Upright mobile devices use the new 720x1280 portrait canvas.
  if (physicalDevice === 'mobile' && orientation === 'landscape') {
    return 'desktop';
  }

  return physicalDevice;
}

export function getLayoutMode(deviceMode, orientation = 'portrait') {
  // Portrait UI is intentionally limited to the 720x1280 mobile canvas.
  // Desktop windows and rotated mobile devices always use the landscape UI.
  return deviceMode === 'mobile' && orientation === 'portrait'
    ? 'portrait'
    : 'landscape';
}

export function getDesignResolution(deviceMode, orientation = 'portrait') {
  if (deviceMode === 'mobile') {
    return orientation === 'landscape' ? MOBILE_LANDSCAPE_RESOLUTION : MOBILE_PORTRAIT_RESOLUTION;
  }

  return DESKTOP_RESOLUTION;
}
