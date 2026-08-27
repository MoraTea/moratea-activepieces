// @vitest-environment jsdom
import { flushSync } from 'react-dom';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

declare global {
  let IS_REACT_ACT_ENVIRONMENT: boolean;
}
globalThis.IS_REACT_ACT_ENVIRONMENT = false;

const harness = vi.hoisted(() => {
  const socket = { on: vi.fn(), off: vi.fn() };
  return {
    // banner
    lockedBy: null as string | null,
    takeOver: vi.fn(),
    run: null as unknown,
    socket,
    // chat builder state
    chatSessionMessages: [] as unknown[],
    chatSessionId: null as string | null,
    addChatMessage: vi.fn(),
    flowVersion: {
      id: 'ver-1',
      flowId: 'flow-1',
      valid: true,
      trigger: {
        type: 'PIECE_TRIGGER',
        settings: {
          pieceName: 'nonmanual',
          triggerName: 'trigger',
          sampleData: { lastTestDate: '2026-01-01T00:00:00.000Z' },
        },
      },
    } as unknown,
    setChatSessionId: vi.fn(),
    setRun: vi.fn(),
    chatDrawerOpenSource: 'test' as unknown,
    setChatDrawerOpenSource: vi.fn(),
    readonly: false,
    hideTestWidget: false,
    flow: { publishedVersionId: 'ver-1' },
    runFlow: vi.fn(),
  };
});

vi.mock('i18next', () => ({
  t: (text: string) => text,
}));

vi.mock('@/components/custom/resource-lock-widget', () => ({
  ResourceLockWidget: () => <div data-testid="lock-stub">lock</div>,
}));

vi.mock('./publish-flow-reminder-widget', () => ({
  PublishFlowReminderWidget: () => (
    <div data-testid="publish-stub">publish</div>
  ),
}));

vi.mock('./run-info-widget', () => ({
  RunInfoWidget: () => <div data-testid="run-info-stub">run</div>,
}));

vi.mock('./viewing-old-version-widget', () => ({
  ViewingOldVersionWidget: () => (
    <div data-testid="viewing-old-version-stub">viewing</div>
  ),
}));

vi.mock('./use-flow-lock', () => ({
  useFlowLock: () => ({
    lockedBy: harness.lockedBy,
    takeOver: harness.takeOver,
  }),
}));

vi.mock('@/app/builder/builder-hooks', () => ({
  useBuilderStateContext: (selector: (state: typeof harness) => unknown) =>
    selector(harness as unknown as Parameters<typeof selector>[0]),
  useBuilderStore: () => ({ getState: () => harness }),
}));

vi.mock('@/features/flow-runs', () => ({
  flowRunUtils: { updateRunSteps: vi.fn() },
}));

vi.mock('@/features/flows', () => ({
  flowHooks: {
    useTestFlowOrStartManualTrigger: () => ({
      mutate: harness.runFlow,
      isPending: false,
    }),
  },
}));

vi.mock('@/features/pieces', () => ({
  pieceSelectorUtils: {
    isChatTrigger: (pieceName: string) => pieceName === 'chat',
    isManualTrigger: ({ pieceName }: { pieceName: string }) =>
      pieceName === 'manual',
  },
}));

vi.mock('@/hooks/authorization-hooks', () => ({
  useAuthorization: () => ({ checkAccess: () => true }),
}));

vi.mock(
  '@/app/builder/builder-header/flow-status/view-draft-or-edit-flow-button',
  () => ({
    EditFlowOrViewDraftButton: () => <div>edit flow</div>,
  }),
);

vi.mock('./above-trigger-button', () => ({
  AboveTriggerButton: ({
    disable,
    onClick,
    text,
  }: {
    disable?: boolean;
    onClick: () => void;
    text: string;
  }) => (
    <button
      data-testid="test-flow-launcher"
      disabled={disable}
      onClick={onClick}
    >
      {text}
    </button>
  ),
}));

vi.mock('@/components/providers/socket-provider', () => ({
  useSocket: () => harness.socket,
}));

vi.mock('@/app/routes/chat/flow-chat', () => ({
  FlowChat: () => <div data-testid="flow-chat-stub">flow-chat</div>,
}));

