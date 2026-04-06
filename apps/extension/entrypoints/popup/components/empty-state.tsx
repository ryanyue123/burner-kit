import { Button } from "@/components/ui/button";

export function EmptyState({ onGenerate, isGenerating }: { onGenerate: () => void; isGenerating: boolean }) {
  return (
    <div className="flex flex-col items-center justify-center py-12 px-4 text-center">
      <p className="text-sm text-muted-foreground mb-4">
        No burner emails yet. Generate one to get started.
      </p>
      <Button onClick={onGenerate} disabled={isGenerating}>
        {isGenerating ? "Creating..." : "Generate Burner Email"}
      </Button>
    </div>
  );
}
