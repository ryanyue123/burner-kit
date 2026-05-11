import { useNavigate } from "@tanstack/react-router";
import { Header } from "../components/header";
import { AccountList } from "../components/account-list";
import { EmptyState } from "../components/empty-state";
import { useEmailAccounts, useGenerateEmail, useSyncAllAccounts } from "../hooks/use-api";

export function AccountsRoute() {
  const navigate = useNavigate();
  const { data, isLoading, isFetching } = useEmailAccounts();
  const generateEmail = useGenerateEmail();
  const syncAll = useSyncAllAccounts();

  const accounts = data?.ok ? data.data : [];

  return (
    <>
      <Header
        onGenerate={() => generateEmail.mutate()}
        isGenerating={generateEmail.isPending}
        onRefresh={() => syncAll.mutate(accounts.map((a) => a.id))}
        isRefreshing={syncAll.isPending || isFetching}
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
        <AccountList
          accounts={accounts}
          onSelect={(accountId) => navigate({ to: "/accounts/$accountId", params: { accountId } })}
        />
      )}
      {generateEmail.isError && (
        <div className="px-4 py-2 text-xs text-destructive">
          Failed to generate email. Try again.
        </div>
      )}
    </>
  );
}
