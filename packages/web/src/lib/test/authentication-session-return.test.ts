// @vitest-environment node

import { describe, expect, it, vi } from 'vitest';

vi.mock('@/app/query-client', () => ({
  queryClient: { invalidateQueries: vi.fn() },
}));

import {
  authenticationSession,
  normalizeInternalReturnPath,
} from '../authentication-session';

const internalReturnPath = '/flows/flow-1?surface=moratea&tab=runs';

describe('normalizeInternalReturnPath', () => {
  it('preserves an exact internal path and query', () => {
    expect(normalizeInternalReturnPath(internalReturnPath)).toBe(
      internalReturnPath,
    );
  });

  it.each([
    ['protocol-relative', '//attacker.example/steal'],
    ['absolute HTTP', 'http://attacker.example/steal'],
    ['absolute HTTPS', 'https://attacker.example/steal'],
    ['backslash-normalized', '/\\attacker.example/steal'],
    ['control-normalized', '/\t/attacker.example/steal'],
  ])('falls back to root for a %s external URL', (_kind, from) => {
    expect(normalizeInternalReturnPath(from)).toBe('/');
  });
});

describe('authenticationSession.getSignInUrl', () => {
  it('encodes the exact internal return path in the sign-in URL', () => {
    expect(authenticationSession.getSignInUrl(internalReturnPath)).toBe(
      '/sign-in?from=%2Fflows%2Fflow-1%3Fsurface%3Dmoratea%26tab%3Druns',
    );
  });

  it.each(['//attacker.example/steal', 'https://attacker.example/steal'])(
    'encodes the root fallback for an unsafe return URL: %s',
    (from) => {
      expect(authenticationSession.getSignInUrl(from)).toBe(
        '/sign-in?from=%2F',
      );
    },
  );
});
