import { describe, expect, test } from 'vitest';
import { commandWithMarker, outputFromMarker } from './desktop-control.js';

describe('protocolo Desktop Control do Terminal', () => {
  test('anexa um marcador único depois do comando para confirmar o término', () => {
    expect(commandWithMarker('ls', 'request-42')).toBe(
      'ls\nprintf \'\\n__THINKIAC_DESKTOP_DONE_request-42__:%s\\n\' "$?"\n',
    );
  });

  test('separa a saída real, o código de saída e o marcador interno', () => {
    expect(outputFromMarker('ls\r\nfile.txt\r\n__THINKIAC_DESKTOP_DONE_request-42__:0\r\n', 'request-42')).toEqual({
      output: 'ls\nfile.txt',
      exitCode: 0,
    });
  });

  test('não conclui quando a saída ainda não contém o marcador da requisição', () => {
    expect(outputFromMarker('ls\r\nfile.txt\r\n', 'request-42')).toBeNull();
  });
});
