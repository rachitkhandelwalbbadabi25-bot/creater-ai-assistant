// ════════════════════════════════════════════════════════════════════════════════
// src/tui/wizard.tsx — First-Run Setup Wizard TUI in React/Ink
// ════════════════════════════════════════════════════════════════════════════════

import React, { useState, useEffect } from "react";
import { Box, Text, useInput, Newline } from "ink";
import Spinner from "ink-spinner";
import si from "systeminformation";
import figlet from "figlet";
import gradient from "gradient-string";
import { setSetting } from "@config/settings.js";
import { checkOllamaHealth, ollamaClient } from "@llm/ollama.js";

// ─── Setup Wizard Steps ──────────────────────────────────────────────────────────
type StepType =
  | "WELCOME"
  | "CHOOSE_MODE"
  | "LOCAL_SCANNING"
  | "LOCAL_OLLAMA_WARNING"
  | "LOCAL_RECOMMEND"
  | "LOCAL_DOWNLOADING"
  | "LOCAL_DOWNLOAD_ERROR"
  | "CLOUD_KEYS"
  | "CLOUD_SUMMARY"
  | "FINAL_SCREEN";

const CLOUD_PROVIDERS = [
  { name: "Anthropic", stateKey: "ANTHROPIC_API_KEY", prefix: "sk-ant-" },
  { name: "OpenAI", stateKey: "OPENAI_API_KEY", prefix: "sk-" },
  { name: "DeepSeek", stateKey: "DEEPSEEK_API_KEY", prefix: "sk-" },
  { name: "Gemini", stateKey: "GEMINI_API_KEY", prefix: "AI" },
  { name: "Grok", stateKey: "GROK_API_KEY", prefix: "xai-" }
];

function validateKeyFormat(providerName: string, key: string): boolean {
  if (providerName === "Anthropic") return key.startsWith("sk-ant-");
  if (providerName === "OpenAI") return key.startsWith("sk-");
  if (providerName === "DeepSeek") return key.startsWith("sk-");
  if (providerName === "Gemini") return key.startsWith("AI");
  if (providerName === "Grok") return key.startsWith("xai-");
  return true;
}

