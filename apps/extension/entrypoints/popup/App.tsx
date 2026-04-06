import { Header } from "./components/header";
import { AccountList } from "./components/account-list";
import { EmptyState } from "./components/empty-state";
import { useEmailAccounts, useGenerateEmail } from "./hooks/use-api";

export default function App() {
  const { data, isLoading } = useEmailAccounts();
  const generateEmail = useGenerateEmail();

  const accounts = data?.ok ? data.data : [];

  return (
    <main className="min-w-[320px] max-h-[500px] overflow-y-auto bg-background text-foreground">
      <Header
        onGenerate={() => generateEmail.mutate()}
        isGenerating={generateEmail.isPending}
      />
      {isLoading ? (
        <div className="flex items-center justify-center py-12 text-sm text-muted-foreground">
          Loading...
        </div>
      ) : accounts.length === 0 ? (
        <EmptyState
          onGenerate={() => generateEmail.mutate()}
          isGenerating={generateEmail.isPending}
        />
      ) : (
        <AccountList accounts={accounts} />
      )}
      {generateEmail.isError && (
        <div className="px-4 py-2 text-xs text-destructive">
          Failed to generate email. Try again.
        </div>
      )}
    </main>
  );
}
