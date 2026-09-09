import * as React from 'react';

const mediaQuery = '(max-width: 767px)';
function getSnapshot() {
  return window.matchMedia(mediaQuery).matches;
}
function subscribe(onChange: () => void) {
  const media = window.matchMedia(mediaQuery);
  media.addEventListener('change', onChange);
  return () => media.removeEventListener('change', onChange);
}

export function useIsMobile() {
  return React.useSyncExternalStore(subscribe, getSnapshot, () => false);
}
