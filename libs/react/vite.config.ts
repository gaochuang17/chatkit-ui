import { fileURLToPath } from "node:url";
import react from "@vitejs/plugin-react";
import fs from "node:fs";
import { defineConfig, type Plugin } from "vite";

const safeDecodeNamedCharacterReference = fileURLToPath(
  new URL("./src/ssrSafeDecodeNamedCharacterReference.ts", import.meta.url),
);

function renameCss(): Plugin {
  return {
    name: "chatkit-rename-css",
    closeBundle() {
      const distDir = fileURLToPath(new URL("./dist", import.meta.url));
      const generated = `${distDir}/style.css`;
      const target = `${distDir}/styles.css`;
      if (fs.existsSync(generated)) fs.renameSync(generated, target);
    },
  };
}

export default defineConfig({
  plugins: [react(), renameCss()],
  resolve: {
    alias: [
      {
        // Vite 的 browser 条件会选中一个在模块加载期创建 DOM 的 micromark
        // 依赖；这里改用同一实体表的无 DOM 实现，保证发布包可被 SSR 导入。
        find: /^decode-named-character-reference$/,
        replacement: safeDecodeNamedCharacterReference,
      },
    ],
  },
  build: {
    lib: {
      entry: fileURLToPath(new URL("./src/index.ts", import.meta.url)),
      name: "ChatKitReact",
      formats: ["es", "cjs"],
      fileName(format) {
        return format === "es" ? "index.js" : "index.cjs";
      },
    },
    rollupOptions: {
      external: [
        "react",
        "react-dom",
        "react/jsx-runtime",
        "@chatkit-lab/chatkit-core",
      ],
    },
  },
});
