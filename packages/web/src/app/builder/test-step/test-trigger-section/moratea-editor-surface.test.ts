// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';

import { shouldHideMorateaChatTesting } from '@/app/builder/test-step/test-runner-context';

describe('MoraTea chat trigger testing predicate', () => {
  it('hides only chat testing on the MoraTea surface', () => {
    expect(
      shouldHideMorateaChatTesting({
        isMorateaSurface: true,
        testType: 'chat-trigger',
      }),
    ).toBe(true);
    expect(
      shouldHideMorateaChatTesting({
        isMorateaSurface: false,
        testType: 'chat-trigger',
      }),
    ).toBe(false);
    expect(
      shouldHideMorateaChatTesting({
        isMorateaSurface: true,
        testType: 'simulation',
      }),
    ).toBe(false);
    expect(
      shouldHideMorateaChatTesting({
        isMorateaSurface: true,
        testType: null,
      }),
    ).toBe(false);
  });
});
