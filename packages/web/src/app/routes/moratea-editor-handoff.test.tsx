// @vitest-environment jsdom

import type { AuthenticationResponse } from '@activepieces/shared';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type {
  ButtonHTMLAttributes,
  MouseEvent as ReactMouseEvent,
} from 'react';
import { flushSync } from 'react-dom';
import { createRoot } from 'react-dom/client';
import type { Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const harness = vi.hoisted(() => ({
  redeem: vi.fn(),
  saveResponse: vi.fn(),
  back: undefined as (() => void) | undefined,
}));

vi.mock('@/api/authentication-api', () => ({
  authenticationApi: {
    redeemMorateaEditorHandoff: harness.redeem,
  },
}));

vi.mock('@/lib/authentication-session', () => ({
  authenticationSession: {
    saveResponse: harness.saveResponse,
  },
}));

vi.mock('@/components/custom/loading-screen', () => ({
  LoadingScreen: () => <div>Loading</div>,
}));

vi.mock('@/components/ui/button', () => ({
  Button: ({
    children,
    onClick,
    ...props
  }: ButtonHTMLAttributes<HTMLButtonElement>) => {
    harness.back = onClick
      ? () => onClick({} as ReactMouseEvent<HTMLButtonElement>)
      : undefined;
    return <button {...props}>{children}</button>;
  },
}));

import {
  MORATEA_EDITOR_HANDOFF_ERROR_MESSAGE,
  MorateaEditorHandoffPage,
} from './moratea-editor-handoff';

const editorPath = '/flows/flow-1?surface=moratea';
const session = {} as AuthenticationResponse;

describe('MorateaEditorHandoffPage', () => {
  let container: HTMLDivElement;
  let root: Root;
  let replace: ReturnType<typeof vi.fn>;
  let historyBack: ReturnType<typeof vi.fn>;
  let queryClient: QueryClient;

  beforeEach(() => {
    harness.redeem.mockReset();
    harness.saveResponse.mockReset();
    harness.back = undefined;
    replace = vi.fn();
    historyBack = vi.spyOn(window.history, 'back').mockImplementation(() => {});
    Object.defineProperty(window, 'location', {
      value: { origin: 'http://localhost', replace },
      writable: true,
    });
    queryClient = new QueryClient({
      defaultOptions: { mutations: { retry: false } },
    });
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    flushSync(() => root.unmount());
    container.remove();
    historyBack.mockRestore();
  });

  const renderPage = () => {
    flushSync(() =>
      root.render(
        <QueryClientProvider client={queryClient}>
          <MorateaEditorHandoffPage />
        </QueryClientProvider>,
      ),
    );
  };

  it('redeems once across rerender, saves before replacing with the exact editor path', async () => {
    const events: string[] = [];
    harness.redeem.mockResolvedValue({ session, editorPath });
    harness.saveResponse.mockImplementation(() => events.push('save'));
    replace.mockImplementation(() => events.push('replace'));

    renderPage();
    renderPage();

    await vi.waitFor(() => {
      expect(replace).toHaveBeenCalledWith('/flows/flow-1?surface=moratea');
    });
    expect(harness.redeem).toHaveBeenCalledTimes(1);
    expect(harness.redeem).toHaveBeenCalledWith();
    expect(harness.saveResponse).toHaveBeenCalledWith(session, false);
    expect(events).toEqual(['save', 'replace']);
  });

  it.each([
    'https://attacker.example/steal',
    '//attacker.example/steal',
    '/flows/flow-1?surface=wrong',
  ])(
    'rejects an unsafe editor path without saving or navigating: %s',
    async (unsafePath) => {
      harness.redeem.mockResolvedValue({ session, editorPath: unsafePath });

      renderPage();

      await vi.waitFor(() => {
        expect(harness.back).toBeTypeOf('function');
      });
      expect(harness.saveResponse).not.toHaveBeenCalled();
      expect(replace).not.toHaveBeenCalled();
    },
  );

  it('shows a generic failure and Back to MoraTea uses history', async () => {
    harness.redeem.mockRejectedValue(new Error('backend secret details'));

    renderPage();

    await vi.waitFor(() => {
      expect(harness.back).toBeTypeOf('function');
    });
    expect(MORATEA_EDITOR_HANDOFF_ERROR_MESSAGE).toBe(
      'Something went wrong, please try again later',
    );

    harness.back?.();
    expect(historyBack).toHaveBeenCalledTimes(1);
  });
});
