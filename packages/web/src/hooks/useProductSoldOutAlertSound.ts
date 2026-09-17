import { useEffect, useRef } from 'react';
import {
  freshProductSoldOutIds,
  playProductSoldOutAlert,
  unlockProductSoldOutAudio,
  unreadProductSoldOutIds,
} from '../lib/product-sold-out-alert';
import { emptyNotifications, useOperatorNotifications } from './useOperatorNotifications';

export function useProductSoldOutAlertSound() {
  const query = useOperatorNotifications();
  const seenRef = useRef<Set<string> | null>(null);

  useEffect(() => {
    const unlock = () => { void unlockProductSoldOutAudio(); };
    window.addEventListener('pointerdown', unlock);
    window.addEventListener('keydown', unlock);
    return () => {
      window.removeEventListener('pointerdown', unlock);
      window.removeEventListener('keydown', unlock);
    };
  }, []);

  useEffect(() => {
    const incoming = unreadProductSoldOutIds((query.data || emptyNotifications()).items);
    if (seenRef.current == null) {
      seenRef.current = new Set(incoming);
      return;
    }
    const fresh = freshProductSoldOutIds(seenRef.current, incoming);
    seenRef.current = new Set(incoming);
    if (fresh.length) void playProductSoldOutAlert();
  }, [query.data]);
}

export function ProductSoldOutAlertSound() {
  useProductSoldOutAlertSound();
  return null;
}
