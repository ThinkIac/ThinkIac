const FILE_PICKER_REQUEST = 'logos:file-picker:request';
const FILE_PICKER_SELECTED = 'logos:file-picker:selected';
const FILE_PICKER_CANCELLED = 'logos:file-picker:cancelled';

// This is deliberately plain browser JavaScript. It is injected through the
// Lógos protocol, so File Manager remains an optional provider and the runtime
// never needs to import a package view.
export function filePickerProviderClientScript() {
  return `<script>
(function () {
  if (window.__fileManagerPickerProvider) return;
  window.__fileManagerPickerProvider = true;
  var REQUEST = ${JSON.stringify(FILE_PICKER_REQUEST)};
  var SELECTED = ${JSON.stringify(FILE_PICKER_SELECTED)};
  var CANCELLED = ${JSON.stringify(FILE_PICKER_CANCELLED)};
  var active = null;

  function close() {
    if (!active) return;
    window.removeEventListener('message', active.onMessage);
    active.frame.remove();
    active = null;
  }
  function safeName(path) { return String(path || '').split('/').pop() || 'file'; }
  async function assign(input, paths) {
    var transfer = new DataTransfer();
    for (var i = 0; i < paths.length; i++) {
      var response = await fetch('/file-manager/raw?path=' + encodeURIComponent(paths[i]));
      if (!response.ok) throw new Error('Could not read selected file');
      var blob = await response.blob();
      transfer.items.add(new File([blob], safeName(paths[i]), { type: blob.type }));
    }
    input.files = transfer.files;
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.dispatchEvent(new Event('change', { bubbles: true }));
  }
  function open(event) {
    var detail = event.detail || {};
    var input = detail.input;
    if (!input || active) return;
    event.preventDefault();
    var requestId = 'fm-' + Date.now() + '-' + Math.random().toString(36).slice(2);
    var params = new URLSearchParams({ requestId: requestId, accept: detail.accept || '' });
    if (detail.multiple) params.set('multiple', '1');
    if (detail.root) params.set('root', detail.root);
    var frame = document.createElement('iframe');
    frame.src = '/view/file-manager/Picker?' + params.toString();
    frame.title = 'File picker';
    frame.setAttribute('aria-label', 'File picker');
    frame.style.cssText = 'position:fixed;inset:0;width:100%;height:100%;border:0;z-index:2147483646;background:transparent';
    var onMessage = function (message) {
      if (message.origin !== window.location.origin || message.source !== frame.contentWindow) return;
      var data = message.data || {};
      if (data.requestId !== requestId) return;
      if (data.type === CANCELLED) return close();
      if (data.type !== SELECTED || !Array.isArray(data.paths)) return;
      close();
      assign(input, data.paths).catch(function () {
        // A failed conversion must not manufacture a change event or discard
        // the existing value. The user can simply open the picker again.
      });
    };
    active = { frame: frame, onMessage: onMessage };
    window.addEventListener('message', onMessage);
    document.body.appendChild(frame);
  }
  document.addEventListener(REQUEST, open);
})();
</script>`;
}

export function injectFilePickerProvider(payload) {
  /**
   * @register_hook views:render
   * @description Supplies File Manager as the optional provider for the Lógos browser file-picker protocol.
   */
  if (!payload || !Array.isArray(payload.clientScripts)) return payload;
  payload.clientScripts.push(filePickerProviderClientScript());
  return payload;
}

export { FILE_PICKER_REQUEST, FILE_PICKER_SELECTED, FILE_PICKER_CANCELLED };
