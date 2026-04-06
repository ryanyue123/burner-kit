import * as React from "react";
import { Tooltip } from "@base-ui-components/react/tooltip";
import { cn } from "@/lib/utils";

const TooltipProvider = Tooltip.Provider;
const TooltipRoot = Tooltip.Root;
const TooltipTrigger = Tooltip.Trigger;

const TooltipContent = React.forwardRef<
  HTMLDivElement,
  React.ComponentPropsWithoutRef<typeof Tooltip.Popup> & {
    sideOffset?: number;
  }
>(({ className, sideOffset = 4, ...props }, ref) => (
  <Tooltip.Portal>
    <Tooltip.Positioner sideOffset={sideOffset}>
      <Tooltip.Popup
        ref={ref}
        className={cn(
          "z-50 overflow-hidden rounded-md bg-[hsl(var(--primary))] px-3 py-1.5 text-xs text-[hsl(var(--primary-foreground))] animate-in fade-in-0 zoom-in-95",
          className
        )}
        {...props}
      />
    </Tooltip.Positioner>
  </Tooltip.Portal>
));
TooltipContent.displayName = "TooltipContent";

export { TooltipProvider, TooltipRoot, TooltipTrigger, TooltipContent };
