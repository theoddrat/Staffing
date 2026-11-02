/**
 * `next/link` for the standalone build (esbuild aliases the import here). Renders a plain <a> whose href is the
 * route's hash form (`#v-learn--x`, so it still works as a link) and navigates in memory on click.
 */
import type { AnchorHTMLAttributes, MouseEvent, ReactNode, Ref } from "react";
import { getLocation, navigate, resolveHref, scrollToFragment, toHashName } from "../location";

type QueryValue = string | number | boolean | null | undefined;
export type UrlObject = {
  pathname?: string | null;
  query?: string | Record<string, QueryValue | readonly QueryValue[]> | null;
  search?: string | null;
  hash?: string | null;
};

export type LinkProps = Omit<AnchorHTMLAttributes<HTMLAnchorElement>, "href"> & {
  href: string | UrlObject;
  as?: string | UrlObject;
  replace?: boolean;
  scroll?: boolean;
  prefetch?: boolean | "auto" | null;
  shallow?: boolean;
  passHref?: boolean;
  legacyBehavior?: boolean;
  locale?: string | false;
  transitionTypes?: string[];
  onNavigate?: (e: { preventDefault(): void }) => void;
  ref?: Ref<HTMLAnchorElement>;
  children?: ReactNode;
};

/** A Next.js href (string or URL object) as a string path. */
export function formatHref(href: string | UrlObject): string {
  if (typeof href === "string") return href;
  let search = href.search ?? "";
  if (!search && href.query) {
    if (typeof href.query === "string") search = href.query;
    else {
      const q = new URLSearchParams();
      for (const [k, v] of Object.entries(href.query)) {
        for (const item of Array.isArray(v) ? v : [v]) if (item !== null && item !== undefined) q.append(k, String(item));
      }
      search = q.toString();
    }
  }
  if (search && !search.startsWith("?")) search = `?${search}`;
  const hash = href.hash ? (href.hash.startsWith("#") ? href.hash : `#${href.hash}`) : "";
  return `${href.pathname ?? ""}${search}${hash}`;
}

export default function Link(props: LinkProps) {
  const { href, as, replace, scroll, onNavigate, onClick, ref, children, prefetch, shallow, passHref, legacyBehavior, locale, transitionTypes, ...anchor } =
    props;
  void [prefetch, shallow, passHref, legacyBehavior, locale, transitionTypes]; // Next.js-only props, not anchor attributes

  const url = formatHref(as ?? href);
  const to = resolveHref(url, getLocation()); // null: an external URL, left to the browser
  const inPage = url.startsWith("#");
  const shown = !to || inPage ? url : `#${toHashName(to.pathname, to.search) ?? ""}`;

  const click = (e: MouseEvent<HTMLAnchorElement>) => {
    onClick?.(e);
    if (e.defaultPrevented || !to) return;
    if (e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    if (anchor.target && anchor.target !== "_self") return;
    e.preventDefault();
    const nav = { cancelled: false };
    onNavigate?.({ preventDefault: () => void (nav.cancelled = true) });
    if (nav.cancelled) return;
    if (inPage) scrollToFragment(to.fragment, { smooth: true });
    else navigate(url, { replace, scroll });
  };

  return (
    <a {...anchor} ref={ref} href={shown} onClick={click}>
      {children}
    </a>
  );
}
