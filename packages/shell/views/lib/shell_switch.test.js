import { describe, expect, test } from 'vitest';
import { hasDesktopPackage, resolveDesktopAvailability } from './shell_switch.js';

describe('Shell/Desktop switch', () => {
  test('detects Desktop from the package identity', () => {
    expect(hasDesktopPackage([{ packageName: 'desktop', url: '/view/desktop/Index' }])).toBe(true);
  });

  test('detects Desktop from its canonical view URL', () => {
    expect(hasDesktopPackage([{ packageName: 'workspace', url: '/view/desktop/Index' }])).toBe(true);
  });

  test('stays hidden for missing or malformed catalogs', () => {
    expect(hasDesktopPackage([])).toBe(false);
    expect(hasDesktopPackage(null)).toBe(false);
    expect(hasDesktopPackage([{ packageName: 'shell', url: '/view/shell/Index' }])).toBe(false);
  });

  test('keeps the last known availability during a transient catalog failure', () => {
    expect(resolveDesktopAvailability(null, true)).toBe(true);
    expect(resolveDesktopAvailability(null, false)).toBe(false);
    expect(resolveDesktopAvailability([{ packageName: 'desktop' }], false)).toBe(true);
  });
});
