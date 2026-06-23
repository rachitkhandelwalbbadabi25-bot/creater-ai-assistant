import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/** @type {import('next').NextConfig} */
const nextConfig = {
  outputFileTracingRoot: path.resolve(__dirname, "../.."),
  turbopack: {
    resolveAlias: {
      // Direct extension mapping for Turbopack resolving .js imports to TS files using relative paths to bypass Windows absolute path limitations
      "@graph/supervisor.js": "../../src/graph/supervisor.ts",
      "@utils/stats.js": "../../src/utils/stats.ts",
      "@tools/laptop/system.js": "../../src/tools/laptop/system.ts",
      "@memory/db.js": "../../src/memory/db.ts",
      "@config/index.js": "../../src/config/index.ts",
      
      // Base path mappings for Turbopack using relative paths
      "@graph": "../../src/graph",
      "@memory": "../../src/memory",
      "@utils": "../../src/utils",
      "@tools": "../../src/tools",
      "@config": "../../src/config",
      "@llm": "../../src/llm",
      "@emotion": "../../src/emotion",
      "@proactive": "../../src/proactive",
      "@bot": "../../src/bot",
      "@voice": "../../src/voice",
      "@tui": "../../src/tui",
    }
  },
  webpack: (config, { webpack }) => {
    // Silence macOS-only optional native modules that systeminformation
    // conditionally requires — they are never used on Windows/Linux.
    config.plugins = config.plugins ?? [];
    config.plugins.push(
      new webpack.IgnorePlugin({
        resourceRegExp: /^(osx-temperature-sensor|macos-temperature-sensor)$/,
      })
    );
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
