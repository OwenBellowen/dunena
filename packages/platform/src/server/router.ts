// ── URL Router ─────────────────────────────────────────────
import type { HttpMethod, HandlerFn, RouteHandler } from "../types";

export class Router {
  private routes: RouteHandler[] = [];

  get(path: string, handler: HandlerFn) {
    this.routes.push({ method: "GET", path, handler });
  }
  post(path: string, handler: HandlerFn) {
    this.routes.push({ method: "POST", path, handler });
  }
  put(path: string, handler: HandlerFn) {
    this.routes.push({ method: "PUT", path, handler });
  }
  delete(path: string, handler: HandlerFn) {
    this.routes.push({ method: "DELETE", path, handler });
  }

  match(
    method: string,
    pathname: string
  ): { handler: HandlerFn; params: Record<string, string> } | null {
    for (const route of this.routes) {
      if (route.method !== method) continue;
      const params = matchPath(route.path, pathname);
      if (params !== null) return { handler: route.handler, params };
    }
    return null;
  }
}

function matchPath(
  pattern: string,
  path: string
): Record<string, string> | null {
  const pp = pattern.split("/").filter(Boolean);
  const tp = path.split("/").filter(Boolean);
  if (pp.length !== tp.length) return null;

  const params: Record<string, string> = {};
  for (let i = 0; i < pp.length; i++) {
    if (pp[i].startsWith(":")) {
      params[pp[i].slice(1)] = decodeURIComponent(tp[i]);
    } else if (pp[i] !== tp[i]) {
      return null;
    }
  }
  return params;
}
