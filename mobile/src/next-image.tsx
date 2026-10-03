import { forwardRef, type ImgHTMLAttributes } from "react";

type ImageProps = ImgHTMLAttributes<HTMLImageElement> & {
  fill?: boolean;
  priority?: boolean;
  unoptimized?: boolean;
};

const Image = forwardRef<HTMLImageElement, ImageProps>(function MobileImage(
  { fill, priority, unoptimized, loading, ...props },
  ref,
) {
  void fill;
  void unoptimized;

  return (
    // The native bundle cannot use Next.js image optimization.
    // eslint-disable-next-line @next/next/no-img-element
    <img
      {...props}
      alt={props.alt ?? ""}
      loading={priority ? "eager" : loading}
      ref={ref}
    />
  );
});

export default Image;
