import path from "path";

import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";
import svgr from "vite-plugin-svgr";

import pkg from "./package.json";

// https://vite.dev/config/
export default defineConfig(async () => {
  const plugins = [react(), tailwindcss(), svgr()];

  // Bundle analysis: ANALYZE=true pnpm -C apps/client build
  if (process.env.ANALYZE) {
    const { visualizer } = await import("rollup-plugin-visualizer");
    plugins.push(
      visualizer({
        filename: "dist/bundle-stats.html",
        gzipSize: true,
        template: "treemap",
      }) as never,
    );
  }

  return {
    plugins,
    define: {
      __CLIENT_VERSION__: JSON.stringify(pkg.version),
    },
    resolve: {
      alias: {
        "@": path.resolve(__dirname, "./src"),
      },
    },
    build: {
      rollupOptions: {
        output: {
          // Match by resolved path, not bare specifier: object-form
          // manualChunks resolves package names from apps/client, where
          // transitive deps of workspace packages (e.g. @excalidraw/excalidraw
          // via @zvonok/whiteboard-react) are invisible under pnpm's strict
          // node_modules - and the build fails.
          manualChunks(id: string) {
            if (!id.includes("/node_modules/")) return undefined;
            const groups: Array<[chunk: string, packages: string[]]> = [
              // Core framework — loaded on every page
              ["vendor-react", ["react", "react-dom", "react-router"]],
              // Data layer — loaded on every page (auth, queries)
              [
                "vendor-data",
                [
                  "@tanstack/react-query",
                  "react-hook-form",
                  "@hookform/resolvers",
                  "zod",
                ],
              ],
              // Room-specific heavy deps — only loaded with room chunk
              ["vendor-sfu", ["mediasoup-client", "socket.io-client"]],
              // Whiteboard canvas — 1 MB+, lazy-loaded with the board panel
              ["vendor-excalidraw", ["@excalidraw/excalidraw", "yjs"]],
            ];
            for (const [chunk, packages] of groups) {
              if (
                packages.some((pkg) => id.includes(`/node_modules/${pkg}/`))
              ) {
                return chunk;
              }
            }
            return undefined;
          },
        },
      },
    },
  };
});
