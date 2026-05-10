import { RefreshCw, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";

export function Header({
  onGenerate,
  isGenerating,
  onRefresh,
  isRefreshing,
}: {
  onGenerate: () => void;
  isGenerating: boolean;
  onRefresh: () => void;
  isRefreshing: boolean;
}) {
  return (
    <div className="flex items-center justify-between px-4 h-[var(--header-h)] border-b border-border">
      <div className="flex items-center gap-2">
        <div className="w-6 h-6 bg-primary rounded flex items-center justify-center text-xs font-bold text-primary-foreground">
          B
        </div>
        <span className="text-sm font-semibold text-foreground">Burner Kit</span>
      </div>
      <div className="flex items-center gap-1">
        <Button
          variant="secondary"
          size="sm"
          onClick={onRefresh}
          disabled={isRefreshing}
          title="Refresh"
        >
          <RefreshCw className={isRefreshing ? "animate-spin" : ""} />
        </Button>
        <Button size="sm" onClick={onGenerate} disabled={isGenerating}>
          <Plus />
          {isGenerating ? "Creating..." : "New"}
        </Button>
      </div>
    </div>
  );
}
