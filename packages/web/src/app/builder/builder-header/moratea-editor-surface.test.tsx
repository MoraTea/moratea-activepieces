// @vitest-environment jsdom
import * as React from 'react';
import { flushSync } from 'react-dom';
import { createRoot, type Root } from 'react-dom/client';

const {
  mockApplyOperation,
  mockSetRightSidebar,
  mockMoveToFolder,
  mockCheckAccess,
  mockUseSearchParams,
  mockHistoryBack,
  mockInvalidateFlowsQuery,
  mockT,
} = vi.hoisted(() => ({
  mockApplyOperation: vi.fn(),
  mockSetRightSidebar: vi.fn(),
  mockMoveToFolder: vi.fn(),
  mockCheckAccess: vi.fn(() => true),
  mockUseSearchParams: vi.fn(
    () =>
      [new URLSearchParams(), vi.fn()] as unknown as [
        URLSearchParams,
        (p: URLSearchParams) => void,
      ],
  ),
  mockHistoryBack: vi.fn(),
  mockInvalidateFlowsQuery: vi.fn(),
  mockT: vi.fn((key: string) => key),
}));

vi.mock('i18next', () => ({
  t: (key: string) => (mockT as unknown as (k: string) => string)(key),
  default: {
    language: 'en',
    t: (key: string) => (mockT as unknown as (k: string) => string)(key),
  },
}));

vi.mock('react-router-dom', () => ({
  useSearchParams: (...args: unknown[]) =>
    (mockUseSearchParams as unknown as (...a: unknown[]) => unknown)(...args),
  useNavigate: () => vi.fn(),
  createSearchParams: (params: Record<string, string>) =>
    new URLSearchParams(params),
  useParams: () => ({}),
}));

vi.mock('@tanstack/react-query', () => ({
  useQueryClient: () => ({}),
}));

vi.mock('lucide-react', () => ({
  ArrowLeft: (props: { className?: string }) =>
    React.createElement('svg', {
      'data-testid': 'arrow-left',
      className: props.className,
    }),
  ChevronDown: (props: { className?: string }) =>
    React.createElement('svg', {
      'data-testid': 'chevron-down',
      className: props.className,
    }),
  CircleHelp: (props: { className?: string }) =>
    React.createElement('svg', {
      'data-testid': 'circle-help',
      className: props.className,
    }),
  HistoryIcon: (props: { className?: string }) =>
    React.createElement('svg', {
      'data-testid': 'history-icon',
      className: props.className,
    }),
}));

vi.mock('@/app/builder/builder-hooks', () => ({
  useBuilderStateContext: (
    selector: (state: Record<string, unknown>) => unknown,
  ) => {
    const state = {
      flow: {
        id: 'flow-1',
        folderId: 'folder-1',
        createdBy: 'user-1',
        publishedVersionId: 'v1',
      },
      flowVersion: { id: 'v1', displayName: 'Test Flow', state: 'DRAFT' },
      moveToFolderClientSide: mockMoveToFolder,
      applyOperation: mockApplyOperation,
      setRightSidebar: mockSetRightSidebar,
    };
    return selector(state as unknown as Parameters<typeof selector>[0]);
  },
}));

vi.mock('@/components/providers/embed-provider', () => ({
  useEmbedding: () => ({
    embedState: {
      isEmbedded: false,
      disableNavigationInBuilder: false,
      hideFlowNameInBuilder: false,
      hideActiveUsers: false,
    },
  }),
}));

vi.mock('@/features/projects', () => ({
  getProjectName: () => 'TestProject',
  projectCollectionUtils: {
    useCurrentProject: () => ({
      project: { displayName: 'TestProject', id: 'proj-1' },
    }),
  },
}));

vi.mock('@/features/folders', () => ({
  foldersHooks: {
    useFolder: () => ({ data: { id: 'folder-1' } }),
  },
}));

vi.mock('@/hooks/flags-hooks', () => ({
  flagsHooks: {
    useFlag: () => ({ data: true }),
  },
}));

vi.mock('@/hooks/authorization-hooks', () => ({
  useAuthorization: () => ({ checkAccess: mockCheckAccess }),
}));

vi.mock('@/lib/authentication-session', () => ({
  authenticationSession: {
    appendProjectRoutePrefix: (path: string) => path,
  },
}));

