import "server-only";

/**
 * Source of the `@host/ui` ESM module served to utility iframes. Shared
 * between the route handler (which bundles + serves it) and the Tailwind
 * compiler in `build.ts` (which scans it for class candidates so utilities
 * receive a stylesheet covering the primitives' baked-in classes).
 */
export const HOST_UI_SOURCE: string = String.raw`import { createElement, forwardRef } from "react";

function cls(...parts) {
  return parts.filter(Boolean).join(" ");
}

export const Button = forwardRef(function Button(
  { variant = "default", size = "default", className, ...props },
  ref,
) {
  const v = {
    default: "bg-slate-900 text-white hover:bg-slate-800",
    secondary: "bg-slate-100 text-slate-900 hover:bg-slate-200",
    outline: "border border-slate-300 bg-white hover:bg-slate-50",
    destructive: "bg-red-600 text-white hover:bg-red-700",
    ghost: "hover:bg-slate-100",
  }[variant] ?? "";
  const s = {
    default: "h-9 px-4 py-2 text-sm",
    sm: "h-8 px-3 text-xs",
    lg: "h-11 px-6 text-base",
    icon: "h-9 w-9 p-0",
  }[size] ?? "";
  return createElement("button", {
    ref,
    className: cls(
      "inline-flex items-center justify-center rounded-md font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-400 disabled:opacity-50 disabled:pointer-events-none",
      v, s, className,
    ),
    ...props,
  });
});

export const Input = forwardRef(function Input({ className, ...props }, ref) {
  return createElement("input", {
    ref,
    className: cls(
      "flex h-9 w-full rounded-md border border-slate-300 bg-white px-3 py-1 text-sm placeholder:text-slate-400 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-400 disabled:opacity-50",
      className,
    ),
    ...props,
  });
});

export const Textarea = forwardRef(function Textarea({ className, ...props }, ref) {
  return createElement("textarea", {
    ref,
    className: cls(
      "flex min-h-[80px] w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm placeholder:text-slate-400 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-400 disabled:opacity-50",
      className,
    ),
    ...props,
  });
});

export function Label({ className, ...props }) {
  return createElement("label", {
    className: cls("text-xs font-medium text-slate-600", className),
    ...props,
  });
}

export function Card({ className, ...props }) {
  return createElement("div", {
    className: cls(
      "rounded-lg border border-slate-200 bg-white shadow-sm",
      className,
    ),
    ...props,
  });
}

export function CardContent({ className, ...props }) {
  return createElement("div", {
    className: cls("p-4", className),
    ...props,
  });
}

export function CardHeader({ className, ...props }) {
  return createElement("div", {
    className: cls("p-4 border-b border-slate-100", className),
    ...props,
  });
}

export function CardTitle({ className, ...props }) {
  return createElement("h3", {
    className: cls("text-base font-semibold", className),
    ...props,
  });
}

export function Badge({ variant = "default", className, ...props }) {
  const v = {
    default: "bg-slate-900 text-white",
    secondary: "bg-slate-100 text-slate-900",
    outline: "border border-slate-300 text-slate-700",
  }[variant] ?? "";
  return createElement("span", {
    className: cls(
      "inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium",
      v, className,
    ),
    ...props,
  });
}

export function ScrollArea({ className, children }) {
  return createElement("div", {
    className: cls("overflow-y-auto", className),
  }, children);
}
`;
