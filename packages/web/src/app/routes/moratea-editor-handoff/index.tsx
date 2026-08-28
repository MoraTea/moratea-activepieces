import { useMutation } from '@tanstack/react-query';
import { ArrowLeft } from 'lucide-react';
import { useEffect, useRef } from 'react';

import { authenticationApi } from '@/api/authentication-api';
import { LoadingScreen } from '@/components/custom/loading-screen';
import { Button } from '@/components/ui/button';
import { authenticationSession } from '@/lib/authentication-session';

const MORATEA_EDITOR_HANDOFF_ERROR_MESSAGE =
  'Something went wrong, please try again later';
const SAFE_EDITOR_PATH = /^\/flows\/([A-Za-z0-9_-]+)\?surface=moratea$/;

function isSafeEditorPath(value: unknown): value is string {
  if (typeof value !== 'string') {
    return false;
  }

  const match = SAFE_EDITOR_PATH.exec(value);
  if (match === null) {
    return false;
  }

  try {
    const url = new URL(value, window.location.origin);
    return (
      url.origin === window.location.origin &&
      url.pathname === `/flows/${match[1]}` &&
      url.search === '?surface=moratea' &&
      url.hash === ''
    );
  } catch {
    return false;
  }
}

const MorateaEditorHandoffPage = () => {
  const hasStartedRedemption = useRef(false);
  const redemption = useMutation({
    mutationFn: async () => {
      const response = await authenticationApi.redeemMorateaEditorHandoff();
      if (!isSafeEditorPath(response.editorPath)) {
        throw new Error('Invalid editor path');
      }
      return response;
    },
    onSuccess: ({ session, editorPath }) => {
      authenticationSession.saveResponse(session, false);
      window.location.replace(editorPath);
    },
  });

  useEffect(() => {
    if (hasStartedRedemption.current) {
      return;
    }
    hasStartedRedemption.current = true;
    redemption.mutate();
  }, [redemption]);

  if (!redemption.isError) {
    return <LoadingScreen />;
  }

  return (
    <main className="flex h-full min-h-screen items-center justify-center p-6">
      <div className="flex max-w-sm flex-col items-center gap-4 text-center">
        <p role="alert">{MORATEA_EDITOR_HANDOFF_ERROR_MESSAGE}</p>
        <Button variant="outline" onClick={() => window.history.back()}>
          <ArrowLeft className="h-4 w-4" />
          Back to MoraTea
        </Button>
      </div>
    </main>
  );
};

MorateaEditorHandoffPage.displayName = 'MorateaEditorHandoffPage';

export { MORATEA_EDITOR_HANDOFF_ERROR_MESSAGE, MorateaEditorHandoffPage };
