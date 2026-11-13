import { describe, expect, test } from 'vitest';
import { isHostedByDesktop } from './desktop-host.js';

describe('composição do Shell no Desktop', () => {
  test('encontra a marca do Desktop em um ancestral same-origin', () => {
    const desktop = { __thinkiacDesktop: true };
    desktop.parent = desktop;
    const shell = { parent: desktop };
    expect(isHostedByDesktop(shell)).toBe(true);
  });

  test('não classifica o Shell aberto diretamente como hospedado', () => {
    const top = {};
    top.parent = top;
    expect(isHostedByDesktop(top)).toBe(false);
  });
});
