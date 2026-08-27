// @vitest-environment jsdom

import * as React from 'react';
import { flushSync } from 'react-dom';
import { createRoot } from 'react-dom/client';

const { mockNavigate, mockUseSearchParams } = vi.hoisted(() => ({
  mockNavigate: vi.fn(),
  mockUseSearchParams: vi.fn(() => [new URLSearchParams(), vi.fn()]),
}));

vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual('react-router-dom');
  return {
    ...(actual as Record<string, unknown>),
    useNavigate: () => mockNavigate,
    useSearchParams: () => mockUseSearchParams(),
  };
});

import {
  buildCurrentProjectRedirectPath,
  FROM_QUERY_PARAM,
  isMorateaEditorSurface,
  isMorateaEditorSurfaceReturnPath,
  MORATEA_SURFACE_QUERY_PARAM,
  MORATEA_SURFACE_VALUE,
  useMorateaEditorSurface,
  useRedirectAfterLogin,
} from '../navigation-utils';

describe('isMorateaEditorSurface', () => {
  it('returns false when no surface param (normal)', () => {
    const params = new URLSearchParams();
    expect(isMorateaEditorSurface(params)).toBe(false);
  });

  it('returns true when exact surface=moratea', () => {
    const params = new URLSearchParams(
      `${MORATEA_SURFACE_QUERY_PARAM}=${MORATEA_SURFACE_VALUE}`,
    );
    expect(isMorateaEditorSurface(params)).toBe(true);
  });

  it('returns false when other surface value', () => {
    const params = new URLSearchParams(`${MORATEA_SURFACE_QUERY_PARAM}=other`);
    expect(isMorateaEditorSurface(params)).toBe(false);
  });

  it('uses URLSearchParams.get semantics explicitly (duplicate handling)', () => {
    const duplicateOtherFirst = new URLSearchParams();
    duplicateOtherFirst.append(MORATEA_SURFACE_QUERY_PARAM, 'other');
    duplicateOtherFirst.append(
      MORATEA_SURFACE_QUERY_PARAM,
      MORATEA_SURFACE_VALUE,
    );
    expect(duplicateOtherFirst.get(MORATEA_SURFACE_QUERY_PARAM)).toBe('other');
    expect(isMorateaEditorSurface(duplicateOtherFirst)).toBe(false);

    const duplicateMorateaFirst = new URLSearchParams();
    duplicateMorateaFirst.append(
      MORATEA_SURFACE_QUERY_PARAM,
      MORATEA_SURFACE_VALUE,
    );
    duplicateMorateaFirst.append(MORATEA_SURFACE_QUERY_PARAM, 'other');
    expect(duplicateMorateaFirst.get(MORATEA_SURFACE_QUERY_PARAM)).toBe(
      MORATEA_SURFACE_VALUE,
    );
    expect(isMorateaEditorSurface(duplicateMorateaFirst)).toBe(true);

    expect(
      new URLSearchParams('foo=bar').get(MORATEA_SURFACE_QUERY_PARAM),
    ).toBeNull();
  });

  it('constants are correct', () => {
    expect(MORATEA_SURFACE_QUERY_PARAM).toBe('surface');
    expect(MORATEA_SURFACE_VALUE).toBe('moratea');
  });

  it('useMorateaEditorSurface hook is exported', () => {
    expect(typeof useMorateaEditorSurface).toBe('function');
  });
});
describe('isMorateaEditorSurfaceReturnPath', () => {
  it('detects only exact surface=moratea in the return path query', () => {
    expect(
      isMorateaEditorSurfaceReturnPath(
        '/projects/proj-123/flows/flow-123?foo=bar&surface=moratea#builder',
      ),
    ).toBe(true);
    expect(
      isMorateaEditorSurfaceReturnPath(
        '/projects/proj-123/flows/flow-123?surface=Moratea',
      ),
    ).toBe(false);
    expect(
      isMorateaEditorSurfaceReturnPath(
        '/projects/proj-123/flows/flow-123?surface=moratea-editor',
      ),
    ).toBe(false);
    expect(
      isMorateaEditorSurfaceReturnPath(
        '/projects/proj-123/flows/flow-123/surface=moratea',
      ),
    ).toBe(false);
  });

  it('retains first-value URLSearchParams semantics', () => {
    expect(
      isMorateaEditorSurfaceReturnPath(
        '/projects/proj-123/flows/flow-123?surface=other&surface=moratea',
      ),
    ).toBe(false);
    expect(
      isMorateaEditorSurfaceReturnPath(
        '/projects/proj-123/flows/flow-123?surface=moratea&surface=other',
      ),
    ).toBe(true);
  });
});