vi.mock('@/components/ui/drawer', () => ({
  Drawer: ({ children, open }: { children: React.ReactNode; open: boolean }) =>
    open ? (
      <div data-testid="chat-drawer">{children}</div>
    ) : (
      <div data-testid="chat-drawer-closed" />
    ),
  DrawerContent: ({ children }: { children: React.ReactNode }) => (
    <div>{children}</div>
  ),
  DrawerHeader: ({ children }: { children: React.ReactNode }) => (
    <div>{children}</div>
  ),
  DrawerTitle: ({ children }: { children: React.ReactNode }) => (
    <div>{children}</div>
  ),
}));

vi.mock('@/components/ui/button', () => ({
  Button: ({ children, ...props }: { children: React.ReactNode }) => (
    <button {...props}>{children}</button>
  ),
}));

// Import after mocks
import { ChatDrawer } from '../../../routes/chat/chat-drawer';

import { BuilderBanner } from './builder-banner';
import { shouldHideTestFlowLauncher, TestFlowWidget } from './test-flow-widget';

describe('BuilderBanner MoraTea surface', () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    harness.lockedBy = null;
    harness.run = null;
    harness.chatDrawerOpenSource = 'test';
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    flushSync(() => {
      root.unmount();
    });
    container.remove();
  });

  it('normal banner contains publish stub', () => {
    harness.lockedBy = null;
    harness.run = null;
    flushSync(() => {
      root.render(
        <MemoryRouter initialEntries={['/flows/flow-1']}>
          <BuilderBanner />
        </MemoryRouter>,
      );
    });
    expect(
      Boolean(container.querySelector('[data-testid="publish-stub"]')),
    ).toBe(true);
    expect(
      Boolean(
        container.querySelector('[data-testid="viewing-old-version-stub"]'),
      ),
    ).toBe(true);
  });

  it('surface omits publish but retains nonproduction widgets', () => {
    harness.lockedBy = null;
    harness.run = null;
    flushSync(() => {
      root.render(
        <MemoryRouter initialEntries={['/flows/flow-1?surface=moratea']}>
          <BuilderBanner />
        </MemoryRouter>,
      );
    });
    expect(
      Boolean(container.querySelector('[data-testid="publish-stub"]')),
    ).toBe(false);
    expect(
      Boolean(
        container.querySelector('[data-testid="viewing-old-version-stub"]'),
      ),
    ).toBe(true);
  });

  it('surface retains lock widget', () => {
    harness.lockedBy = 'someone@example.com';
    harness.run = null;
    flushSync(() => {
      root.render(
        <MemoryRouter initialEntries={['/flows/flow-1?surface=moratea']}>
          <BuilderBanner />
        </MemoryRouter>,
      );
    });
    expect(Boolean(container.querySelector('[data-testid="lock-stub"]'))).toBe(
      true,
    );
    expect(
      Boolean(container.querySelector('[data-testid="publish-stub"]')),
    ).toBe(false);
  });

  it('surface retains run info widget', () => {
    harness.lockedBy = null;
    harness.run = { id: 'run-1' } as unknown;
    flushSync(() => {
      root.render(
        <MemoryRouter initialEntries={['/flows/flow-1?surface=moratea']}>
          <BuilderBanner />
        </MemoryRouter>,
      );
    });
    expect(
      Boolean(container.querySelector('[data-testid="run-info-stub"]')),
    ).toBe(true);
  });
});

describe('test flow launcher surface predicate', () => {
  it.each([
    {
      isMorateaSurface: false,
      isChatTrigger: false,
      isManualTrigger: false,
      expected: false,
    },
    {
      isMorateaSurface: false,
      isChatTrigger: false,
      isManualTrigger: true,
      expected: false,
    },
    {
      isMorateaSurface: false,
      isChatTrigger: true,
      isManualTrigger: false,
      expected: false,
    },
    {
      isMorateaSurface: false,
      isChatTrigger: true,
      isManualTrigger: true,
      expected: false,
    },
    {
      isMorateaSurface: true,
      isChatTrigger: false,
      isManualTrigger: false,
      expected: false,
    },
    {
      isMorateaSurface: true,
      isChatTrigger: false,
      isManualTrigger: true,
      expected: true,
    },
    {
      isMorateaSurface: true,
      isChatTrigger: true,
      isManualTrigger: false,
      expected: true,
    },
    {
      isMorateaSurface: true,
      isChatTrigger: true,
      isManualTrigger: true,
      expected: true,
    },
  ])(
    'returns $expected for surface=$isMorateaSurface chat=$isChatTrigger manual=$isManualTrigger',
    ({ expected, isChatTrigger, isManualTrigger, isMorateaSurface }) => {
      expect(
        shouldHideTestFlowLauncher(
          isMorateaSurface,
          isChatTrigger,
          isManualTrigger,
        ),
      ).toBe(expected);
    },
  );
});

