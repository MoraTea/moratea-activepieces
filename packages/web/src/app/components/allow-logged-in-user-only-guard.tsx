import { Navigate, useLocation } from 'react-router-dom';

import { SocketProvider } from '@/components/providers/socket-provider';
import { useTelemetry } from '@/components/providers/telemetry-provider';
import { projectCollectionUtils } from '@/features/projects';
import { flagsHooks } from '@/hooks/flags-hooks';
import { platformHooks } from '@/hooks/platform-hooks';

import { authenticationSession } from '../../lib/authentication-session';

type AllowOnlyLoggedInUserOnlyGuardProps = {
  children: React.ReactNode;
};
export const AllowOnlyLoggedInUserOnlyGuard = ({
  children,
}: AllowOnlyLoggedInUserOnlyGuardProps) => {
  const { reset } = useTelemetry();
  const location = useLocation();
  if (!authenticationSession.isLoggedIn()) {
    reset();
    authenticationSession.redirectToSignIn(location.pathname + location.search);
    return null;
  }
  if (authenticationSession.isOnboarding()) {
    return <Navigate to="/create-platform" replace />;
  }
  platformHooks.useCurrentPlatform();
  flagsHooks.useFlags();
  projectCollectionUtils.useCurrentProject();
  return <SocketProvider>{children}</SocketProvider>;
};
