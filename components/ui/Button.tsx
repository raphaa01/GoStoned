import { forwardRef, type ButtonHTMLAttributes } from "react";

type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: "primary" | "secondary" | "ghost";
  size?: "sm" | "md" | "lg";
};

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button({
  className = "",
  variant = "primary",
  size = "md",
  ...props
}, ref) {
  return (
    <button
      className={`button button--${variant} button--${size} ${className}`}
      ref={ref}
      {...props}
    />
  );
});
