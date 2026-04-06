import * as React from "react";
import { ScrollArea } from "@base-ui-components/react/scroll-area";
import { cn } from "@/lib/utils";

const ScrollAreaRoot = React.forwardRef<
  HTMLDivElement,
  React.ComponentPropsWithoutRef<typeof ScrollArea.Root>
>(({ className, children, ...props }, ref) => (
  <ScrollArea.Root ref={ref} className={cn("relative overflow-hidden", className)} {...props}>
    <ScrollArea.Viewport className="h-full w-full rounded-[inherit]">
      {children}
    </ScrollArea.Viewport>
    <ScrollAreaScrollbar />
    <ScrollArea.Corner />
  </ScrollArea.Root>
));
ScrollAreaRoot.displayName = "ScrollAreaRoot";

const ScrollAreaScrollbar = React.forwardRef<
  HTMLDivElement,
  React.ComponentPropsWithoutRef<typeof ScrollArea.Scrollbar>
>(({ className, ...props }, ref) => (
  <ScrollArea.Scrollbar
    ref={ref}
    className={cn(
      "flex touch-none select-none transition-colors h-full w-2.5 border-l border-l-transparent p-[1px]",
      className,
    )}
    {...props}
  >
    <ScrollArea.Thumb className="relative flex-1 rounded-full bg-[hsl(var(--border))]" />
  </ScrollArea.Scrollbar>
));
ScrollAreaScrollbar.displayName = "ScrollAreaScrollbar";

export { ScrollAreaRoot, ScrollAreaScrollbar };
