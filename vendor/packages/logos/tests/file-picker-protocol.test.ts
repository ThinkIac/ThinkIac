import { describe, expect, it } from 'vitest';
import { filePickerProtocolClientScript } from '../../modules/svelte';

describe('browser file-picker protocol', () => {
  it('offers an optional cancellable provider contract and preserves native fallback', () => {
    const script = filePickerProtocolClientScript();
    expect(script).toContain('logos:file-picker:request');
    expect(script).toContain('cancelable: true');
    expect(script).toContain('event.preventDefault()');
    expect(script).toContain('data-logos-native-file-picker');
    expect(script).toContain('window.LogosFilePicker');
  });
});
