export function BrandMark() {
  return <span className="brand-mark brand-mark--artwork" aria-hidden="true">
    {/* Shared SVG assets also run in the Vite native bundle without Next Image. */}
    {/* eslint-disable @next/next/no-img-element */}
    <img className="brand-mark__light" src="/branding/gostone-light.svg" width={36} height={36} alt="" />
    <img className="brand-mark__dark" src="/branding/gostone-dark.svg" width={36} height={36} alt="" />
    {/* eslint-enable @next/next/no-img-element */}
  </span>;
}
