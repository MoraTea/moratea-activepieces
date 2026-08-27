// @vitest-environment jsdom
import { flushSync } from 'react-dom';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

declare global {
  let IS_REACT_ACT_ENVIRONMENT: boolean;
}
globalThis.IS_REACT_ACT_ENVIRONMENT = false;

const harness = vi.hoisted(() => ({
  loggedIn: false,
  onboarding: false,
  redirectToSignIn: vi.fn(),
  logOut: vi.fn(),
  reset: vi.fn(),
  useCurrentPlatform: vi.fn(),
  useFlags: vi.fn(),
  useCurrentProject: vi.fn(),
}));

vi.mock('../../lib/authentication-session', () => ({
  authenticationSession: {
    isLoggedIn: () => harness.loggedIn,
    isOnboarding: () => harness.onboarding,
    redirectToSignIn: harness.redirectToSignIn,
    logOut: harness.logOut,
  },
}));

vi.mock('@/components/providers/telemetry-provider', () => ({
  useTelemetry: () => ({ reset: harness.reset }),
}));

vi.mock('@/components/providers/socket-provider', () => ({
  SocketProvider: ({ children }: { children: React.ReactNode }) => children,
}));

vi.mock('@/features/projects', () => ({
  projectCollectionUtils: {
    useCurrentProject: harness.useCurrentProject,
  },
}));

vi.mock('@/hooks/flags-hooks', () => ({
  flagsHooks: { useFlags: harness.useFlags },
}));

vi.mock('@/hooks/platform-hooks', () => ({
  platformHooks: { useCurrentPlatform: harness.useCurrentPlatform },
}));

import { AllowOnlyLoggedInUserOnlyGuard } from './allow-logged-in-user-only-guard';

const LocationProbe = () => {
  const location = useLocation();
  return (
    <output data-testid="location">
      {location.pathname}
      {location.search}
    </output>
  );
};

describe('AllowOnlyLoggedInUserOnlyGuard return location', () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    harness.loggedIn = false;
    harness.onboarding = false;
    vi.clearAllMocks();
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    flushSync(() => root.unmount());
    container.remove();
  });

  const renderGuard = (initialEntry: string) => {
    flushSync(() => {
      root.render(
        <MemoryRouter initialEntries={[initialEntry]}>
          <LocationProbe />
          <Routes>
            <Route path="/sign-in" element={null} />
            <Route
              path="*"
              element={
                <AllowOnlyLoggedInUserOnlyGuard>
                  <div data-testid="protected-child">protected</div>
                </AllowOnlyLoggedInUserOnlyGuard>
              }
            />
          </Routes>
        </MemoryRouter>,
      );
    });
  };

  const currentLocation = () =>
    container.querySelector('[data-testid="location"]')?.textContent ?? '';

  it('reloads sign-in with the exact MoraTea return location', () => {
    renderGuard('/flows/flow-1?surface=moratea');

    expect(currentLocation()).toBe('/flows/flow-1?surface=moratea');
    expect(harness.reset).toHaveBeenCalledOnce();
    expect(harness.redirectToSignIn).toHaveBeenCalledOnce();
    expect(harness.redirectToSignIn).toHaveBeenCalledWith(
      '/flows/flow-1?surface=moratea',
    );
    expect(harness.reset.mock.invocationCallOrder[0]).toBeLessThan(
      harness.redirectToSignIn.mock.invocationCallOrder[0],
    );
    expect(
      container.querySelector('[data-testid="protected-child"]'),
    ).toBeNull();
    expect(harness.logOut).not.toHaveBeenCalled();
  });

  it('passes a normal path and query to the reload redirect unchanged', () => {
    renderGuard('/projects/project-1/flows?folderId=folder-1&view=grid');

    expect(currentLocation()).toBe(
      '/projects/project-1/flows?folderId=folder-1&view=grid',
    );
    expect(harness.redirectToSignIn).toHaveBeenCalledOnce();
    expect(harness.redirectToSignIn).toHaveBeenCalledWith(
      '/projects/project-1/flows?folderId=folder-1&view=grid',
    );
  });

  it('leaves logged-in children unchanged', () => {
    harness.loggedIn = true;

    renderGuard('/flows/flow-1?surface=moratea');

    expect(
      container.querySelector('[data-testid="protected-child"]')?.textContent,
    ).toBe('protected');
    expect(currentLocation()).toBe('/flows/flow-1?surface=moratea');
    expect(harness.redirectToSignIn).not.toHaveBeenCalled();
    expect(harness.logOut).not.toHaveBeenCalled();
  });
});
