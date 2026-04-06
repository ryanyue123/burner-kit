import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import type { EmailAccount, EmailMessage, ApiResult } from "@/lib/api-client";

function sendMessage<T>(message: Record<string, unknown>): Promise<ApiResult<T>> {
  return chrome.runtime.sendMessage(message);
}

export function useEmailAccounts() {
  return useQuery({
    queryKey: ["email-accounts"],
    queryFn: () => sendMessage<EmailAccount[]>({ type: "GET_EMAIL_ACCOUNTS" }),
  });
}

export function useMessages(accountId: string, enabled: boolean) {
  return useQuery({
    queryKey: ["messages", accountId],
    queryFn: () => sendMessage<EmailMessage[]>({ type: "GET_MESSAGES", accountId }),
    enabled,
  });
}

export function useGenerateEmail() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () => sendMessage<EmailAccount>({ type: "GENERATE_EMAIL" }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["email-accounts"] }),
  });
}

export function useDeleteAccount() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (accountId: string) => sendMessage<void>({ type: "DELETE_ACCOUNT", accountId }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["email-accounts"] }),
  });
}

export function useMarkRead() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ accountId, messageId, isRead }: { accountId: string; messageId: string; isRead: boolean }) =>
      sendMessage<EmailMessage>({ type: "MARK_READ", accountId, messageId, isRead }),
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({ queryKey: ["messages", variables.accountId] });
      queryClient.invalidateQueries({ queryKey: ["email-accounts"] });
    },
  });
}
