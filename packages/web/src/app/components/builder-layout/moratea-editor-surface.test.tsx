// @vitest-environment jsdom
import type { URLSearchParams as URLSearchParamsType } from 'url';

import * as React from 'react';
import { flushSync } from 'react-dom';
import { createRoot, type Root } from 'react-dom/client';

const { mockUseSearchParams } = vi.hoisted(() => ({
  mockUseSearchParams: vi.fn(
    () =>
      [new URLSearchParams(), vi.fn()] as unknown as [
        URLSearchParamsType,
        (p: URLSearchParamsType) => void,
      ],
  ),
}));

vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual('react-router-dom');
  return {
    ...(actual as Record<string, unknown>),
    useSearchParams: (...args: unknown[]) =>
      (mockUseSearchParams as unknown as (...a: unknown[]) => unknown)(...args),
    useNavigate: () => vi.fn(),
    useParams: () => ({}),
  };
});

vi.mock('@/components/providers/embed-provider', () => ({
  useEmbedding: () => ({ embedState: { isEmbedded: false } }),
}));

vi.mock('@/hooks/flags-hooks', () => ({
  flagsHooks: {
    useFlag: () => ({ data: 'CLOUD' }),
  },
}));

vi.mock('@/features/billing', () => ({
  ManagePlanDialog: () =>
    React.createElement('div', { 'data-testid': 'manage-plan' }, 'manage'),
}));

vi.mock('@/components/ui/sidebar-shadcn', () => ({
  SidebarProvider: ({ children }: { children: React.ReactNode }) =>
    React.createElement('div', { 'data-testid': 'sidebar-provider' }, children),
  SidebarInset: ({
    children,
    className,
  }: {
    children: React.ReactNode;
    className: string;
  }) =>
    React.createElement(
      'div',
      { 'data-testid': 'sidebar-inset', className },
      children,
    ),
}));

vi.mock('@/app/components/sidebar/dashboard', () => ({
  ProjectDashboardSidebar: () =>
    React.createElement('div', { 'data-testid': 'project-sidebar' }, 'sidebar'),
}));

vi.mock('@/app/components/global-search/global-search-context', () => ({
  GlobalSearchProvider: ({
    children,
    disabled = false,
  }: {
    children: React.ReactNode;
    disabled?: boolean;
  }) =>
    React.createElement(
      'div',
      {
        'data-testid': 'global-search-provider',
        'data-disabled': String(disabled),
      },
      children,
    ),
  useGlobalSearch: () => ({ open: false }),
}));

import { BuilderLayout } from './index';