describe('TestFlowWidget MoraTea surface', () => {
  let container: HTMLDivElement;
  let root: Root;

  const renderWidget = (
    isMorateaSurface: boolean,
    triggerKind: 'chat' | 'manual' | 'nonmanual',
  ) => {
    harness.flowVersion = {
      id: 'ver-1',
      flowId: 'flow-1',
      valid: true,
      trigger: {
        type: 'PIECE_TRIGGER',
        settings: {
          pieceName: triggerKind,
          triggerName: 'trigger',
          sampleData: { lastTestDate: '2026-01-01T00:00:00.000Z' },
        },
      },
    };
    flushSync(() => {
      root.render(
        <MemoryRouter
          initialEntries={[
            isMorateaSurface
              ? '/flows/flow-1?surface=moratea'
              : '/flows/flow-1',
          ]}
        >
          <TestFlowWidget />
        </MemoryRouter>,
      );
    });
  };

  beforeEach(() => {
    harness.readonly = false;
    harness.hideTestWidget = false;
    harness.flow.publishedVersionId = 'ver-1';
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    flushSync(() => {
      root.unmount();
    });
    container.remove();
  });

  it.each([
    {
      isMorateaSurface: false,
      triggerKind: 'chat' as const,
      expectedText: 'Open Chat',
    },
    {
      isMorateaSurface: false,
      triggerKind: 'manual' as const,
      expectedText: 'Run Flow',
    },
    {
      isMorateaSurface: false,
      triggerKind: 'nonmanual' as const,
      expectedText: 'Test Flow',
    },
    {
      isMorateaSurface: true,
      triggerKind: 'chat' as const,
      expectedText: '',
    },
    {
      isMorateaSurface: true,
      triggerKind: 'manual' as const,
      expectedText: '',
    },
    {
      isMorateaSurface: true,
      triggerKind: 'nonmanual' as const,
      expectedText: 'Test Flow',
    },
  ])(
    'renders "$expectedText" for surface=$isMorateaSurface trigger=$triggerKind',
    ({ expectedText, isMorateaSurface, triggerKind }) => {
      renderWidget(isMorateaSurface, triggerKind);
      const textContent = container.textContent?.trim() ?? '';
      const launcherIsPresent = Boolean(
        container.querySelector('[data-testid="test-flow-launcher"]'),
      );
      if (expectedText === '') {
        expect(textContent === '').toBe(true);
        expect(launcherIsPresent).toBe(false);
        return;
      }
      expect(textContent.includes(expectedText)).toBe(true);
      expect(launcherIsPresent).toBe(true);
    },
  );
});

describe('ChatDrawer MoraTea surface', () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    harness.lockedBy = null;
    harness.run = null;
    harness.chatDrawerOpenSource = 'test';
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    flushSync(() => {
      root.unmount();
    });
    container.remove();
  });

  it('normal chat drawer stub visible', () => {
    flushSync(() => {
      root.render(
        <MemoryRouter initialEntries={['/flows/flow-1']}>
          <ChatDrawer />
        </MemoryRouter>,
      );
    });
    expect(
      Boolean(container.querySelector('[data-testid="chat-drawer"]')),
    ).toBe(true);
  });

  it('surface absent (returns null)', () => {
    flushSync(() => {
      root.render(
        <MemoryRouter initialEntries={['/flows/flow-1?surface=moratea']}>
          <ChatDrawer />
        </MemoryRouter>,
      );
    });
    expect(
      Boolean(container.querySelector('[data-testid="chat-drawer"]')),
    ).toBe(false);
    expect(
      Boolean(container.querySelector('[data-testid="flow-chat-stub"]')),
    ).toBe(false);
    // component returns null -> container empty
    expect(container.innerHTML.trim()).toBe('');
  });
});
