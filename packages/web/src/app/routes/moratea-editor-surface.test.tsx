// @vitest-environment jsdom
import { flushSync } from 'react-dom';
import { createRoot } from 'react-dom/client';
import type { Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const harness = vi.hoisted(() => ({
  claimThirdPartyRequest: vi.fn(),
  navigate: vi.fn(),
  saveResponse: vi.fn(),
  search: '',
}));

vi.mock('i18next', () => ({
  t: (key: string) => key,
}));

vi.mock('react-router-dom', () => ({
  useLocation: () => ({ search: harness.search }),
  useNavigate: () => harness.navigate,
}));

vi.mock('sonner', () => ({
  toast: vi.fn(),
}));

vi.mock('@/api/authentication-api', () => ({
  authenticationApi: {
    claimThirdPartyRequest: harness.claimThirdPartyRequest,
  },
}));

vi.mock('@/components/custom/loading-screen', () => ({
  LoadingScreen: () => <div>Loading</div>,
}));

vi.mock('@/components/ui/sonner', () => ({
  internalErrorToast: vi.fn(),
}));

vi.mock('@/lib/api', () => ({
  api: { isError: vi.fn(() => false) },
}));

vi.mock('@/lib/authentication-session', () => ({
  authenticationSession: { saveResponse: harness.saveResponse },
}));

import { RedirectPage } from './redirect';

describe('RedirectPage MoraTea editor surface return', () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    harness.claimThirdPartyRequest.mockReset();
    harness.navigate.mockReset();
    harness.saveResponse.mockReset();
    harness.search = '';
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    flushSync(() => root.unmount());
    container.remove();
  });

  const renderRedirect = (from: string, projectId: string | null) => {
    harness.search = new URLSearchParams({
      code: 'oauth-code',
      state: JSON.stringify({
        activepiecesLogin: true,
        from,
        providerName: 'google',
      }),
    }).toString();
    harness.claimThirdPartyRequest.mockResolvedValue({ projectId });

    flushSync(() => root.render(<RedirectPage />));
  };

  it('replaces the OAuth callback history entry for a MoraTea editor return', async () => {
    const from = '/projects/project-1/flows/flow-1?view=canvas&surface=moratea';

    renderRedirect(from, 'project-1');

    await vi.waitFor(() => {
      expect(harness.navigate).toHaveBeenCalledWith(from, { replace: true });
    });
    expect(harness.navigate).toHaveBeenCalledTimes(1);
  });

  it('keeps normal third-party login navigation unchanged', async () => {
    const from = '/projects/project-1/flows';

    renderRedirect(from, 'project-1');

    await vi.waitFor(() => {
      expect(harness.navigate).toHaveBeenCalledWith(from);
    });
    expect(harness.navigate).toHaveBeenCalledTimes(1);
  });

  it('keeps projectless third-party login navigation unchanged', async () => {
    renderRedirect('/projects/project-1/flows/flow-1?surface=moratea', null);

    await vi.waitFor(() => {
      expect(harness.navigate).toHaveBeenCalledWith('/create-platform');
    });
    expect(harness.navigate).toHaveBeenCalledTimes(1);
  });
});
