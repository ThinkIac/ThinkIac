// Normalize before authentication so the alias follows exactly the same gate.
export function normalizeViewAlias(req, _res, next) {
  if (/^\/v\//.test(req.url)) {
    req.url = `/view/${req.url.slice(3)}`;
    if (typeof req.originalUrl === 'string' && /^\/v\//.test(req.originalUrl)) {
      req.originalUrl = `/view/${req.originalUrl.slice(3)}`;
    }
  }
  next();
}
