/**
 * The standalone build's location: the current app path (+ query + fragment) kept in memory, and reflected into
 * `location.hash` so the artifact URL can link to a page and a reload stays on it.
 *
 * Only a plain `#name` (letters, digits, hyphens) passes between an artifact's URL and its page, so a route is
 * written as `v-<segments joined by "--">`, query pairs appended as `--key--value`:
 *
 *   /                          #v-home
 *   /learn/l1-prime-numbers    #v-learn--l1-prime-numbers
 *   /map?target=pa-research    #v-map--target--pa-research
 *
 * Any other hash (a lesson's in-page anchors such as #assessment, the platform's own names) is not a route and
 * is ignored. A path that cannot be written this way still works; it just leaves the hash as it was.
 */
import { createContext, useSyncExternalStore } from "react";

export type AppLocation = {
  pathname: string;
  /** "" or "?a=b" */
  search: string;
  /** the element id to scroll to, without "#" ("" for none) */
  fragment: string;
  /** increases on every navigation (0 for the first page) */
  key: number;
  /** scroll to the top (or to the fragment) once the page has rendered */
  scroll: boolean;
};

const PREFIX = "v-";
const SEP = "--";
const TOKEN = /^[A-Za-z0-9]+(?:-[A-Za-z0-9]+)*$/;
/** Routes whose second segment is an id (`/learn/[lessonId]`, `/dictionary/[termId]`; see router.tsx). */
const ID_ROUTES = new Set(["learn", "dictionary"]);

/** The hash name for a path, or null when it cannot be written as one. */
export function toHashName(pathname: string, search = ""): string | null {
  const segs = pathname.split("/").filter(Boolean);
  const tokens = segs.length ? segs : ["home"];
  for (const [k, v] of new URLSearchParams(search)) tokens.push(k, v);
  return tokens.every((t) => TOKEN.test(t)) ? PREFIX + tokens.join(SEP) : null;
}

function decode(s: string): string | null {
  try {
    return decodeURIComponent(s);
  } catch {
    return null;
  }
}

/** The path a hash names, or null when the hash is not a route. */
export function fromHashName(hash: string): { pathname: string; search: string } | null {
  const name = decode(hash.replace(/^#/, ""));
  if (!name?.startsWith(PREFIX)) return null;
  const tokens = name.slice(PREFIX.length).split(SEP);
  if (!tokens.every((t) => TOKEN.test(t))) return null;
  const [first, ...rest] = tokens;
  const segs = first === "home" ? [] : [first];
  if (ID_ROUTES.has(first) && rest.length % 2 === 1) segs.push(rest.shift()!);
  if (rest.length % 2 === 1) segs.push(...rest.splice(0)); // not key/value pairs: an (unknown) longer path
  const query = new URLSearchParams();
  for (let i = 0; i < rest.length; i += 2) query.append(rest[i], rest[i + 1]);
  const qs = query.toString();
  return { pathname: `/${segs.join("/")}`, search: qs ? `?${qs}` : "" };
}

/** Resolve an app href ("/learn/x?y=1#z", "?y=1", "#z") against the current location; null for external URLs. */
export function resolveHref(href: string, from: Pick<AppLocation, "pathname" | "search">) {
  if (/^[a-z][a-z0-9+.-]*:/i.test(href) || href.startsWith("//")) return null;
  const url = new URL(href, `http://app${from.pathname}${from.search}`);
  return { pathname: url.pathname, search: url.search, fragment: decode(url.hash.slice(1)) ?? "" };
}

// ---------------------------------------------------------------------------------------------- the store

function initial(): AppLocation {
  const fromHash = typeof window === "undefined" ? null : fromHashName(window.location.hash);
  return { ...(fromHash ?? { pathname: "/", search: "" }), fragment: "", key: 0, scroll: false };
}

let current: AppLocation = initial();
const listeners = new Set<() => void>();
let started = false;

function set(next: AppLocation) {
  current = next;
  for (const l of [...listeners]) l();
}

function writeHash(pathname: string, search: string, replace: boolean) {
  const name = toHashName(pathname, search);
  if (name === null || window.location.hash.slice(1) === name) return;
  try {
    if (replace) window.location.replace(`${window.location.href.replace(/#.*$/, "")}#${name}`);
    else window.location.hash = name;
  } catch {
    /* the page keeps working in memory even if its URL cannot change */
  }
}

/** Back/forward buttons and edited artifact links: follow route hashes, ignore every other hash. */
function onHashChange() {
  const loc = fromHashName(window.location.hash);
  if (!loc || (loc.pathname === current.pathname && loc.search === current.search)) return;
  set({ ...loc, fragment: "", key: current.key + 1, scroll: true });
}

/** In-page anchors (`<a href="#section">`) scroll without touching the hash, which holds the route. */
function onDocumentClick(e: MouseEvent) {
  if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
  const a = (e.target as Element | null)?.closest?.("a[href^='#']");
  const id = decode(a?.getAttribute("href")?.slice(1) ?? "");
  if (!id || fromHashName(id)) return;
  e.preventDefault();
  scrollToFragment(id, { smooth: true });
}

function start() {
  if (started || typeof window === "undefined") return;
  started = true;
  window.addEventListener("hashchange", onHashChange);
  document.addEventListener("click", onDocumentClick);
}

export function subscribe(listener: () => void) {
  start();
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export const getLocation = () => current;

/** The current location; re-renders on every navigation. */
export function useLocation(): AppLocation {
  return useSyncExternalStore(subscribe, getLocation, getLocation);
}

export type NavigateOptions = { replace?: boolean; scroll?: boolean };

/** Go to an app path ("/learn/x", "/map?target=y", "/learn/x#assessment", "#assessment"). */
export function navigate(href: string, { replace = false, scroll = true }: NavigateOptions = {}) {
  const to = resolveHref(href, current);
  if (!to) {
    window.open(href, "_blank", "noopener");
    return;
  }
  if (to.pathname === current.pathname && to.search === current.search) {
    if (to.fragment) scrollToFragment(to.fragment, { smooth: true });
    return;
  }
  set({ ...to, key: current.key + 1, scroll });
  writeHash(to.pathname, to.search, replace);
}

/** Path params of the matched route (provided by the router, read by the useParams shim). */
export const ParamsContext = createContext<Record<string, string>>({});

/** Thrown by the next/navigation shim's notFound() and redirect(); the router's page boundary handles it. */
export class RouteSignal extends Error {
  constructor(
    public kind: "not-found" | "redirect",
    public href = "",
  ) {
    super(kind === "not-found" ? "NEXT_NOT_FOUND" : `NEXT_REDIRECT ${href}`);
  }
}

// ---------------------------------------------------------------------------------------------- scrolling

let scrollRun = 0;

/**
 * Scroll to the element with this id, waiting (up to `timeout` ms) for it to appear: pages fetch their data
 * after the first render, so a fragment's target usually arrives a moment after the navigation.
 */
export function scrollToFragment(id: string, { smooth = false, timeout = 8000 } = {}) {
  const run = ++scrollRun;
  const until = Date.now() + timeout;
  const reduce = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
  const attempt = () => {
    if (run !== scrollRun) return; // a newer navigation or scroll took over
    const el = document.getElementById(id);
    if (el) el.scrollIntoView({ behavior: smooth && !reduce ? "smooth" : "auto", block: "start" });
    else if (Date.now() < until) window.setTimeout(attempt, 50);
  };
  attempt();
}

/** Scroll to the top, cancelling any pending fragment scroll. */
export function scrollToTop() {
  scrollRun += 1;
  window.scrollTo(0, 0);
}
