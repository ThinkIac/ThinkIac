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

/** Keep the Shell API stable when its backend is installed as a nested package. */
export function profileShellCompatibility({ shell, nestedRuntime, desktop }) {
  return (req, res, next) => {
    if (nestedRuntime && /^\/shell\/apps\/(?:list|availability)(?:\?|$)/.test(req.url)) {
      req.url = '/shell/runtime' + req.url.slice('/shell'.length);
    }
    if (shell && !desktop && req.method === 'GET' && req.path === '/redirect/home') {
      const redirect = res.redirect;
      res.redirect = function (...args) {
        if (args.at(-1) === '/view/desktop/Index') args[args.length - 1] = '/view/shell/Index';
        return redirect.apply(this, args);
      };
    }
    next();
  };
}
