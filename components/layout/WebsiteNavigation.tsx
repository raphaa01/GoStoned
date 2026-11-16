"use client";

import { useLayoutEffect, useRef, useState } from "react";
import { Navbar } from "./Navbar";
import { DesktopHeader } from "./Sidebar";

type Layout = "wide" | "overflow" | "compact";

export function WebsiteNavigation() {
  const [layout, setLayout] = useState<Layout>();
  const header = useRef<HTMLElement>(null);

  useLayoutEffect(() => {
    const desktop = header.current;
    if (!desktop) return;
    const [brand, tabs, account] = Array.from(desktop.children);
    const group = tabs.firstElementChild!;
    const links = Array.from(group.children);
    const phone = window.matchMedia("(max-width: 640px), (hover: none) and (pointer: coarse) and (max-height: 500px)");

    const updateLayout = () => {
      if (phone.matches) {
        setLayout("compact");
        return;
      }

      // The hidden controls retain their intrinsic widths so resizing can bring them back.
      const style = getComputedStyle(desktop);
      const headerSpacing = 2 * (parseFloat(style.paddingLeft) + parseFloat(style.columnGap));
      const tabSpacing = (links.length - 1) * parseFloat(getComputedStyle(group).columnGap);
      const linkWidth = links.reduce((width, link) => width + link.getBoundingClientRect().width, 0);
      const requiredWidth = brand.getBoundingClientRect().width + account.getBoundingClientRect().width
        + headerSpacing + tabSpacing + linkWidth;

      setLayout(requiredWidth <= desktop.getBoundingClientRect().width ? "wide" : "overflow");
    };

    updateLayout();
    const observer = new ResizeObserver(updateLayout);
    for (const element of [desktop, brand, group, account, ...links]) observer.observe(element);
    phone.addEventListener("change", updateLayout);
    return () => {
      observer.disconnect();
      phone.removeEventListener("change", updateLayout);
    };
  }, []);

  return (
    <div className="web-navigation" data-layout={layout}>
      <DesktopHeader headerRef={header} />
      <Navbar key={layout} overflow={layout === "overflow"} />
    </div>
  );
}
