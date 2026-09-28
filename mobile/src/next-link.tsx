import { forwardRef, type AnchorHTMLAttributes, type MouseEvent } from "react";
import { useRouter } from "./next-navigation";

type LinkProps = Omit<AnchorHTMLAttributes<HTMLAnchorElement>, "href"> & {
  href: string | { pathname?: string; query?: Record<string, string> };
  replace?: boolean;
};

function linkHref(value: LinkProps["href"]): string {
  if (typeof value === "string") return value;
  const parameters = new URLSearchParams(value.query);
  return `${value.pathname ?? "/"}${parameters.size ? `?${parameters}` : ""}`;
}

const Link = forwardRef<HTMLAnchorElement, LinkProps>(function MobileLink(
  { href, onClick, replace = false, target, ...props },
  ref,
) {
  const router = useRouter();
  const destination = linkHref(href);
  const handleClick = (event: MouseEvent<HTMLAnchorElement>) => {
    onClick?.(event);
    if (
      event.defaultPrevented
      || event.button !== 0
      || event.metaKey
      || event.ctrlKey
      || event.shiftKey
      || event.altKey
      || target === "_blank"
      || /^(?:[a-z]+:)?\/\//i.test(destination)
    ) return;
    event.preventDefault();
    router[replace ? "replace" : "push"](destination);
  };
  return <a {...props} href={destination} onClick={handleClick} ref={ref} target={target} />;
});

export default Link;
