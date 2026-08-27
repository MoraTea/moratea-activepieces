// @vitest-environment jsdom

import {
  buildCurrentProjectRedirectPath,
  isMorateaEditorSurface,
  MORATEA_SURFACE_QUERY_PARAM,
  MORATEA_SURFACE_VALUE,
  useMorateaEditorSurface,
} from '../navigation-utils';
import { buildCurrentProjectRedirectPath as buildFromWrapper } from '../../app/guards/project-route-wrapper';

describe('isMorateaEditorSurface', () => {
  it('returns false when no surface param (normal)', () => {
    const params = new URLSearchParams();
    expect(isMorateaEditorSurface(params)).toBe(false);
  });

  it('returns true when exact surface=moratea', () => {
    const params = new URLSearchParams(`${MORATEA_SURFACE_QUERY_PARAM}=${MORATEA_SURFACE_VALUE}`);
    expect(isMorateaEditorSurface(params)).toBe(true);
  });

  it('returns false when other surface value', () => {
    const params = new URLSearchParams(`${MORATEA_SURFACE_QUERY_PARAM}=other`);
    expect(isMorateaEditorSurface(params)).toBe(false);
  });

  it('uses URLSearchParams.get semantics explicitly (duplicate handling)', () => {
    // get returns first value; duplicate not containing exact as first => false
    const duplicateOtherFirst = new URLSearchParams();
    duplicateOtherFirst.append(MORATEA_SURFACE_QUERY_PARAM, 'other');
    duplicateOtherFirst.append(MORATEA_SURFACE_QUERY_PARAM, MORATEA_SURFACE_VALUE);
    expect(duplicateOtherFirst.get(MORATEA_SURFACE_QUERY_PARAM)).toBe('other');
    expect(isMorateaEditorSurface(duplicateOtherFirst)).toBe(false);

    // moratea first => true (get returns moratea)
    const duplicateMorateaFirst = new URLSearchParams();
    duplicateMorateaFirst.append(MORATEA_SURFACE_QUERY_PARAM, MORATEA_SURFACE_VALUE);
    duplicateMorateaFirst.append(MORATEA_SURFACE_QUERY_PARAM, 'other');
    expect(duplicateMorateaFirst.get(MORATEA_SURFACE_QUERY_PARAM)).toBe(MORATEA_SURFACE_VALUE);
    expect(isMorateaEditorSurface(duplicateMorateaFirst)).toBe(true);

    // absent
    expect(new URLSearchParams('foo=bar').get(MORATEA_SURFACE_QUERY_PARAM)).toBeNull();
  });

  it('constants are correct', () => {
    expect(MORATEA_SURFACE_QUERY_PARAM).toBe('surface');
    expect(MORATEA_SURFACE_VALUE).toBe('moratea');
  });

  it('useMorateaEditorSurface hook is exported', () => {
    expect(typeof useMorateaEditorSurface).toBe('function');
  });
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
    const result = buildCurrentProjectRedirectPath(projectId, path, params, searchString);
    expect(result).toBe(`/projects/${projectId}/flows/abc-123?${searchString}`);
    expect(buildFromWrapper(projectId, path, params, searchString)).toBe(result);
  });

  it('preserves unrelated query order exact', () => {
    const searchParams = new URLSearchParams();
    searchParams.set('foo', '1');
    searchParams.set('surface', 'moratea');
    searchParams.set('bar', '2');
    const searchString = searchParams.toString();
    const result = buildCurrentProjectRedirectPath(projectId, path, params, searchString);
    expect(result).toBe(`/projects/${projectId}/flows/abc-123?${searchString}`);
    expect(buildFromWrapper(projectId, path, params, searchString)).toBe(result);
  });

  it('normal no query unchanged (no trailing ?)', () => {
    const searchString = new URLSearchParams().toString();
    expect(searchString).toBe('');
    const result = buildCurrentProjectRedirectPath(projectId, path, params, searchString);
    expect(result).toBe(`/projects/${projectId}/flows/abc-123`);
    expect(buildFromWrapper(projectId, path, params, searchString)).toBe(result);
  });

  it('replaces :flowId param and keeps prefix', () => {
    const searchString = new URLSearchParams('surface=moratea').toString();
    const result = buildCurrentProjectRedirectPath(projectId, '/flows/:flowId', { flowId: 'xyz' }, searchString);
    expect(result).toBe(`/projects/${projectId}/flows/xyz?surface=moratea`);
  });
});
