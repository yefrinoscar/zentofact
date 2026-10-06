import { useEffect, useMemo, useState } from 'react';
import { authClient } from '../lib/authClient';
import api from '../lib/api';
import {
  type AppUser,
  type PermissionKey,
  isAdminUser,
  isReadOnlyUser,
  isSuperadminUser,
  parsePermissions,
  permissionsForUser,
  userCanWritePermission,
  userHasPermission,
  userRoleList,
} from '../lib/permissions';

export function usePermissions() {
  const { data: session, isPending } = authClient.useSession();
  const [profile, setProfile] = useState<AppUser | null>(null);
  const [loadingProfile, setLoadingProfile] = useState(true);

  useEffect(() => {
    let mounted = true;
    if (!session?.user) {
      setProfile(null);
      setLoadingProfile(false);
      return;
    }
    setLoadingProfile(true);
    api.getMe()
      .then((res: any) => {
        if (!mounted) return;
        setProfile(res?.user || session.user);
      })
      .catch(() => {
        if (!mounted) return;
        setProfile(session.user as AppUser);
      })
      .finally(() => {
        if (mounted) setLoadingProfile(false);
      });
    return () => {
      mounted = false;
    };
  }, [session?.user?.id]);

  const user = profile || (session?.user as AppUser | undefined) || null;
  const role = String(user?.role || 'operator');
  const roles = userRoleList(user);
  const permissions = useMemo(() => permissionsForUser(user), [user]);
  const legacyPermissions = useMemo(
    () => parsePermissions(user?.permissions, role),
    [user?.permissions, role],
  );

  const can = (key: PermissionKey) => userHasPermission(user, key);
  const canWrite = (key: PermissionKey) => userCanWritePermission(user, key);

  return {
    user,
    role,
    roles,
    permissions,
    legacyPermissions,
    can,
    canWrite,
    isAdmin: isAdminUser(user),
    isSuperadmin: isSuperadminUser(user),
    readOnly: isReadOnlyUser(user),
    loading: isPending || loadingProfile,
  };
}
