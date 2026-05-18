import type { NextConfig } from "next";
import { fileURLToPath } from "url";
import path from "path";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const nextConfig: NextConfig = {
  webpack: (config) => {
    // Resolve custom folder path aliases in parent/sibling directory
    config.resolve.alias = {
      ...config.resolve.alias,
      "@graph": path.resolve(__dirname, "../../src/graph"),
      "@memory": path.resolve(__dirname, "../../src/memory"),
      "@utils": path.resolve(__dirname, "../../src/utils"),
      "@tools": path.resolve(__dirname, "../../src/tools"),
      "@config": path.resolve(__dirname, "../../src/config"),
      "@llm": path.resolve(__dirname, "../../src/llm"),
      "@emotion": path.resolve(__dirname, "../../src/emotion"),
      "@proactive": path.resolve(__dirname, "../../src/proactive"),
      "@bot": path.resolve(__dirname, "../../src/bot"),
      "@voice": path.resolve(__dirname, "../../src/voice"),
      "@tui": path.resolve(__dirname, "../../src/tui"),
    };

    // Support compiling .js imports mapping to .ts/.tsx files
    config.resolve.extensionAlias = {
      ...config.resolve.extensionAlias,
      ".js": [".js", ".ts", ".tsx"],
    };

    return config;
  },
};

export default nextConfig;