vi.mock('@/lib/navigation-utils', () => ({
  useNewWindow: () => vi.fn(),
  isMorateaEditorSurface: (params: URLSearchParams) =>
    params.get('surface') === 'moratea',
  useMorateaEditorSurface: () => {
    const [params] = (
      mockUseSearchParams as unknown as () => [URLSearchParams, unknown]
    )();
    return (params as URLSearchParams).get('surface') === 'moratea';
  },
  MORATEA_SURFACE_QUERY_PARAM: 'surface',
  MORATEA_SURFACE_VALUE: 'moratea',
  FROM_QUERY_PARAM: 'from',
  STATE_QUERY_PARAM: 'state',
  LOGIN_QUERY_PARAM: 'activepiecesLogin',
  PROVIDER_NAME_QUERY_PARAM: 'providerName',
  buildCurrentProjectRedirectPath: (
    a: string,
    b: string,
    _c: Record<string, string>,
    d: string,
  ) => `/projects/${a}${b}${d ? `?${d}` : ''}`,
  useDefaultRedirectPath: () => '/',
  useRedirectAfterLogin: () => () => {},
}));

vi.mock('@/features/flows', () => ({
  flowHooks: {
    invalidateFlowsQuery: (...args: unknown[]) =>
      (mockInvalidateFlowsQuery as unknown as (...a: unknown[]) => unknown)(
        ...args,
      ),
  },
}));

vi.mock('@/components/custom/active-users-widget', () => ({
  ActiveUsersWidget: () =>
    React.createElement(
      'div',
      { 'data-testid': 'active-users' },
      'active-users',
    ),
}));

vi.mock('@/components/custom/editable-text', () => ({
  default: (props: {
    value: string;
    readonly: boolean;
    onValueChange: (v: string) => void;
    isEditing: boolean;
    setIsEditing: (b: boolean) => void;
  }) =>
    React.createElement(
      'div',
      {
        'data-testid': 'editable-text',
        'data-value': props.value,
        'data-readonly': String(props.readonly),
      },
      React.createElement('span', null, props.value),
      React.createElement(
        'button',
        {
          'data-testid': 'editable-edit',
          onClick: () => props.onValueChange(`${props.value}-edited`),
        },
        'edit',
      ),
      React.createElement(
        'button',
        {
          'data-testid': 'editable-set-editing',
          onClick: () => props.setIsEditing(true),
        },
        'setEditing',
      ),
    ),
}));

vi.mock('@/components/custom/home-button', () => ({
  HomeButton: () =>
    React.createElement('div', { 'data-testid': 'home-button' }, 'home'),
}));

vi.mock('@/components/custom/page-header', () => ({
  PageHeader: (props: {
    title: React.ReactNode;
    rightContent: React.ReactNode;
    leftContent: React.ReactNode;
    className: string;
  }) =>
    React.createElement(
      'div',
      { 'data-testid': 'page-header', className: props.className },
      React.createElement('div', { 'data-testid': 'page-title' }, props.title),
      React.createElement(
        'div',
        { 'data-testid': 'page-right' },
        props.rightContent,
      ),
      React.createElement(
        'div',
        { 'data-testid': 'page-left' },
        props.leftContent,
      ),
    ),
}));

vi.mock('@/components/ui/breadcrumb', () => ({
  Breadcrumb: ({ children }: { children: React.ReactNode }) =>
    React.createElement('nav', { 'data-testid': 'breadcrumb' }, children),
  BreadcrumbList: ({ children }: { children: React.ReactNode }) =>
    React.createElement('ol', null, children),
  BreadcrumbItem: ({ children }: { children: React.ReactNode }) =>
    React.createElement('li', null, children),
  BreadcrumbLink: ({
    children,
    onClick,
  }: {
    children: React.ReactNode;
    onClick: () => void;
  }) =>
    React.createElement(
      'a',
      { 'data-testid': 'breadcrumb-link', onClick },
      children,
    ),
  BreadcrumbPage: ({ children }: { children: React.ReactNode }) =>
    React.createElement('span', { 'data-testid': 'breadcrumb-page' }, children),
  BreadcrumbSeparator: () =>
    React.createElement('span', { 'data-testid': 'breadcrumb-separator' }, '/'),
}));

vi.mock('@/components/ui/button', () => ({
  Button: (props: {
    children: React.ReactNode;
    onClick?: () => void;
    variant?: string;
    className?: string;
  }) =>
    React.createElement(
      'button',
      {
        'data-testid': `button-${String(props.children).slice(0, 20)}`,
        onClick: props.onClick,
        'data-variant': props.variant,
        className: props.className,
      },
      props.children,
    ),
}));

