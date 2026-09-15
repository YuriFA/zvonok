import { QueryClientProvider } from "@tanstack/react-query";
import { StrictMode, Suspense, lazy } from "react";
import { createRoot } from "react-dom/client";
import { createBrowserRouter } from "react-router";
import { RouterProvider } from "react-router/dom";

import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";

import { AuthProvider } from "./features/auth/contexts/auth.context.tsx";
import { ROUTES } from "./lib/config/routes";
import { queryClient } from "./lib/react-query/query-client";
import { Home } from "./routes/home.tsx";
import { LoginPage } from "./routes/login.tsx";
import { RegisterPage } from "./routes/register.tsx";

const LazyRoomPage = lazy(() => import("./routes/room.tsx").then((m) => ({ default: m.RoomPage })));
const LazyHistoryPage = lazy(() =>
  import("./routes/history.tsx").then((m) => ({ default: m.HistoryPage })),
);

import "./index.css";

const API_BASE_URL =
  (import.meta.env as { VITE_API_BASE_URL?: string }).VITE_API_BASE_URL ?? "http://localhost:3000";

console.log(`%c[zvonok] client v${__CLIENT_VERSION__}`, "color: #6366f1; font-weight: bold");

fetch(`${API_BASE_URL}/version`)
  .then((res) => res.json())
  .then((data: { version?: string; name?: string }) => {
    console.log(
      `%c[zvonok] server v${data.version} (${data.name})`,
      "color: #10b981; font-weight: bold",
    );
  })
  .catch(() => {});

// Lazy-loaded routes — heavy deps (mediasoup-client, socket.io-client) split into separate chunk
const LazyConsoleLayout = lazy(() =>
  import("./routes/console.tsx").then((m) => ({ default: m.ConsoleLayout })),
);
const LazyVisualHarness = lazy(() =>
  import("./dev/visual/visual-harness.tsx").then((m) => ({ default: m.VisualHarness })),
);
const LazyWidgetHarness = lazy(() =>
  import("./dev/widget-harness.tsx").then((m) => ({ default: m.WidgetHarness })),
);
const LazyConsoleLoginPage = lazy(() =>
  import("./routes/console-login.tsx").then((m) => ({ default: m.ConsoleLoginPage })),
);
const LazyConsoleProjectsPage = lazy(() =>
  import("./routes/console-projects.tsx").then((m) => ({
    default: m.ConsoleProjectsPage,
  })),
);
const LazyConsoleProjectPage = lazy(() =>
  import("./routes/console-project.tsx").then((m) => ({
    default: m.ConsoleProjectPage,
  })),
);

const roomPageFallback = (
  <div className="flex h-dscreen items-center justify-center">
    <p className="text-muted-foreground">Loading room...</p>
  </div>
);

const historyPageFallback = (
  <div className="flex h-dscreen items-center justify-center">
    <p className="text-muted-foreground">Loading history...</p>
  </div>
);

const consolePageFallback = (
  <div className="flex h-dscreen items-center justify-center">
    <p className="text-muted-foreground">Loading console...</p>
  </div>
);

const router = createBrowserRouter([
  {
    path: "/",
    index: true,
    Component: Home,
  },
  {
    path: "/login",
    Component: LoginPage,
  },
  {
    path: "/register",
    Component: RegisterPage,
  },
  {
    path: "/room/:slug",
    element: (
      <Suspense fallback={roomPageFallback}>
        <LazyRoomPage />
      </Suspense>
    ),
  },
  {
    path: "/history",
    element: (
      <Suspense fallback={historyPageFallback}>
        <LazyHistoryPage />
      </Suspense>
    ),
  },
  {
    path: ROUTES.CONSOLE,
    element: (
      <Suspense fallback={consolePageFallback}>
        <LazyConsoleLayout />
      </Suspense>
    ),
    children: [
      {
        index: true,
        element: (
          <Suspense fallback={consolePageFallback}>
            <LazyConsoleProjectsPage />
          </Suspense>
        ),
      },
      {
        path: "projects/:id",
        element: (
          <Suspense fallback={consolePageFallback}>
            <LazyConsoleProjectPage />
          </Suspense>
        ),
      },
    ],
  },
  ...(import.meta.env.DEV
    ? [
        {
          path: "/dev/visual",
          element: (
            <Suspense fallback={consolePageFallback}>
              <LazyVisualHarness />
            </Suspense>
          ),
        },
        {
          path: "/dev/widget",
          element: (
            <Suspense fallback={consolePageFallback}>
              <LazyWidgetHarness />
            </Suspense>
          ),
        },
      ]
    : []),
  {
    path: ROUTES.CONSOLE_LOGIN,
    element: (
      <Suspense fallback={consolePageFallback}>
        <LazyConsoleLoginPage />
      </Suspense>
    ),
  },
]);

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <AuthProvider>
        <TooltipProvider>
          <RouterProvider router={router} />
          <Toaster />
        </TooltipProvider>
      </AuthProvider>
    </QueryClientProvider>
  </StrictMode>,
);
