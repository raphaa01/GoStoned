import Image from "next/image";

// CSS follows the saved theme before hydration; lazy loading only fetches the
// visible variant, including when the user overrides the system color scheme.
export function StoneArtwork({ className = "", sizes }: { className?: string; sizes: string }) {
  return (
    <>
      <Image alt="" className={`stone-artwork--light ${className}`} fetchPriority="high"
        height={983} sizes={sizes} src="/images/gostone-hero-stone.webp" width={1536} />
      <Image alt="" className={`stone-artwork--dark ${className}`} fetchPriority="high"
        height={984} sizes={sizes} src="/images/gostone-hero-stone-dark.webp" width={1536} />
    </>
  );
}
