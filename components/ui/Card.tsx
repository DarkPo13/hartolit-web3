import * as React from "react";
import { cn } from "@/lib/utils";

export const Card = React.forwardRef<
  HTMLDivElement,
  React.HTMLAttributes<HTMLDivElement> & { tone?: "default" | "muted" | "brand" }
>(({ className, tone = "default", ...props }, ref) => (
  <div
    ref={ref}
    className={cn(
      "rounded-xl border shadow-soft",
      tone === "default" && "bg-surface border-border",
      tone === "muted" && "bg-surface-2 border-border",
      tone === "brand" && "bg-brand-50 border-brand-200",
      className,
    )}
    {...props}
  />
));
Card.displayName = "Card";

export const CardHeader = React.forwardRef<
  HTMLDivElement,
  React.HTMLAttributes<HTMLDivElement>
>(({ className, ...props }, ref) => (
  <div ref={ref} className={cn("flex flex-col gap-1 p-6 pb-3", className)} {...props} />
));
CardHeader.displayName = "CardHeader";

export const CardTitle = React.forwardRef<
  HTMLHeadingElement,
  React.HTMLAttributes<HTMLHeadingElement>
>(({ className, ...props }, ref) => (
  <h3
    ref={ref}
    className={cn("text-lg font-semibold leading-tight tracking-tight text-ink", className)}
    {...props}
  />
));
CardTitle.displayName = "CardTitle";

export const CardDescription = React.forwardRef<
  HTMLParagraphElement,
  React.HTMLAttributes<HTMLParagraphElement>
>(({ className, ...props }, ref) => (
  <p ref={ref} className={cn("text-sm text-ink-muted", className)} {...props} />
));
CardDescription.displayName = "CardDescription";

export const CardContent = React.forwardRef<
  HTMLDivElement,
  React.HTMLAttributes<HTMLDivElement>
>(({ className, ...props }, ref) => (
  <div ref={ref} className={cn("p-6 pt-3", className)} {...props} />
));
CardContent.displayName = "CardContent";

export const CardFooter = React.forwardRef<
  HTMLDivElement,
  React.HTMLAttributes<HTMLDivElement>
>(({ className, ...props }, ref) => (
  <div
    ref={ref}
    className={cn("flex items-center gap-3 p-6 pt-0 border-t border-border", className)}
    {...props}
  />
));
CardFooter.displayName = "CardFooter";

interface BlockCardProps extends React.HTMLAttributes<HTMLDivElement> {
  number: string;
  title: string;
  hint?: string;
  children: React.ReactNode;
}

export function BlockCard({ number, title, hint, children, className, ...props }: BlockCardProps) {
  return (
    <Card className={cn("overflow-hidden", className)} {...props}>
      <div className="flex items-center gap-4 border-b border-border bg-surface-2/40 px-6 py-4">
        <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-brand-600 font-mono text-sm font-bold text-white shadow-soft">
          {number}
        </div>
        <div className="flex-1 min-w-0">
          <h2 className="font-semibold text-ink leading-tight">{title}</h2>
          {hint && <p className="text-xs text-ink-muted mt-0.5">{hint}</p>}
        </div>
      </div>
      <div className="p-6">{children}</div>
    </Card>
  );
}