vi.mock('@/features/flows/components/flow-created-by-badge', () => ({
  FlowCreatedByBadge: () =>
    React.createElement('div', { 'data-testid': 'created-by-badge' }, 'badge'),
}));

vi.mock('../../components/flow-actions-menu', () => ({
  default: ({ children }: { children: React.ReactNode }) =>
    React.createElement('div', { 'data-testid': 'flow-action-menu' }, children),
}));

vi.mock('../flow-canvas/utils/consts', () => ({
  flowCanvasConsts: { BUILDER_HEADER_HEIGHT: 60 },
}));

vi.mock('./flow-status', () => ({
  BuilderFlowStatusSection: () =>
    React.createElement('div', { 'data-testid': 'flow-status' }, 'status'),
}));

import { BuilderHeader } from './builder-header';

describe('BuilderHeader MoraTea surface', () => {
  let container: HTMLDivElement | null = null;
  let root: Root | null = null;

  function mountHeader(): void {
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
    flushSync(() => {
      root!.render(React.createElement(BuilderHeader));
    });
  }

  function teardown(): void {
    flushSync(() => {
      root?.unmount();
    });
    container?.remove();
    root = null;
    container = null;
  }

  function readBodyText(): string {
    return document.body.textContent ?? '';
  }

  beforeEach(() => {
    mockApplyOperation.mockClear();
    mockSetRightSidebar.mockClear();
    mockMoveToFolder.mockClear();
    mockCheckAccess.mockReturnValue(true);
    mockInvalidateFlowsQuery.mockClear();
    mockHistoryBack.mockClear();
    mockUseSearchParams.mockReturnValue([
      new URLSearchParams(),
      vi.fn(),
    ] as unknown as [URLSearchParams, (p: URLSearchParams) => void]);
    vi.spyOn(window.history, 'back').mockImplementation(mockHistoryBack);
  });

  afterEach(() => {
    teardown();
    vi.restoreAllMocks();
    mockUseSearchParams.mockReset();
  });

  it('surface shows Back to MoraTea, flow name, Runs and hides project shell controls', () => {
    mockUseSearchParams.mockReturnValue([
      new URLSearchParams('surface=moratea'),
      vi.fn(),
    ] as unknown as [URLSearchParams, (p: URLSearchParams) => void]);
    mountHeader();

    const bodyText = readBodyText();
    expect(bodyText.includes('Back to MoraTea')).toBe(true);
    expect(document.querySelector('[data-testid="arrow-left"]') !== null).toBe(
      true,
    );

    expect(
      document.querySelector('[data-testid="editable-text"]') !== null,
    ).toBe(true);
    expect(readBodyText().includes('Test Flow')).toBe(true);

    expect(bodyText.includes('Runs')).toBe(true);
    expect(
      document.querySelector('[data-testid="history-icon"]') !== null,
    ).toBe(true);

    expect(
      document.querySelector('[data-testid="breadcrumb-link"]') === null,
    ).toBe(true);
    expect(readBodyText().includes('TestProject')).toBe(false);
    expect(
      document.querySelector('[data-testid="flow-action-menu"]') === null,
    ).toBe(true);
    expect(bodyText.includes('Support')).toBe(false);
    expect(document.querySelector('[data-testid="circle-help"]') === null).toBe(
      true,
    );
    expect(
      document.querySelector('[data-testid="active-users"]') === null,
    ).toBe(true);
    expect(document.querySelector('[data-testid="flow-status"]') === null).toBe(
      true,
    );
    expect(
      document.querySelector('[data-testid="created-by-badge"]') === null,
    ).toBe(true);
  });

  it('surface Back button calls window.history.back', () => {
    mockUseSearchParams.mockReturnValue([
      new URLSearchParams('surface=moratea'),
      vi.fn(),
    ] as unknown as [URLSearchParams, (p: URLSearchParams) => void]);
    mountHeader();

    const backButton = Array.from(document.querySelectorAll('button')).find(
      (b) => b.textContent?.includes('Back to MoraTea'),
    ) as HTMLButtonElement | undefined;
    expect((backButton !== undefined) === true).toBe(true);
    flushSync(() => {
      backButton!.click();
    });
    expect(mockHistoryBack).toHaveBeenCalledTimes(1);
  });

  it('surface EditableText edit triggers applyOperation with CHANGE_NAME and existing draft rules', () => {
    mockUseSearchParams.mockReturnValue([
      new URLSearchParams('surface=moratea'),
      vi.fn(),
    ] as unknown as [URLSearchParams, (p: URLSearchParams) => void]);
    mountHeader();

    const editButton = document.querySelector(
      '[data-testid="editable-edit"]',
    ) as HTMLButtonElement | null;
    expect((editButton !== null) === true).toBe(true);
    flushSync(() => {
      editButton!.click();
    });
    expect(mockApplyOperation).toHaveBeenCalledTimes(1);
    const firstArg = mockApplyOperation.mock.calls[0][0] as Record<
      string,
      unknown
    >;
    expect(firstArg.type === 'CHANGE_NAME').toBe(true);
    const request = firstArg.request as Record<string, unknown>;
    expect(request.displayName === 'Test Flow-edited').toBe(true);

    expect(
      document
        .querySelector('[data-testid="editable-text"]')
        ?.getAttribute('data-readonly') === 'false',
    ).toBe(true);
  });

  it('surface Runs button calls setRightSidebar', () => {
    mockUseSearchParams.mockReturnValue([
      new URLSearchParams('surface=moratea'),
      vi.fn(),
    ] as unknown as [URLSearchParams, (p: URLSearchParams) => void]);
    mountHeader();

    const runsButton = Array.from(document.querySelectorAll('button')).find(
      (b) => b.textContent?.includes('Runs'),
    ) as HTMLButtonElement | undefined;
    expect((runsButton !== undefined) === true).toBe(true);
    flushSync(() => {
      runsButton!.click();
    });
    expect(mockSetRightSidebar).toHaveBeenCalledWith('runs');
  });

  it('normal shows project breadcrumb, FlowActionMenu, Support, ActiveUsers, status, badge and no Back button', () => {
    mockUseSearchParams.mockReturnValue([
      new URLSearchParams(),
      vi.fn(),
    ] as unknown as [URLSearchParams, (p: URLSearchParams) => void]);
    mountHeader();

    const bodyText = readBodyText();
    expect(bodyText.includes('Back to MoraTea')).toBe(false);
    expect(document.querySelector('[data-testid="arrow-left"]') === null).toBe(
      true,
    );

    expect(
      document.querySelector('[data-testid="breadcrumb-link"]') !== null,
    ).toBe(true);
    expect(bodyText.includes('TestProject')).toBe(true);

    expect(
      document.querySelector('[data-testid="flow-action-menu"]') !== null,
    ).toBe(true);
    expect(
      document.querySelector('[data-testid="chevron-down"]') !== null,
    ).toBe(true);

    expect(
      document.querySelector('[data-testid="editable-text"]') !== null,
    ).toBe(true);

    expect(bodyText.includes('Support')).toBe(true);
    expect(document.querySelector('[data-testid="circle-help"]') !== null).toBe(
      true,
    );
    expect(
      document.querySelector('[data-testid="active-users"]') !== null,
    ).toBe(true);
    expect(bodyText.includes('Runs')).toBe(true);
    expect(document.querySelector('[data-testid="flow-status"]') !== null).toBe(
      true,
    );
    expect(
      document.querySelector('[data-testid="created-by-badge"]') !== null,
    ).toBe(true);
  });

  it('normal retains exact current UI with ghost Button, Breadcrumb, FlowActionMenu and right controls', () => {
    mockUseSearchParams.mockReturnValue([
      new URLSearchParams(),
      vi.fn(),
    ] as unknown as [URLSearchParams, (p: URLSearchParams) => void]);
    mountHeader();

    expect(document.querySelector('[data-testid="breadcrumb"]') !== null).toBe(
      true,
    );
    expect(
      document.querySelector('[data-testid="breadcrumb-page"]') !== null,
    ).toBe(true);
    expect(
      document.querySelector('[data-testid="breadcrumb-separator"]') !== null,
    ).toBe(true);
    expect(
      document.querySelectorAll('[data-testid="page-header"]').length === 1,
    ).toBe(true);
    expect(document.querySelector('[data-testid="page-title"]') !== null).toBe(
      true,
    );
    expect(document.querySelector('[data-testid="page-right"]') !== null).toBe(
      true,
    );
  });
});
