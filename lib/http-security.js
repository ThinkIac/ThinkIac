// Origins use the same serialization as the browser's Origin header.
export function corsOptions(configuredOrigins = '') {
  const origins = configuredOrigins.split(',').map(value => value.trim()).filter(Boolean);
  for (const origin of origins) {
    const url = URL.parse(origin);
    if (origin.includes('*') || !url || !['http:', 'https:'].includes(url.protocol) || origin !== url.origin) {
      throw new Error('THINKIAC_CORS_ORIGINS must contain exact HTTP(S) origins, without paths or wildcards.');
    }
  }
  if (!origins.length) return false;
  return {
    origin: origins,
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization'],
  };
}

const loginContentSecurityPolicy = [
  "default-src 'self'",
  "base-uri 'none'",
  "object-src 'none'",
  "frame-ancestors 'self'",
  "form-action 'self'",
  // The Svelte renderer emits inline hydration scripts and these two CDN scripts.
  "script-src 'self' 'unsafe-inline' https://cdn.jsdelivr.net/npm/@tailwindcss/browser@4 https://cdn.jsdelivr.net/npm/katex@0.16.9/dist/katex.min.js",
  "script-src-attr 'none'",
  "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com https://cdn.jsdelivr.net https://cdnjs.cloudflare.com",
  "font-src 'self' https://fonts.gstatic.com https://cdn.jsdelivr.net https://cdnjs.cloudflare.com",
  "img-src 'self' data:",
].join('; ');

export function setSecurityHeaders(req, res, next) {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');

  let path = req.path;
  try {
    path = decodeURI(path);
  } catch {
    // Leave malformed URL handling to the router.
  }
  if (/^\/view\/auth\/Login\/?$/i.test(path)) {
    res.setHeader('Content-Security-Policy', loginContentSecurityPolicy);
  }
  next();
}
