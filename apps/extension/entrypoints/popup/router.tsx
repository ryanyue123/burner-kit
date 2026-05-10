import {
  createRootRoute,
  createRoute,
  createRouter,
  createMemoryHistory,
  Outlet,
} from "@tanstack/react-router";
import { AccountsRoute } from "./routes/accounts";
import { MessagesRoute } from "./routes/messages";
import { MessageRoute } from "./routes/message";

const rootRoute = createRootRoute({
  component: () => (
    <main className="min-w-[320px] max-h-[500px] overflow-y-auto bg-background text-foreground">
      <Outlet />
    </main>
  ),
});

const accountsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/",
  component: AccountsRoute,
});

const messagesRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/accounts/$accountId",
  component: MessagesRoute,
});

const messageRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/accounts/$accountId/messages/$messageId",
  component: MessageRoute,
});

const routeTree = rootRoute.addChildren([accountsRoute, messagesRoute, messageRoute]);

const memoryHistory = createMemoryHistory({
  initialEntries: ["/"],
});

export const router = createRouter({
  routeTree,
  history: memoryHistory,
});

declare module "@tanstack/react-router" {
  interface Register {
    router: typeof router;
  }
}
