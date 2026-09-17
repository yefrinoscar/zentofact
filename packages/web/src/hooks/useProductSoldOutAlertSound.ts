import { useEffect, useRef } from 'react';
import { useOperatorSnackbar } from '../components/OperatorSnackbar';
import {
  playMarketplaceMutationAlert,
  playProductSoldOutAlert,
  unlockProductSoldOutAudio,
} from '../lib/product-sold-out-alert';
import {
  freshRealtimeNotifications,
  initialRealtimeNotifications,
  unreadRealtimeNotifications,
} from '../lib/operator-notification-alert';
import { emptyNotifications, useOperatorNotifications } from './useOperatorNotifications';

export function useOperatorNotificationAlerts() {
  const query = useOperatorNotifications();
  const { showSnackbar } = useOperatorSnackbar();
  const seenRef = useRef<Set<string> | null>(null);
  const sessionStartedAtRef = useRef(Date.now());

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
    const incoming = unreadRealtimeNotifications((query.data || emptyNotifications()).items);
    const incomingIds = incoming.map((item) => item.id);
    let fresh;
    if (seenRef.current == null) {
      seenRef.current = new Set(incomingIds);
      fresh = initialRealtimeNotifications(incoming, sessionStartedAtRef.current);
    } else {
      fresh = freshRealtimeNotifications(seenRef.current, incoming);
      for (const id of incomingIds) seenRef.current.add(id);
    }
    const marketplace = fresh.find((item) => item.kind === 'marketplace_mutation');
    if (marketplace) {
      const succeeded = marketplace.severity === 'success';
      showSnackbar({
        message: marketplace.body ? `${marketplace.title}. ${marketplace.body}` : marketplace.title,
        tone: succeeded ? 'success' : 'error',
        duration: succeeded ? 7_000 : null,
      });
      void playMarketplaceMutationAlert(succeeded);
      return;
    }
    if (fresh.some((item) => item.kind === 'product_sold_out')) void playProductSoldOutAlert();
  }, [query.data, showSnackbar]);
}

export function OperatorNotificationAlerts() {
  useOperatorNotificationAlerts();
  return null;
}
