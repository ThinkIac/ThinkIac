const DESKTOP_FLAG = '__thinkiacDesktop';

/** True when the Shell runs in a same-origin iframe owned by Desktop. */
export function isHostedByDesktop(win) {
  if (!win) return false;
  try {
    let frame = win.parent;
    while (frame && frame !== win) {
      if (frame[DESKTOP_FLAG]) return true;
      if (frame === frame.parent) break;
      frame = frame.parent;
    }
  } catch {
    // A cross-origin ancestor cannot be a Desktop instance we control.
  }
  return false;
}
