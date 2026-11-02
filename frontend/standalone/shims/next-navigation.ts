/**
 * `next/navigation` for the standalone build (esbuild aliases the import here), backed by the in-memory
 * location in ../location.ts.
 */
import { useContext, useMemo } from "react";
import { ParamsContext, RouteSignal, navigate, useLocation } from "../location";

type Opts = { scroll?: boolean };

const router = {
  push: (href: string, opts?: Opts) => navigate(href, { scroll: opts?.scroll }),
  replace: (href: string, opts?: Opts) => navigate(href, { replace: true, scroll: opts?.scroll }),
  back: () => window.history.back(),
  forward: () => window.history.forward(),
  /** Next.js re-fetches server components; every page here is a client component, so there is nothing to do. */
  refresh: () => {},
  prefetch: (href: string) => void href,
};

export type AppRouterInstance = typeof router;

export function useRouter(): AppRouterInstance {
  return router;
}

export function usePathname(): string {
  return useLocation().pathname;
}

export type ReadonlyURLSearchParams = Omit<URLSearchParams, "append" | "delete" | "set" | "sort">;

export function useSearchParams(): ReadonlyURLSearchParams {
  const { search } = useLocation();
  return useMemo(() => new URLSearchParams(search), [search]);
}

export function useParams<T extends Record<string, string | string[]> = Record<string, string | string[]>>(): T {
  return useContext(ParamsContext) as T;
}

export function notFound(): never {
  throw new RouteSignal("not-found");
}

export function redirect(href: string): never {
  throw new RouteSignal("redirect", href);
}

export const permanentRedirect = redirect;
