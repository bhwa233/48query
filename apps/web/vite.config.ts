import { cloudflare } from "@cloudflare/vite-plugin";
import vinext from "vinext";
import { defineConfig } from "vite";
import { resolveWebEnv } from "./env.config.ts";

export default defineConfig(({ mode }) => {
  const env = resolveWebEnv(mode);
  return {
    define: {
      "process.env.NEXT_PUBLIC_SITE_URL": JSON.stringify(env.siteUrl),
      "process.env.NEXT_PUBLIC_API_BASE_URL": JSON.stringify(env.apiBaseUrl),
    },
    resolve: { dedupe: ["react", "react-dom"] },
    plugins: [
      vinext(),
      cloudflare({
        viteEnvironment: { name: "rsc", childEnvironments: ["ssr"] },
      }),
    ],
    server: { strictPort: true },
  };
});