describe('useRedirectAfterLogin', () => {
  function invokeRedirect(from?: string): void {
    const searchParams = new URLSearchParams();
    if (from) {
      searchParams.set(FROM_QUERY_PARAM, from);
    }
    mockUseSearchParams.mockReturnValue([searchParams, vi.fn()]);

    const container = document.createElement('div');
    const root = createRoot(container);
    flushSync(() => {
      root.render(
        React.createElement(() => {
          const redirect = useRedirectAfterLogin();
          return React.createElement(
            'button',
            { onClick: redirect },
            'redirect',
          );
        }),
      );
    });
    flushSync(() => {
      container.querySelector('button')!.click();
      root.unmount();
    });
  }

  beforeEach(() => {
    mockNavigate.mockReset();
    mockUseSearchParams.mockReset();
  });

  it('replaces login history for an exact MoraTea return path', () => {
    const from = '/projects/proj-123/flows/flow-123?foo=bar&surface=moratea';
    invokeRedirect(from);

    expect(mockNavigate.mock.calls).toEqual([[from, { replace: true }]]);
  });

  it('retains normal navigation for every other return path', () => {
    const from = '/projects/proj-123/flows/flow-123?surface=other';
    invokeRedirect(from);

    expect(mockNavigate.mock.calls).toEqual([[from]]);
  });

  it('retains the default redirect when no from path is supplied', () => {
    invokeRedirect();

    expect(mockNavigate.mock.calls).toEqual([['/']]);
  });

  it.each(['//attacker.example/steal', 'https://attacker.example/steal'])(
    'falls back to root for an unsafe return path: %s',
    (from) => {
      invokeRedirect(from);

      expect(mockNavigate.mock.calls).toEqual([['/']]);
    },
  );
});

describe('buildCurrentProjectRedirectPath', () => {
  const projectId = 'proj-123';
  const path = '/flows/:flowId';
  const params = { flowId: 'abc-123' };

  it('preserves surface=moratea and unrelated query via searchParams.toString() exact', () => {
    const searchParams = new URLSearchParams({
      surface: 'moratea',
      foo: 'bar',
    });
    const searchString = searchParams.toString();
    const result = buildCurrentProjectRedirectPath(
      projectId,
      path,
      params,
      searchString,
    );
    expect(result).toBe(`/projects/${projectId}/flows/abc-123?${searchString}`);
  });

  it('preserves unrelated query order exact', () => {
    const searchParams = new URLSearchParams();
    searchParams.set('foo', '1');
    searchParams.set('surface', 'moratea');
    searchParams.set('bar', '2');
    const searchString = searchParams.toString();
    const result = buildCurrentProjectRedirectPath(
      projectId,
      path,
      params,
      searchString,
    );
    expect(result).toBe(`/projects/${projectId}/flows/abc-123?${searchString}`);
  });

  it('normal no query unchanged (no trailing ?)', () => {
    const searchString = new URLSearchParams().toString();
    expect(searchString).toBe('');
    const result = buildCurrentProjectRedirectPath(
      projectId,
      path,
      params,
      searchString,
    );
    expect(result).toBe(`/projects/${projectId}/flows/abc-123`);
  });

  it('replaces :flowId param and keeps prefix', () => {
    const searchString = new URLSearchParams('surface=moratea').toString();
    const result = buildCurrentProjectRedirectPath(
      projectId,
      '/flows/:flowId',
      { flowId: 'xyz' },
      searchString,
    );
    expect(result).toBe(`/projects/${projectId}/flows/xyz?surface=moratea`);
  });
});
