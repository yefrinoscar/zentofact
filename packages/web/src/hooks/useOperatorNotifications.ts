import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import api from '../lib/api';
import {
  parseOperatorNotificationsResponse,
  type OperatorNotificationsResponse,
} from '../lib/notifications-presentation';

export const NOTIFICATIONS_QUERY_KEY = ['notifications'] as const;

export function useOperatorNotifications() {
  return useQuery({
    queryKey: NOTIFICATIONS_QUERY_KEY,
    queryFn: () => api.listNotifications(),
    refetchInterval: 30_000,
  });
}

function rememberList(queryClient: ReturnType<typeof useQueryClient>, data: OperatorNotificationsResponse) {
  queryClient.setQueryData(NOTIFICATIONS_QUERY_KEY, data);
}

export function useNotificationActions() {
  const queryClient = useQueryClient();

  const markRead = useMutation({
    mutationFn: (input: { ids?: string[]; all?: boolean } = {}) => api.markNotificationsRead(input),
    onSuccess: (data) => rememberList(queryClient, data),
  });

  const dismiss = useMutation({
    mutationFn: (id: string) => api.dismissNotification(id),
    onSuccess: (data) => rememberList(queryClient, data),
  });

  return { markRead, dismiss };
}

export function emptyNotifications(): OperatorNotificationsResponse {
  return parseOperatorNotificationsResponse({ items: [], unreadCount: 0 });
}
