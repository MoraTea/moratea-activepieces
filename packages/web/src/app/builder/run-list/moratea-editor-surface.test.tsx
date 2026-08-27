// @vitest-environment jsdom
import { FlowRetryStrategy, FlowRunStatus } from '@activepieces/shared';
import type { FlowRun } from '@activepieces/shared';
import type {
  HTMLAttributes,
  MouseEventHandler,
  ReactNode,
  SVGProps,
} from 'react';
import { flushSync } from 'react-dom';
import { createRoot } from 'react-dom/client';
import type { Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

declare global {
  let IS_REACT_ACT_ENVIRONMENT: boolean;
}
globalThis.IS_REACT_ACT_ENVIRONMENT = false;

const harness = vi.hoisted(() => ({
  builderState: {
    flow: { id: 'flow-1' },
    flowVersion: { state: 'LOCKED' },
    readonly: true,
    run: { id: 'run-1' },
    setReadOnly: vi.fn(),
  },
  isPending: false,
  lockedBy: null,
  navigate: vi.fn(),
  pathname: '/runs/run-1',
  retryRun: vi.fn(),
  searchParams: new URLSearchParams(),
  switchToDraft: vi.fn(),
}));

vi.mock('i18next', () => ({
  t: (key: string) => key,
}));

vi.mock('react-router-dom', () => ({
  useNavigate: () => harness.navigate,
  useSearchParams: () => [harness.searchParams, vi.fn()],
}));

vi.mock('react-use', () => ({
  useLocation: () => ({ pathname: harness.pathname }),
}));

vi.mock('../builder-hooks', () => ({
  useBuilderStateContext: (
    selector: (state: typeof harness.builderState) => unknown,
  ) => selector(harness.builderState),
}));

vi.mock('../flow-canvas/hooks', () => ({
  flowCanvasHooks: {
    useSwitchToDraft: () => ({
      isSwitchingToDraftPending: false,
      switchToDraft: harness.switchToDraft,
    }),
  },
}));

vi.mock('../flow-canvas/widgets/above-trigger-button', () => ({
  AboveTriggerButton: ({
    onClick,
    text,
  }: {
    onClick: MouseEventHandler<HTMLButtonElement>;
    text: string;
  }) => <button onClick={onClick}>{text}</button>,
}));

vi.mock('@/hooks/use-resource-lock', () => ({
  useResourceLock: ({ onTakeOver }: { onTakeOver: () => void }) => ({
    lockedBy: harness.lockedBy,
    takeOver: onTakeOver,
  }),
}));

vi.mock('@/components/custom/card-list', () => ({
  CardListItem: ({
    children,
    ...props
  }: HTMLAttributes<HTMLDivElement> & { children: ReactNode }) => (
    <div data-testid="run-card" {...props}>
      {children}
    </div>
  ),
}));

vi.mock('@/components/custom/formatted-date', () => ({
  FormattedDate: () => <time>created</time>,
}));

vi.mock('@/components/custom/permission-needed-tooltip', () => ({
  PermissionNeededTooltip: ({ children }: { children: ReactNode }) => (
    <>{children}</>
  ),
}));

vi.mock('@/components/custom/spinner', () => ({
  LoadingSpinner: () => <div data-testid="retry-spinner" />,
}));
vi.mock('@/components/ui/button', () => ({
  Button: ({
    children,
    className,
    onClick,
  }: {
    children: ReactNode;
    className?: string;
    onClick?: MouseEventHandler<HTMLButtonElement>;
  }) => (
    <button className={className} onClick={onClick}>
      {children}
    </button>
  ),
}));

vi.mock('@/components/ui/dropdown-menu', () => ({
  DropdownMenu: ({ children }: { children: ReactNode }) => <>{children}</>,
  DropdownMenuContent: ({ children }: { children: ReactNode }) => (
    <div data-testid="retry-menu">{children}</div>
  ),
  DropdownMenuItem: ({
    children,
    className,
    disabled,
    onClick,
  }: {
    children: ReactNode;
    className?: string;
    disabled?: boolean;
    onClick?: MouseEventHandler<HTMLButtonElement>;
  }) => (
    <button className={className} disabled={disabled} onClick={onClick}>
      {children}
    </button>
  ),
  DropdownMenuTrigger: ({ children }: { children: ReactNode }) => (
    <>{children}</>
  ),
}));

vi.mock('@/components/ui/tooltip', () => ({
  Tooltip: ({ children }: { children: ReactNode }) => <>{children}</>,
  TooltipContent: ({ children }: { children: ReactNode }) => (
    <span>{children}</span>
  ),
  TooltipTrigger: ({ children }: { children: ReactNode }) => <>{children}</>,
}));

vi.mock('@/features/flow-runs', () => ({
  flowRunUtils: {
    getStatusIcon: () => ({
      Icon: (props: SVGProps<SVGSVGElement>) => <svg {...props} />,
      variant: 'error',
    }),
  },
}));

vi.mock('@/features/flow-runs/hooks/flow-run-hooks', () => ({
  flowRunMutations: {
    useRetryRun: () => ({
      isPending: harness.isPending,
      mutate: harness.retryRun,
    }),
  },
}));

vi.mock('@/hooks/authorization-hooks', () => ({
  useAuthorization: () => ({ checkAccess: () => true }),
}));

vi.mock('@/lib/authentication-session', () => ({
  authenticationSession: { getProjectId: () => 'project-1' },
}));

import {
  morateaEditorNavigationOptions,
  withMorateaEditorSurface,
} from '@/lib/navigation-utils';

import { EditFlowOrViewDraftButton } from '../builder-header/flow-status/view-draft-or-edit-flow-button';
import { useFlowLock } from '../flow-canvas/widgets/use-flow-lock';

import { FlowRunCard } from './flow-run-card';

const run = {
  id: 'run-1',
  flowId: 'flow-1',
  projectId: 'project-1',
  status: FlowRunStatus.FAILED,
  created: '2026-08-27T00:00:00.000Z',
  startTime: '2026-08-27T00:00:00.000Z',
  finishTime: '2026-08-27T00:00:01.000Z',
} as FlowRun;

const FlowLockHarness = () => {
  const { takeOver } = useFlowLock();
  return <button onClick={takeOver}>Take over</button>;
};

describe('withMorateaEditorSurface', () => {
  it('returns normal paths byte-for-byte unchanged', () => {
    const path = '/runs/run-1?foo=a%20b#step';
    expect(withMorateaEditorSurface(path, false)).toBe(path);
  });

  it('adds the MoraTea surface without dropping query or fragment', () => {
    expect(withMorateaEditorSurface('/runs/run-1?foo=bar#step', true)).toBe(
      '/runs/run-1?foo=bar&surface=moratea#step',
    );
  });
});

describe('morateaEditorNavigationOptions', () => {
  it('replaces history only for the MoraTea surface', () => {
    expect(morateaEditorNavigationOptions(false)).toBeUndefined();
    expect(morateaEditorNavigationOptions(true)).toEqual({ replace: true });
  });
});

describe('FlowRunCard MoraTea surface', () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    harness.isPending = false;
    harness.navigate.mockReset();
    harness.retryRun.mockReset();
    harness.searchParams = new URLSearchParams();
    harness.pathname = '/runs/run-1';
    harness.switchToDraft.mockReset();
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    flushSync(() => root.unmount());
    container.remove();
  });

  const renderCard = () => {
    flushSync(() => {
      root.render(<FlowRunCard run={run} refetchRuns={vi.fn()} />);
    });
  };

  const click = (element: Element | null) => {
    expect(element).not.toBeNull();
    flushSync(() => {
      (element as HTMLElement).click();
    });
  };

  it('keeps normal navigation and retry actions unchanged', () => {
    renderCard();

    expect((container.textContent ?? '').includes('Retry run')).toBe(true);
    expect((container.textContent ?? '').includes('On latest version')).toBe(
      true,
    );
    expect((container.textContent ?? '').includes('From failed step')).toBe(
      true,
    );

    click(container.querySelector('[data-testid="run-card"]'));
    expect(harness.navigate).toHaveBeenCalledTimes(1);
    expect(harness.navigate).toHaveBeenCalledWith('/runs/run-1');

    const latestRetry = Array.from(container.querySelectorAll('button')).find(
      (button) => button.textContent?.includes('On latest version'),
    );
    click(latestRetry ?? null);
    expect(harness.retryRun).toHaveBeenCalledTimes(1);
    expect(harness.retryRun).toHaveBeenCalledWith({
      runId: 'run-1',
      flowId: 'flow-1',
      projectId: 'project-1',
      retryStrategy: FlowRetryStrategy.ON_LATEST_VERSION,
    });
  });

  it('preserves the reduced surface route and exposes no retry behavior', () => {
    harness.searchParams = new URLSearchParams('surface=moratea');
    harness.isPending = true;
    renderCard();

    expect((container.textContent ?? '').includes('Retry run')).toBe(false);
    expect((container.textContent ?? '').includes('On latest version')).toBe(
      false,
    );
    expect((container.textContent ?? '').includes('From failed step')).toBe(
      false,
    );
    expect(container.querySelector('[data-testid="retry-menu"]')).toBeNull();
    expect(container.querySelector('[data-testid="retry-spinner"]')).toBeNull();

    click(container.querySelector('[data-testid="run-card"]'));
    expect(harness.navigate).toHaveBeenCalledTimes(1);
    expect(harness.navigate).toHaveBeenCalledWith(
      '/runs/run-1?surface=moratea',
      { replace: true },
    );
    expect(harness.retryRun).not.toHaveBeenCalled();
  });

  it('preserves the surface when returning from a run to the flow', () => {
    harness.searchParams = new URLSearchParams('surface=moratea');
    flushSync(() => {
      root.render(<EditFlowOrViewDraftButton onCanvas={false} />);
    });

    click(
      Array.from(container.querySelectorAll('button')).find(
        (button) => button.textContent === 'Edit flow',
      ) ?? null,
    );
    expect(harness.navigate).toHaveBeenCalledWith(
      '/flows/flow-1?surface=moratea',
      { replace: true },
    );
    expect(harness.switchToDraft).not.toHaveBeenCalled();
  });

  it('preserves the surface when lock takeover leaves a run', () => {
    harness.searchParams = new URLSearchParams('surface=moratea');
    flushSync(() => {
      root.render(<FlowLockHarness />);
    });

    click(
      Array.from(container.querySelectorAll('button')).find(
        (button) => button.textContent === 'Take over',
      ) ?? null,
    );
    expect(harness.navigate).toHaveBeenCalledWith(
      '/flows/flow-1?surface=moratea',
      { replace: true },
    );
    expect(harness.switchToDraft).not.toHaveBeenCalled();
  });
});
