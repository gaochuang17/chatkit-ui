import react from "@vitejs/plugin-react";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";

const reactSource = fileURLToPath(
  new URL("../../libs/react/src/index.ts", import.meta.url),
);
const reactStyles = fileURLToPath(
  new URL("../../libs/react/src/tokens.css", import.meta.url),
);
const ccChatApiTarget =
  process.env.CHATKIT_DEMO_API_TARGET ?? "http://127.0.0.1:8000";

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: [
      {
        find: "@chatkit-lab/chatkit-react/styles.css",
        replacement: reactStyles,
      },
      { find: "@chatkit-lab/chatkit-react", replacement: reactSource },
    ],
  },
  server: {
    proxy: {
      // Demo 与 cc-chat 后端不同源，开发环境通过同源 /api 代理避免 CORS。
      "/api": {
        target: ccChatApiTarget,
        changeOrigin: true,
      },
    },
  },
});
