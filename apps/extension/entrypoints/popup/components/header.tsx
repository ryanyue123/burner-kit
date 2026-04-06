import { Button } from "@/components/ui/button";

export function Header({ onGenerate, isGenerating }: { onGenerate: () => void; isGenerating: boolean }) {
  return (
    <div className="flex items-center justify-between px-4 py-3 border-b border-border">
      <div className="flex items-center gap-2">
        <div className="w-6 h-6 bg-primary rounded flex items-center justify-center text-xs font-bold text-primary-foreground">
          B
        </div>
        <span className="text-sm font-semibold text-foreground">Burner Kit</span>
      </div>
      <Button size="sm" onClick={onGenerate} disabled={isGenerating}>
        {isGenerating ? "Creating..." : "+ New"}
      </Button>
    </div>
  );
}
