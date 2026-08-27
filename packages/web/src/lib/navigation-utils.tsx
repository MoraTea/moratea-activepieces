import { useNavigate, useSearchParams } from 'react-router-dom';

import { useEmbedding } from '@/components/providers/embed-provider';

export const useNewWindow = () => {
  const { embedState } = useEmbedding();
  const navigate = useNavigate();
  if (embedState.isEmbedded) {
    return (route: string, searchParams?: string) =>
      navigate({
        pathname: route,
        search: searchParams,
      });
  } else {
    return (route: string, searchParams?: string) =>
      window.open(
        `${route}${searchParams ? '?' + searchParams : ''}`,
        '_blank',
        'noopener noreferrer',
      );
  }
};

export const FROM_QUERY_PARAM = 'from';
/**State param is for oauth2 flow, it is used to redirect to the page after login*/
export const STATE_QUERY_PARAM = 'state';
export const LOGIN_QUERY_PARAM = 'activepiecesLogin';
export const PROVIDER_NAME_QUERY_PARAM = 'providerName';

export const MORATEA_SURFACE_QUERY_PARAM = 'surface';
export const MORATEA_SURFACE_VALUE = 'moratea';

export const isMorateaEditorSurface = (
  searchParams: URLSearchParams,
): boolean => {
  return (
    searchParams.get(MORATEA_SURFACE_QUERY_PARAM) === MORATEA_SURFACE_VALUE
  );
};

export const withMorateaEditorSurface = (
  path: string,
  isMorateaSurface: boolean,
): string => {
  if (!isMorateaSurface) {
    return path;
  }

  const fragmentStart = path.indexOf('#');
  const pathWithoutFragment =
    fragmentStart === -1 ? path : path.slice(0, fragmentStart);
  const fragment = fragmentStart === -1 ? '' : path.slice(fragmentStart);
  const queryStart = pathWithoutFragment.indexOf('?');
  const pathname =
    queryStart === -1
      ? pathWithoutFragment
      : pathWithoutFragment.slice(0, queryStart);
  const searchParams = new URLSearchParams(
    queryStart === -1 ? '' : pathWithoutFragment.slice(queryStart + 1),
  );
  searchParams.set(MORATEA_SURFACE_QUERY_PARAM, MORATEA_SURFACE_VALUE);

  return `${pathname}?${searchParams.toString()}${fragment}`;
};

export const morateaEditorNavigationOptions = (
  isSurface: boolean,
): { replace: true } | undefined => {
  return isSurface ? { replace: true } : undefined;
};

export const isMorateaEditorSurfaceReturnPath = (path: string): boolean => {
  const pathWithoutFragment = path.split('#', 1)[0];
  const queryStart = pathWithoutFragment.indexOf('?');
  if (queryStart === -1) {
    return false;
  }

  return isMorateaEditorSurface(
    new URLSearchParams(pathWithoutFragment.slice(queryStart + 1)),
  );
};

export const useMorateaEditorSurface = (): boolean => {
  const [searchParams] = useSearchParams();
  return isMorateaEditorSurface(searchParams);
};

export const buildCurrentProjectRedirectPath = (
  currentProjectId: string,
  path: string,
  params: Record<string, string | undefined>,
  searchParamsString: string,
): string => {
  const normalizedPath = path.startsWith('/') ? path : `/${path}`;
  const pathWithParams = normalizedPath.replace(
    /:(\w+)/g,
    (_, param) => params[param] ?? '',
  );
  const suffix = searchParamsString ? `?${searchParamsString}` : '';
  return `/projects/${currentProjectId}${pathWithParams}${suffix}`;
};

export const useDefaultRedirectPath = () => {
  return '/';
};

export const useRedirectAfterLogin = () => {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const defaultRedirectPath = useDefaultRedirectPath();
  const from = searchParams.get(FROM_QUERY_PARAM) ?? defaultRedirectPath;
  return () =>
    isMorateaEditorSurfaceReturnPath(from)
      ? navigate(from, { replace: true })
      : navigate(from);
};
