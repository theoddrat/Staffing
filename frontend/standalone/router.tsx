/**
 * The standalone build's router: picks the page for the in-memory location (see location.ts), the way the
 * Next.js App Router picks src/app/**\/page.tsx for a URL.
 */
import { Component, useLayoutEffect, useMemo, type ComponentType, type ReactNode } from "react";
import Curriculum from "@/app/learn/page";
import DictionaryPage from "@/app/dictionary/page";
import Home from "@/app/page";
import LessonPage from "@/app/learn/[lessonId]/page";
import MapPage from "@/app/map/page";
import Playground from "@/app/playground/page";
import Practice from "@/app/practice/page";
import ProgressPage from "@/app/progress/page";
import Research from "@/app/research/page";
import Settings from "@/app/settings/page";
import TermPage from "@/app/dictionary/[termId]/page";
import Tutor from "@/app/tutor/page";
import { ParamsContext, RouteSignal, getLocation, navigate, scrollToFragment, scrollToTop, useLocation } from "./location";
import Link from "./shims/next-link";

type Route = { pattern: RegExp; params: string[]; page: ComponentType };

/** Every page of src/app. `[param]` segments match one path segment (no slashes). */
const ROUTES: Route[] = [
  { pattern: /^\/$/, params: [], page: Home },
  { pattern: /^\/learn$/, params: [], page: Curriculum },
  { pattern: /^\/learn\/([^/]+)$/, params: ["lessonId"], page: LessonPage },
  { pattern: /^\/dictionary$/, params: [], page: DictionaryPage },
  { pattern: /^\/dictionary\/([^/]+)$/, params: ["termId"], page: TermPage },
  { pattern: /^\/map$/, params: [], page: MapPage },
  { pattern: /^\/playground$/, params: [], page: Playground },
  { pattern: /^\/practice$/, params: [], page: Practice },
  { pattern: /^\/tutor$/, params: [], page: Tutor },
  { pattern: /^\/progress$/, params: [], page: ProgressPage },
  { pattern: /^\/research$/, params: [], page: Research },
  { pattern: /^\/settings$/, params: [], page: Settings },
];

function matchRoute(pathname: string): { page: ComponentType | null; params: Record<string, string> } {
  const path = pathname.length > 1 ? pathname.replace(/\/+$/, "") : pathname;
  for (const r of ROUTES) {
    const m = r.pattern.exec(path);
    if (!m) continue;
    try {
      return { page: r.page, params: Object.fromEntries(r.params.map((name, i) => [name, decodeURIComponent(m[i + 1])])) };
    } catch {
      break; // a malformed %-escape: no such page
    }
  }
  return { page: null, params: {} };
}

function NotFound({ path }: { path: string }) {
  return (
    <div className="mx-auto max-w-xl space-y-3 py-10 text-center">
      <p className="text-sm font-semibold tracking-wide text-accent uppercase">Page not found</p>
      <h1 className="font-serif text-3xl font-semibold">There is nothing here</h1>
      <p className="text-ink-2">
        There is no page called <code className="break-all">{path}</code> in The Mathematical Universe.
      </p>
      <Link href="/" className="inline-flex items-center rounded-lg bg-accent px-4 py-2.5 font-medium text-accent-ink">
        Go to the home page
      </Link>
    </div>
  );
}

/** Catches notFound()/redirect() from a page, and keeps a crashing page from blanking the whole app. */
class PageBoundary extends Component<{ path: string; children: ReactNode }, { error: unknown }> {
  state = { error: null as unknown };

  static getDerivedStateFromError(error: unknown) {
    return { error };
  }

  componentDidCatch(error: unknown) {
    if (error instanceof RouteSignal && error.kind === "redirect") navigate(error.href, { replace: true });
    else if (!(error instanceof RouteSignal)) console.error(error);
  }

  render() {
    const { error } = this.state;
    if (!error) return this.props.children;
    if (error instanceof RouteSignal) return error.kind === "not-found" ? <NotFound path={this.props.path} /> : null;
    return (
      <div className="mx-auto max-w-xl space-y-3 py-10" role="alert">
        <h1 className="font-serif text-2xl font-semibold">Something went wrong on this page</h1>
        <p className="rounded-lg border border-bad/40 bg-bad-soft p-3 text-sm text-bad">{error instanceof Error ? error.message : String(error)}</p>
        <p className="text-ink-2">Your progress is safe. Try another page, or reload.</p>
        <Link href="/" className="text-accent hover:underline">Go to the home page</Link>
      </div>
    );
  }
}

/** The current page. Each path gets a fresh page instance; a change of query alone keeps it (as in Next.js). */
export function RouterView() {
  const loc = useLocation();
  const { page: Page, params } = useMemo(() => matchRoute(loc.pathname), [loc.pathname]);

  // After a navigation: scroll to the fragment's element (once it renders) or to the top.
  useLayoutEffect(() => {
    const now = getLocation();
    if (now.fragment) scrollToFragment(now.fragment);
    else if (now.key > 0 && now.scroll) scrollToTop();
  }, [loc.key]);

  return (
    <ParamsContext.Provider value={params}>
      <PageBoundary key={loc.pathname} path={loc.pathname}>
        {Page ? <Page /> : <NotFound path={loc.pathname} />}
      </PageBoundary>
    </ParamsContext.Provider>
  );
}