export function SetupWizard({ onComplete }: { onComplete: () => void }) {
  // Wizard States
  const [step, setStep] = useState<StepType>("WELCOME");
  const [selectedMode, setSelectedMode] = useState<number>(0); // 0 = Local, 1 = Cloud, 2 = Hybrid
  const [targetMode, setTargetMode] = useState<"local" | "cloud" | "hybrid">("local");

  // Hardware Scan States
  const [hardwareInfo, setHardwareInfo] = useState({
    ram: 0,
    cores: 0,
    vram: 0,
    cpuBrand: ""
  });
  const [recommendedModel, setRecommendedModel] = useState("tinyllama:1.1b");
  const [downloadChoice, setDownloadChoice] = useState<"Y" | "N">("Y");

  // Local Download progress
  const [downloadPercent, setDownloadPercent] = useState(0);
  const [downloadBytes, setDownloadBytes] = useState({ completed: 0, total: 0 });
  const [downloadStatus, setDownloadStatus] = useState("");

  // Cloud API Key States
  const [cloudSubstep, setCloudSubstep] = useState(0); // 0 to 4
  const [apiKeys, setApiKeys] = useState({
    ANTHROPIC_API_KEY: "",
    OPENAI_API_KEY: "",
    DEEPSEEK_API_KEY: "",
    GEMINI_API_KEY: "",
    GROK_API_KEY: ""
  });
  const [currentKeyValue, setCurrentKeyValue] = useState("");
  const [keyError, setKeyError] = useState<string | null>(null);

  // ─── Hardware Scanning & Ollama Health Checks ──────────────────────────────────
  useEffect(() => {
    if (step === "LOCAL_SCANNING") {
      const scan = async () => {
        try {
          const memInfo = await si.mem();
          const ramGB = memInfo.total / (1024 * 1024 * 1024);

          const cpuInfo = await si.cpu();
          const cores = cpuInfo.cores;
          const cpuBrand = cpuInfo.brand;

          let vramGB = 0;
          const graphicsInfo = await si.graphics();
          if (graphicsInfo && graphicsInfo.controllers && graphicsInfo.controllers.length > 0) {
            for (const ctrl of graphicsInfo.controllers) {
              if (ctrl.vram) {
                vramGB = Math.max(vramGB, ctrl.vram / 1024);
              }
            }
          }

          setHardwareInfo({ ram: Math.round(ramGB), cores, vram: Math.round(vramGB), cpuBrand });

          // Recommendation logic:
          // if (ramGB >= 32 && vramGB >= 8)  → "qwen2.5:14b"
          // if (ramGB >= 16 && vramGB >= 6)  → "qwen2.5:7b"
          // if (ramGB >= 16)                 → "qwen2.5:7b"
          // if (ramGB >= 8  && vramGB >= 4)  → "qwen2.5:7b"
          // if (ramGB >= 8)                  → "qwen2.5:3b"
          // default                          → "tinyllama:1.1b"
          let recModel = "tinyllama:1.1b";
          if (ramGB >= 32 && vramGB >= 8) {
            recModel = "qwen2.5:14b";
          } else if (ramGB >= 16 && vramGB >= 6) {
            recModel = "qwen2.5:7b";
          } else if (ramGB >= 16) {
            recModel = "qwen2.5:7b";
          } else if (ramGB >= 8 && vramGB >= 4) {
            recModel = "qwen2.5:7b";
          } else if (ramGB >= 8) {
            recModel = "qwen2.5:3b";
          }
          setRecommendedModel(recModel);

          // Add a minor artificial delay for beautiful scanning UX
          setTimeout(async () => {
            const health = await checkOllamaHealth();
            if (health.ok) {
              setStep("LOCAL_RECOMMEND");
            } else {
              setStep("LOCAL_OLLAMA_WARNING");
            }
          }, 1500);
        } catch (err) {
          setHardwareInfo({ ram: 8, cores: 4, vram: 0, cpuBrand: "Generic System" });
          setRecommendedModel("qwen2.5:3b");
          setTimeout(() => {
            setStep("LOCAL_OLLAMA_WARNING");
          }, 1500);
        }
      };
      scan();
    }
  }, [step]);

  const retryOllamaConnection = async () => {
    setKeyError(null);
    const health = await checkOllamaHealth();
    if (health.ok) {
      setStep("LOCAL_RECOMMEND");
    } else {
      setKeyError("❌ Connection failed again. Is Ollama running?");
    }
  };

  const skipOllamaDownload = () => {
    // Still save persistent default values
    setSetting("LLM_PROVIDER", "local");
    setSetting("DEFAULT_MODEL", recommendedModel);
    
    if (targetMode === "hybrid") {
      setStep("CLOUD_KEYS");
    } else {
      setStep("FINAL_SCREEN");
    }
  };

  // ─── Local Download Pull Logic ─────────────────────────────────────────────────
  const startLocalDownload = async () => {
    setStep("LOCAL_DOWNLOADING");
    setDownloadPercent(0);
    setDownloadBytes({ completed: 0, total: 0 });
    setDownloadStatus("Connecting to Ollama service...");
    setKeyError(null);

    try {
      const stream = await ollamaClient.pull({ model: recommendedModel, stream: true });

      for await (const part of stream) {
        if (part.status) {
          setDownloadStatus(part.status);
        }
        if (part.completed && part.total) {
          const pct = Math.round((part.completed / part.total) * 100);
          setDownloadPercent(pct);
          setDownloadBytes({ completed: part.completed, total: part.total });
        }
      }

      // Download Succeeded! Save config
      setSetting("LLM_PROVIDER", "local");
      setSetting("DEFAULT_MODEL", recommendedModel);

      setTimeout(() => {
        if (targetMode === "hybrid") {
          setStep("CLOUD_KEYS");
        } else {
          setStep("FINAL_SCREEN");
        }
      }, 1000);
    } catch (err) {
      setStep("LOCAL_DOWNLOAD_ERROR");
      setKeyError(err instanceof Error ? err.message : String(err));
    }
  };

  const skipLocalDownload = () => {
    setSetting("LLM_PROVIDER", "local");
    setSetting("DEFAULT_MODEL", recommendedModel);

    if (targetMode === "hybrid") {
      setStep("CLOUD_KEYS");
    } else {
      setStep("FINAL_SCREEN");
    }
  };

  // ─── Mode Confirmations ─────────────────────────────────────────────────────────
  const handleConfirmMode = () => {
    if (selectedMode === 0) {
      setTargetMode("local");
      setStep("LOCAL_SCANNING");
    } else if (selectedMode === 1) {
      setTargetMode("cloud");
      setStep("CLOUD_KEYS");
    } else if (selectedMode === 2) {
      setTargetMode("hybrid");
      setStep("LOCAL_SCANNING");
    }
  };

  // ─── Cloud Key Processing & Database Sync ─────────────────────────────────────
  const advanceCloudStep = () => {
    if (cloudSubstep < 4) {
      setCloudSubstep(prev => prev + 1);
    } else {
      setStep("CLOUD_SUMMARY");
    }
  };

  const handleCloudKeyInput = (char: string, key: any) => {
    if (key.return) {
      const provider = CLOUD_PROVIDERS[cloudSubstep]!;
      const trimmed = currentKeyValue.trim();

      if (trimmed === "") {
        // Skipped
        setApiKeys(prev => ({ ...prev, [provider.stateKey]: "" }));
        setCurrentKeyValue("");
        setKeyError(null);
        advanceCloudStep();
      } else {
        const isValid = validateKeyFormat(provider.name, trimmed);
        if (isValid) {
          setApiKeys(prev => ({ ...prev, [provider.stateKey]: trimmed }));
          setCurrentKeyValue("");
          setKeyError(null);
          advanceCloudStep();
        } else {
          setKeyError(`❌ Invalid ${provider.name} key format. Must start with "${provider.prefix}"`);
        }
      }
    } else if (key.backspace || key.delete) {
      setCurrentKeyValue(prev => prev.slice(0, -1));
    } else if (char && !key.ctrl && !key.meta) {
      setCurrentKeyValue(prev => prev + char);
      setKeyError(null); // Clear errors while writing
    }
  };

  // On entering Cloud Summary, sync to SQLite database
  useEffect(() => {
    if (step === "CLOUD_SUMMARY") {
      // 1. Save all keys to settings
      setSetting("ANTHROPIC_API_KEY", apiKeys.ANTHROPIC_API_KEY);
      setSetting("OPENAI_API_KEY", apiKeys.OPENAI_API_KEY);
      setSetting("DEEPSEEK_API_KEY", apiKeys.DEEPSEEK_API_KEY);
      setSetting("GEMINI_API_KEY", apiKeys.GEMINI_API_KEY);
      setSetting("GROK_API_KEY", apiKeys.GROK_API_KEY);

      // 2. Select best cloud model
      let bestModel = "claude-3-5-sonnet-20241022";
      if (apiKeys.ANTHROPIC_API_KEY) {
        bestModel = "claude-3-5-sonnet-20241022";
      } else if (apiKeys.OPENAI_API_KEY) {
        bestModel = "gpt-4o";
      } else if (apiKeys.DEEPSEEK_API_KEY) {
        bestModel = "deepseek-chat";
      } else if (apiKeys.GEMINI_API_KEY) {
        bestModel = "gemini-1.5-pro";
      } else if (apiKeys.GROK_API_KEY) {
        bestModel = "grok-beta";
      }

      if (targetMode === "hybrid") {
        setSetting("LLM_PROVIDER", "hybrid");
        // Keep the local model pulled in 3A as DEFAULT_MODEL
      } else {
        setSetting("LLM_PROVIDER", "cloud");
        setSetting("DEFAULT_MODEL", bestModel);
      }
    }
  }, [step]);

  const handleFinishSetup = () => {
    setSetting("SETUP_COMPLETE", "true");
    onComplete();
  };

  // ─── Central Keyboard Input Dispatcher ──────────────────────────────────────────
  useInput((input, key) => {
    // Graceful exit
    if (key.ctrl && input === "c") {
      process.exit(0);
    }

    if (step === "WELCOME") {
      if (key.return) {
        setStep("CHOOSE_MODE");
      }
    } else if (step === "CHOOSE_MODE") {
      if (key.upArrow) {
        setSelectedMode(prev => (prev === 0 ? 2 : prev - 1));
      } else if (key.downArrow) {
        setSelectedMode(prev => (prev === 2 ? 0 : prev + 1));
      } else if (key.return) {
        handleConfirmMode();
      }
    } else if (step === "LOCAL_OLLAMA_WARNING") {
      if (input.toLowerCase() === "r") {
        retryOllamaConnection();
      } else if (input.toLowerCase() === "s") {
        skipOllamaDownload();
      }
    } else if (step === "LOCAL_RECOMMEND") {
      if (input.toLowerCase() === "y") {
        startLocalDownload();
      } else if (input.toLowerCase() === "n") {
        skipLocalDownload();
      } else if (key.leftArrow || key.rightArrow) {
        setDownloadChoice(prev => (prev === "Y" ? "N" : "Y"));
      } else if (key.return) {
        if (downloadChoice === "Y") {
          startLocalDownload();
        } else {
          skipLocalDownload();
        }
      }
    } else if (step === "LOCAL_DOWNLOAD_ERROR") {
      if (input.toLowerCase() === "r") {
        startLocalDownload();
      } else if (input.toLowerCase() === "s") {
        skipLocalDownload();
      }
    } else if (step === "CLOUD_KEYS") {
      handleCloudKeyInput(input, key);
    } else if (step === "CLOUD_SUMMARY") {
      if (key.return) {
        setStep("FINAL_SCREEN");
      }
    } else if (step === "FINAL_SCREEN") {
      if (key.return) {
        handleFinishSetup();
      }
    }
  });

  // ─── Render Progress Bar Utility ───────────────────────────────────────────────
  const renderProgressBar = (percent: number, completed: number, total: number) => {
    const totalBlocks = 12;
    const filledBlocks = Math.round((percent / 100) * totalBlocks);
    const emptyBlocks = Math.max(0, totalBlocks - filledBlocks);
    const bar = "█".repeat(filledBlocks) + "░".repeat(emptyBlocks);

    const completedGB = completed > 0 ? (completed / (1024 * 1024 * 1024)).toFixed(1) : "0.0";
    const totalGB = total > 0 ? (total / (1024 * 1024 * 1024)).toFixed(1) : "0.0";

    return `[${bar}] ${percent}% — ${completedGB}GB / ${totalGB}GB`;
  };

  // ─── Step Render Functions ──────────────────────────────────────────────────────

  const renderWelcome = () => {
    const banner = figlet.textSync("CREATER", { font: "Standard" });
    const bannerStr = gradient(["cyan", "magenta", "cyanBright"]).multiline(banner);

    return (
      <Box flexDirection="column" alignItems="center" borderStyle="double" borderColor="cyan" padding={2} width={70}>
        <Text>{bannerStr}</Text>
        <Box marginTop={1} marginBottom={1}>
          <Text bold color="yellow">Your Personal AI Super Intelligence</Text>
        </Box>
        <Box borderStyle="round" borderColor="gray" paddingX={2}>
          <Text color="cyanBright">Press Enter to begin setup →</Text>
        </Box>
      </Box>
    );
  };

  const renderChooseMode = () => {
    const modes = [
      { id: 0, label: "🏠 Local (Ollama)", desc: "Private & Offline (Runs on your machine)" },
      { id: 1, label: "☁️  Cloud (API Keys)", desc: "Faster & Powerful (Uses Anthropic, OpenAI, etc.)" },
      { id: 2, label: "🔀 Hybrid", desc: "Local + Cloud Fallback (Best of both worlds)" }
    ];

    return (
      <Box flexDirection="column" borderStyle="round" borderColor="magenta" padding={1} width={70}>
        <Box marginBottom={1} justifyContent="center">
          <Text bold color="magenta">✨ CHOOSE YOUR AI MODE ✨</Text>
        </Box>
        <Box marginBottom={1}>
          <Text color="gray" dimColor>Use Up/Down Arrow keys to select your preferred setup:</Text>
        </Box>
        {modes.map(m => {
          const isSelected = selectedMode === m.id;
          return (
            <Box key={m.id} flexDirection="column" marginY={0.5} paddingLeft={2}>
              <Box>
                <Text bold={isSelected} color={isSelected ? "cyanBright" : "white"}>
                  {isSelected ? "➔ " : "  "} {m.label}
                </Text>
              </Box>
              <Box paddingLeft={4}>
                <Text color="gray" italic={isSelected}>{m.desc}</Text>
              </Box>
            </Box>
          );
        })}
        <Box marginTop={1} borderStyle="single" borderColor="gray" paddingX={1}>
          <Text color="yellow">Press [Enter] to confirm selection</Text>
        </Box>
      </Box>
    );
  };

  const renderLocalScanning = () => {
    return (
      <Box flexDirection="column" borderStyle="round" borderColor="yellow" padding={2} width={70} alignItems="center">
        <Text color="yellow" bold>🔍 Scanning your hardware...</Text>
        <Box marginTop={1}>
          <Text color="cyan">
            <Spinner type="dots" /> Analyzing system memory, CPU cores, and GPU properties...
          </Text>
        </Box>
      </Box>
    );
  };

  const renderOllamaWarning = () => {
    return (
      <Box flexDirection="column" borderStyle="round" borderColor="red" padding={1} width={70}>
        <Box marginBottom={1} justifyContent="center">
          <Text bold color="red">⚠️  OLLAMA IS NOT RUNNING! ⚠️</Text>
        </Box>
        <Box padding={1} borderStyle="single" borderColor="red" marginBottom={1}>
          <Text color="yellow">Creater needs Ollama to run local models.</Text>
          <Newline />
          <Text color="white">Please start the Ollama service on your machine:</Text>
          <Text color="cyan" bold>  • Run: ollama serve (in a separate terminal)</Text>
          <Text color="cyan" bold>  • Or: Open the Ollama Desktop App</Text>
        </Box>
        {keyError && (
          <Box marginBottom={1} paddingLeft={1}>
            <Text color="red" bold>{keyError}</Text>
          </Box>
        )}
        <Box flexDirection="column" paddingLeft={2}>
          <Text color="greenBright" bold>Press [R] to retry checking Ollama connection</Text>
          <Text color="gray">Press [S] to skip download and continue anyway</Text>
        </Box>
      </Box>
    );
  };

  const renderLocalRecommend = () => {
    const modelSizes: Record<string, string> = {
      "qwen2.5:14b": "~9.0GB",
      "qwen2.5:7b": "~4.7GB",
      "qwen2.5:3b": "~2.0GB",
      "tinyllama:1.1b": "~637MB"
    };
    const size = modelSizes[recommendedModel] || "~2.3GB";

    return (
      <Box flexDirection="column" borderStyle="round" borderColor="green" padding={1} width={70}>
        <Box marginBottom={1} justifyContent="center">
          <Text bold color="green">💻 SYSTEM HARDWARE SCAN COMPLETED 💻</Text>
        </Box>

        <Box flexDirection="column" marginBottom={1} paddingLeft={2}>
          <Text color="white">RAM Detected: <Text color="cyan" bold>{hardwareInfo.ram} GB</Text></Text>
          <Text color="white">CPU Cores: <Text color="cyan" bold>{hardwareInfo.cores} cores</Text> ({hardwareInfo.cpuBrand})</Text>
          <Text color="white">GPU VRAM: <Text color="cyan" bold>{hardwareInfo.vram > 0 ? `${hardwareInfo.vram} GB` : "No dedicated GPU detected"}</Text></Text>
        </Box>

        <Box borderStyle="single" borderColor="green" padding={1} marginBottom={1}>
          <Text bold color="greenBright">✅ Recommended Ollama Model: {recommendedModel}</Text>
          <Newline />
          <Text color="gray">
            {recommendedModel === "qwen2.5:14b" && "→ High quality reasoning. Best for powerful developers."}
            {recommendedModel === "qwen2.5:7b" && "→ Balanced quality and speed. Great all-rounder model."}
            {recommendedModel === "qwen2.5:3b" && "→ Extremely fast classification and light chat on standard specs."}
            {recommendedModel === "tinyllama:1.1b" && "→ Ultra-lightweight model designed for low-memory environments."}
          </Text>
        </Box>

        <Box flexDirection="row" marginY={1}>
          <Text color="yellow">📥 Download {recommendedModel} now? ({size}) </Text>
          <Box marginLeft={2} flexDirection="row">
            <Box>
              <Text bold color={downloadChoice === "Y" ? "green" : "white"}>
                {downloadChoice === "Y" ? "➔ [Yes]" : "   [Yes]"}
              </Text>
            </Box>
            <Box marginLeft={2}>
              <Text bold color={downloadChoice === "N" ? "red" : "white"}>
                {downloadChoice === "N" ? "➔ [No, Skip]" : "   [No, Skip]"}
              </Text>
            </Box>
          </Box>
        </Box>
        <Text color="gray" dimColor>Use Left/Right Arrows to toggle. Press Enter to confirm.</Text>
      </Box>
    );
  };

  const renderDownloading = () => {
    return (
      <Box flexDirection="column" borderStyle="round" borderColor="cyan" padding={2} width={70}>
        <Text bold color="cyan">📥 DOWNLOADING LOCAL MODEL</Text>
        <Text color="gray" dimColor>Pulling {recommendedModel} from Ollama Library...</Text>

        <Box marginTop={1} marginBottom={1} flexDirection="column">
          <Text color="white">{downloadStatus}</Text>
          <Box marginTop={0.5}>
            <Text bold color="cyanBright">
              {renderProgressBar(downloadPercent, downloadBytes.completed, downloadBytes.total)}
            </Text>
          </Box>
        </Box>
        <Box>
          <Text color="yellow">
            <Spinner type="arc" /> Downloading... please wait. Do not close this terminal.
          </Text>
        </Box>
      </Box>
    );
  };

  const renderDownloadError = () => {
    return (
      <Box flexDirection="column" borderStyle="round" borderColor="red" padding={1} width={70}>
        <Text bold color="red">❌ MODEL DOWNLOAD FAILED</Text>
        <Box marginY={1} padding={1} borderStyle="single" borderColor="red">
          <Text color="white">{keyError || "An unknown error occurred while communicating with Ollama."}</Text>
        </Box>
        <Box flexDirection="column" paddingLeft={2}>
          <Text color="cyan" bold>Press [R] to retry download</Text>
          <Text color="gray">Press [S] to skip download and continue</Text>
        </Box>
      </Box>
    );
  };

  const renderCloudKeys = () => {
    const provider = CLOUD_PROVIDERS[cloudSubstep]!;

    const maskKey = (str: string) => {
      if (str.length === 0) return "";
      if (str.length <= 8) return str;
      return str.slice(0, 8) + "*".repeat(str.length - 8);
    };

    const displayVal = maskKey(currentKeyValue);

    return (
      <Box flexDirection="column" borderStyle="round" borderColor="magenta" padding={1} width={70}>
        <Box marginBottom={1} justifyContent="space-between">
          <Text bold color="magenta">🔑 CLOUD PROVIDER SETUP ({cloudSubstep + 1}/5)</Text>
          <Text color="gray">Step 3B</Text>
        </Box>

        <Text color="white" bold>{provider.name} API Key Setup</Text>
        <Box marginBottom={1}>
          <Text color="gray" dimColor>Required format prefix: "{provider.prefix}"</Text>
        </Box>

        <Box borderStyle="single" borderColor="gray" paddingX={1} marginY={1}>
          <Box marginRight={1}>
            <Text color="cyan">❯ {provider.name} Key: </Text>
          </Box>
          <Box flexGrow={1}>
            {currentKeyValue.length === 0 ? (
              <Text color="gray" dimColor>Type key here (or press Enter to skip)</Text>
            ) : (
              <Box>
                <Text color="yellowBright">{displayVal}</Text>
                <Text color="cyan">█</Text>
              </Box>
            )}
          </Box>
        </Box>

        {keyError && (
          <Box marginBottom={1}>
            <Text color="red" bold>{keyError}</Text>
          </Box>
        )}

        <Box marginTop={1} flexDirection="column">
          <Text color="gray" dimColor>• Type key characters normally. Press Backspace to delete.</Text>
          <Text color="gray" dimColor>• Press Enter to save and validate.</Text>
          <Text color="gray" dimColor>• Press Enter on an empty input to skip this provider.</Text>
        </Box>
      </Box>
    );
  };

  const renderCloudSummary = () => {
    return (
      <Box flexDirection="column" borderStyle="round" borderColor="green" padding={1} width={70}>
        <Box marginBottom={1} justifyContent="center">
          <Text bold color="green">☁️  CLOUD CONFIGURATION SUMMARY ☁️</Text>
        </Box>

        <Box flexDirection="column" marginY={1} paddingLeft={2}>
          {CLOUD_PROVIDERS.map(p => {
            const isConfigured = !!apiKeys[p.stateKey as keyof typeof apiKeys];
            return (
              <Box key={p.stateKey} marginY={0.2}>
                <Text color={isConfigured ? "greenBright" : "gray"}>
                  {isConfigured ? "✅ " : "❌ "} {p.name} ─── {isConfigured ? "Configured" : "Skipped"}
                </Text>
              </Box>
            );
          })}
        </Box>

        <Box borderStyle="single" borderColor="green" padding={1} marginY={1}>
          <Text color="yellow" bold>⚙️ Selected default cloud model: </Text>
          <Text color="white" bold>
            {apiKeys.ANTHROPIC_API_KEY && "claude-3-5-sonnet-20241022 (Anthropic)"}
            {!apiKeys.ANTHROPIC_API_KEY && apiKeys.OPENAI_API_KEY && "gpt-4o (OpenAI)"}
            {!apiKeys.ANTHROPIC_API_KEY && !apiKeys.OPENAI_API_KEY && apiKeys.DEEPSEEK_API_KEY && "deepseek-chat (DeepSeek)"}
            {!apiKeys.ANTHROPIC_API_KEY && !apiKeys.OPENAI_API_KEY && !apiKeys.DEEPSEEK_API_KEY && apiKeys.GEMINI_API_KEY && "gemini-1.5-pro (Gemini)"}
            {!apiKeys.ANTHROPIC_API_KEY && !apiKeys.OPENAI_API_KEY && !apiKeys.DEEPSEEK_API_KEY && !apiKeys.GEMINI_API_KEY && apiKeys.GROK_API_KEY && "grok-beta (Grok)"}
            {!apiKeys.ANTHROPIC_API_KEY && !apiKeys.OPENAI_API_KEY && !apiKeys.DEEPSEEK_API_KEY && !apiKeys.GEMINI_API_KEY && !apiKeys.GROK_API_KEY && "claude-3-5-sonnet-20241022 (Default)"}
          </Text>
        </Box>

        <Box marginTop={1}>
          <Text color="cyanBright">Press Enter to continue to final screen →</Text>
        </Box>
      </Box>
    );
  };

  const renderFinalScreen = () => {
    const modeNames = {
      local: "Local Only",
      cloud: "Cloud Only",
      hybrid: "Hybrid Mode"
    };

    const activeMode = modeNames[targetMode] || "Local";

    let modelNameText = "None";
    if (targetMode === "local" || targetMode === "hybrid") {
      modelNameText = `${recommendedModel} (Local)`;
    } else {
      if (apiKeys.ANTHROPIC_API_KEY) modelNameText = "claude-3-5-sonnet-20241022 (Cloud)";
      else if (apiKeys.OPENAI_API_KEY) modelNameText = "gpt-4o (Cloud)";
      else if (apiKeys.DEEPSEEK_API_KEY) modelNameText = "deepseek-chat (Cloud)";
      else if (apiKeys.GEMINI_API_KEY) modelNameText = "gemini-1.5-pro (Cloud)";
      else if (apiKeys.GROK_API_KEY) modelNameText = "grok-beta (Cloud)";
      else modelNameText = "claude-3-5-sonnet-20241022 (Default)";
    }

    const anthropicConf = apiKeys.ANTHROPIC_API_KEY ? "✅" : "❌";
    const openaiConf = apiKeys.OPENAI_API_KEY ? "✅" : "❌";
    const deepseekConf = apiKeys.DEEPSEEK_API_KEY ? "✅" : "❌";
    const geminiConf = apiKeys.GEMINI_API_KEY ? "✅" : "❌";
    const grokConf = apiKeys.GROK_API_KEY ? "✅" : "❌";

    return (
      <Box flexDirection="column" borderStyle="double" borderColor="green" padding={2} width={70} alignItems="center">
        <Text bold color="greenBright">🎉 CREATER IS READY! 🎉</Text>
        <Box marginTop={1} marginBottom={1} flexDirection="column" alignItems="center">
          <Text color="yellow">Setup has been successfully completed!</Text>
          <Text color="gray">Your settings have been saved to the database.</Text>
        </Box>

        <Box borderStyle="single" borderColor="gray" flexDirection="column" paddingX={2} paddingY={1} width={60}>
          <Box justifyContent="space-between">
            <Text color="cyan">Mode:</Text>
            <Text color="white" bold>{activeMode}</Text>
          </Box>
          <Box justifyContent="space-between" marginTop={0.5}>
            <Text color="cyan">Model:</Text>
            <Text color="white" bold>{modelNameText}</Text>
          </Box>
          <Box justifyContent="space-between" marginTop={0.5}>
            <Text color="cyan">Cloud Integration:</Text>
            <Text color="white">
              Ant {anthropicConf} | OpenAI {openaiConf} | Deep {deepseekConf} | Gem {geminiConf} | Grok {grokConf}
            </Text>
          </Box>
        </Box>

        <Box marginTop={2} borderStyle="round" borderColor="yellow" paddingX={3}>
          <Text color="yellow" bold>Press Enter to start chatting →</Text>
        </Box>
      </Box>
    );
  };

  // Main UI router
  switch (step) {
    case "WELCOME":
      return renderWelcome();
    case "CHOOSE_MODE":
      return renderChooseMode();
    case "LOCAL_SCANNING":
      return renderLocalScanning();
    case "LOCAL_OLLAMA_WARNING":
      return renderOllamaWarning();
    case "LOCAL_RECOMMEND":
      return renderLocalRecommend();
    case "LOCAL_DOWNLOADING":
      return renderDownloading();
    case "LOCAL_DOWNLOAD_ERROR":
      return renderDownloadError();
    case "CLOUD_KEYS":
      return renderCloudKeys();
    case "CLOUD_SUMMARY":
      return renderCloudSummary();
    case "FINAL_SCREEN":
      return renderFinalScreen();
    default:
      return renderWelcome();
  }
}
