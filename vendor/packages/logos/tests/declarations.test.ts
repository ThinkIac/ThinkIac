import { describe, expect, it } from 'vitest';
import { parseDeclarations } from '../src/kernel/declarations';

describe('generic registration declarations', () => {
  it('preserves arbitrary types and repeated metadata as JSON', () => {
    const [declaration] = parseDeclarations('\n * @register fulano abc\n * @option first value\n * @option second value\n * @enabled\n ');
    expect(JSON.parse(JSON.stringify(declaration))).toEqual({
      type: 'fulano', name: 'abc', legacy: false,
      tags: { register: ['fulano abc'], option: ['first value', 'second value'], enabled: [''] },
    });
  });

  it('recognizes names on separate lines and legacy declarations', () => {
    expect(parseDeclarations('* @register router\n * @name /abc')[0]).toMatchObject({ type: 'router', name: '/abc', legacy: false });
    expect(parseDeclarations('* @register_hook example:event')[0]).toMatchObject({ type: 'hook', name: 'example:event', legacy: true });
  });
});
