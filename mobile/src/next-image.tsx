import { forwardRef, type ImgHTMLAttributes } from "react";

type ImageProps = ImgHTMLAttributes<HTMLImageElement> & {
  fill?: boolean;
  priority?: boolean;
};

const Image = forwardRef<HTMLImageElement, ImageProps>(function MobileImage(
  { fill, priority, loading, ...props },
  ref,
) {
  void fill;

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
