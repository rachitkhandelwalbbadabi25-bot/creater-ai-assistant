import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/** @type {import('next').NextConfig} */
const nextConfig = {
  turbopack: {},
  webpack: (config) => {
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
    config.resolve.extensionAlias = {
      ".js": [".ts", ".tsx", ".js"],
    };
    return config;
  },
};

export default nextConfig;
