import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// Vite's dev server serves .wasm as application/octet-stream, so
// WebAssembly.instantiateStreaming fails and IDKit falls back to a path that
// dies inside the widget — surfacing as World's generic "Something went wrong",
// with no console error and no network request to debug from. The production
// build serves the right type; this makes `vite dev` behave the same.
const wasmMime = {
  name: "wasm-content-type",
  configureServer(server: any) {
    server.middlewares.use((req: any, res: any, next: any) => {
      // Setting the header here would be overwritten by Vite's own static
      // middleware further down the chain, so patch the setter instead.
      if (req.url?.includes(".wasm")) {
        const setHeader = res.setHeader.bind(res);
        res.setHeader = (name: string, value: any) =>
          setHeader(name, name.toLowerCase() === "content-type" ? "application/wasm" : value);
      }
      next();
    });
  },
};

// The app talks to its own origin (see lens/src/hub.ts), because in production
// the hub serves this bundle. `vite dev` is the one place that isn't true, so
// proxy the hub's routes — including the websocket — back to :4021.
const HUB_ROUTES =
  "^/(ws|status|lanes|analytics|balances|policy|testbuyer|account|world|faucet|event|settle)";

export default defineConfig({
  plugins: [react(), wasmMime],
  server: {
    port: 5173,
    proxy: { [HUB_ROUTES]: { target: "http://localhost:4021", ws: true } },
  },
});