describe('BuilderLayout MoraTea surface', () => {
  let container: HTMLDivElement | null = null;
  let root: Root | null = null;

  function hasClass(element: Element, name: string): boolean {
    return Array.from(element.classList).includes(name);
  }

  function createLayout(): void {
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
    flushSync(() => {
      root!.render(
        React.createElement(
          BuilderLayout,
          null,
          React.createElement('div', { 'data-testid': 'child' }, 'child'),
        ),
      );
    });
  }

  function cleanup(): void {
    if (root) {
      flushSync(() => {
        root!.unmount();
      });
    }
    container?.remove();
    root = null;
    container = null;
  }

  afterEach(() => {
    cleanup();
    mockUseSearchParams.mockReset();
    mockUseSearchParams.mockReturnValue([
      new URLSearchParams(),
      vi.fn(),
    ] as unknown as [URLSearchParams, (p: URLSearchParams) => void]);
  });

  beforeEach(() => {
    mockUseSearchParams.mockReturnValue([
      new URLSearchParams(),
      vi.fn(),
    ] as unknown as [URLSearchParams, (p: URLSearchParams) => void]);
  });

  it('normal renders sidebar and framed container (bg-sidebar, p-1.5, rounded, shadow, border)', () => {
    mockUseSearchParams.mockReturnValue([
      new URLSearchParams(),
      vi.fn(),
    ] as unknown as [URLSearchParams, (p: URLSearchParams) => void]);
    createLayout();

    expect(
      document.querySelector('[data-testid="project-sidebar"]') !== null,
    ).toBe(true);
    const inset = document.querySelector(
      '[data-testid="sidebar-inset"]',
    ) as HTMLElement | null;
    expect(inset !== null).toBe(true);
    expect(hasClass(inset!, 'bg-sidebar')).toBe(true);

    const paddingContainer = inset!.firstElementChild as HTMLElement;
    const frame = paddingContainer.firstElementChild as HTMLElement;
    expect(hasClass(paddingContainer, 'p-1.5')).toBe(true);
    expect(hasClass(frame, 'rounded-xl')).toBe(true);
    expect(
      Array.from(frame.classList).some((className) =>
        className.startsWith('shadow-'),
      ),
    ).toBe(true);
    expect(hasClass(frame, 'border')).toBe(true);
    expect(
      document
        .querySelector('[data-testid="global-search-provider"]')
        ?.getAttribute('data-disabled'),
    ).toBe('false');
    expect(document.querySelector('[data-testid="manage-plan"]') !== null).toBe(
      true,
    );
    expect(document.querySelector('[data-testid="child"]') !== null).toBe(true);
  });

  it('surface surface=moratea hides sidebar and removes framed styling for full h-full viewport', () => {
    mockUseSearchParams.mockReturnValue([
      new URLSearchParams('surface=moratea'),
      vi.fn(),
    ] as unknown as [URLSearchParams, (p: URLSearchParams) => void]);
    createLayout();

    expect(
      document.querySelector('[data-testid="project-sidebar"]') === null,
    ).toBe(true);

    const inset = document.querySelector(
      '[data-testid="sidebar-inset"]',
    ) as HTMLElement | null;
    expect(inset !== null).toBe(true);
    expect(hasClass(inset!, 'bg-sidebar')).toBe(false);
    expect(hasClass(inset!, 'h-full')).toBe(true);

    const paddingContainer = inset!.firstElementChild as HTMLElement;
    const frame = paddingContainer.firstElementChild as HTMLElement;
    expect(hasClass(paddingContainer, 'p-1.5')).toBe(false);
    expect(hasClass(frame, 'rounded-xl')).toBe(false);
    expect(
      Array.from(frame.classList).some((className) =>
        className.startsWith('shadow-'),
      ),
    ).toBe(false);
    expect(hasClass(frame, 'border')).toBe(false);
    expect(
      document
        .querySelector('[data-testid="global-search-provider"]')
        ?.getAttribute('data-disabled'),
    ).toBe('true');
    expect(document.querySelector('[data-testid="manage-plan"]') === null).toBe(
      true,
    );
    expect(document.querySelector('[data-testid="child"]') !== null).toBe(true);
  });

  it('surface retains layout and search context providers', () => {
    mockUseSearchParams.mockReturnValue([
      new URLSearchParams('surface=moratea'),
      vi.fn(),
    ] as unknown as [URLSearchParams, (p: URLSearchParams) => void]);
    createLayout();

    expect(
      document.querySelector('[data-testid="sidebar-provider"]') !== null,
    ).toBe(true);
    expect(
      document.querySelector('[data-testid="global-search-provider"]') !== null,
    ).toBe(true);
  });

  it('disabled search keeps context while omitting its hotkey and dialog', async () => {
    const actualSearch = (await vi.importActual(
      '../global-search/global-search-context',
    )) as {
      GlobalSearchProvider: React.ComponentType<{
        children: React.ReactNode;
        disabled?: boolean;
      }>;
      useGlobalSearch: () => {
        open: boolean;
        setOpen: (open: boolean) => void;
      };
    };
    const Probe = () => {
      const { open, setOpen } = actualSearch.useGlobalSearch();
      return React.createElement(
        'button',
        {
          'data-testid': 'search-probe',
          'data-open': String(open),
          onClick: () => setOpen(true),
        },
        'search',
      );
    };

    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
    flushSync(() => {
      root!.render(
        React.createElement(
          actualSearch.GlobalSearchProvider,
          { disabled: true },
          React.createElement(Probe),
        ),
      );
    });

    const hotkey = new KeyboardEvent('keydown', {
      key: 'k',
      ctrlKey: true,
      cancelable: true,
    });
    document.dispatchEvent(hotkey);
    expect(hotkey.defaultPrevented).toBe(false);
    expect(
      document
        .querySelector('[data-testid="search-probe"]')
        ?.getAttribute('data-open'),
    ).toBe('false');

    flushSync(() => {
      (
        document.querySelector('[data-testid="search-probe"]') as HTMLElement
      ).click();
    });
    expect(
      document
        .querySelector('[data-testid="search-probe"]')
        ?.getAttribute('data-open'),
    ).toBe('true');
    expect(document.querySelector('[role="dialog"]') === null).toBe(true);
  });
});
