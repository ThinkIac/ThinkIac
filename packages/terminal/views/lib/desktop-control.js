export function markerFor(requestId) {
  return `__THINKIAC_DESKTOP_DONE_${requestId}__`;
}

export function commandWithMarker(command, requestId) {
  const marker = markerFor(requestId);
  return `${command}\nprintf '\\n${marker}:%s\\n' "$?"\n`;
}

export function outputFromMarker(value, requestId) {
  const marker = markerFor(requestId);
  const text = String(value || '').replace(/\r/g, '');
  const match = text.match(new RegExp(`(?:^|\\n)${marker}:(-?\\d+)(?:\\n|$)`));
  if (!match || match.index == null) return null;
  const before = text.slice(0, match.index).replace(/\n$/, '');
  return { output: before, exitCode: Number(match[1]) };
}
