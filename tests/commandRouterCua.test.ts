import { describe, it, expect } from "bun:test";
import { routeFastCommand, parseAppComposeCommand } from "../src/graph/commandRouter";
import { classifyRuntimeMode } from "../src/runtime/RuntimeModeClassifier";

describe("CUA Fast Command & Runtime Routing", () => {
  it("routes 'what is currently open on my screen?' to active_window fast command", () => {
    const cmd = routeFastCommand("what is currently open on my screen?");
    expect(cmd).not.toBeNull();
    expect(cmd?.kind).toBe("active_window");

    const mode = classifyRuntimeMode("what is currently open on my screen?");
    expect(mode.mode).toBe("execution");
    expect(mode.targetAgent).toBe("laptopAgent");
  });

  it("routes Hindi/Hinglish screen questions", () => {
    const cmd1 = routeFastCommand("screen pe kya chal raha hai");
    expect(cmd1?.kind).toBe("active_window");

    const cmd2 = routeFastCommand("inspect active window");
    expect(cmd2?.kind).toBe("active_window");

    const cmd3 = routeFastCommand("what's on my screen?");
    expect(cmd3?.kind).toBe("active_window");
  });

  it("routes CUA click and type commands", () => {
    const clickCmd = routeFastCommand("click at 400 300");
    expect(clickCmd?.kind).toBe("cua_click");
    if (clickCmd?.kind === "cua_click") {
      expect(clickCmd.x).toBe(400);
      expect(clickCmd.y).toBe(300);
    }

    const typeCmd = routeFastCommand("type Hello Rachit into notepad");
    expect(typeCmd?.kind).toBe("cua_type");
    if (typeCmd?.kind === "cua_type") {
      expect(typeCmd.text).toBe("Hello Rachit");
      expect(typeCmd.targetApp).toBe("notepad");
    }
  });

  it("routes MCP server list commands", () => {
    const mcpCmd = routeFastCommand("list all mcp servers");
    expect(mcpCmd?.kind).toBe("mcp_list");
  });

  it("routes compound generate-and-write Notepad commands to execution / laptopAgent", () => {
    // Exact user failing phrase (including typos "ell me" and "bin notepad")
    const userPrompt = "ell me what things you can do it now and write it bin notepad now";
    const cmd1 = routeFastCommand(userPrompt);
    expect(cmd1?.kind).toBe("app_compose");
    if (cmd1?.kind === "app_compose") {
      expect(cmd1.app).toBe("notepad");
      expect(cmd1.mode).toBe("generate");
      expect(cmd1.prompt).toBe("tell me what things you can do");
    }

    const mode1 = classifyRuntimeMode(userPrompt);
    expect(mode1.mode).toBe("execution");
    expect(mode1.targetAgent).toBe("laptopAgent");

    // Normalized form passed by supervisor
    const cmdNormalized = routeFastCommand(mode1.normalizedInput);
    expect(cmdNormalized?.kind).toBe("app_compose");

    // Hinglish variations
    const cmdHindi = routeFastCommand("apni capabilities batao aur usse sidhe notepad me likh de");
    expect(cmdHindi?.kind).toBe("app_compose");
    if (cmdHindi?.kind === "app_compose") {
      expect(cmdHindi.app).toBe("notepad");
      expect(cmdHindi.mode).toBe("generate");
      expect(cmdHindi.prompt).toBe("apni capabilities batao");
    }

    const cmdHindi2 = routeFastCommand("apni capabilities likh do notepad me");
    expect(cmdHindi2?.kind).toBe("app_compose");
    if (cmdHindi2?.kind === "app_compose") {
      expect(cmdHindi2.app).toBe("notepad");
      expect(cmdHindi2.mode).toBe("generate");
    }

    // Open-notepad-first generative and literal commands
    const cmdOpenGen = routeFastCommand("open notepad and write a short poem on coding");
    expect(cmdOpenGen?.kind).toBe("app_compose");
    if (cmdOpenGen?.kind === "app_compose") {
      expect(cmdOpenGen.app).toBe("notepad");
      expect(cmdOpenGen.mode).toBe("generate");
    }

    const cmdOpenLit = routeFastCommand('open notepad and write "Hello, Rachit!"');
    expect(cmdOpenLit?.kind).toBe("app_compose");
    if (cmdOpenLit?.kind === "app_compose") {
      expect(cmdOpenLit.app).toBe("notepad");
      expect(cmdOpenLit.mode).toBe("literal");
      expect(cmdOpenLit.text).toBe("Hello, Rachit!");
    }

    // Follow-up referential write ("write it in notepad")
    const cmdFollow = routeFastCommand("write it in notepad");
    expect(cmdFollow?.kind).toBe("app_compose");
    if (cmdFollow?.kind === "app_compose") {
      expect(cmdFollow.app).toBe("notepad");
      expect(cmdFollow.mode).toBe("from_history");
    }

    // Negative guards: non-editor targets, idioms, and normal chat remain unaffected
    expect(parseAppComposeCommand("write a function in python")).toBeNull();
    expect(parseAppComposeCommand("describe it in one word")).toBeNull();
    expect(parseAppComposeCommand("tell me what things you can do")).toBeNull();
    expect(parseAppComposeCommand("open notepad")).toBeNull();
  });

  it("generalizes generate-and-write routing across topics, phrasing, and desktop apps", () => {
    const vscodeCmd = routeFastCommand("open vscode and write a typescript debounce function");
    expect(vscodeCmd?.kind).toBe("app_compose");
    if (vscodeCmd?.kind === "app_compose") {
      expect(vscodeCmd.app).toBe("vscode");
      expect(vscodeCmd.mode).toBe("generate");
    }

    const wordCmd = routeFastCommand("draft a cover letter for backend engineer in word");
    expect(wordCmd?.kind).toBe("app_compose");
    if (wordCmd?.kind === "app_compose") {
      expect(wordCmd.app).toBe("word");
      expect(wordCmd.mode).toBe("generate");
    }

    const hinglishTopicCmd = routeFastCommand("notepad me cricket ke baare me kuch interesting likho");
    expect(hinglishTopicCmd?.kind).toBe("app_compose");
    if (hinglishTopicCmd?.kind === "app_compose") {
      expect(hinglishTopicCmd.app).toBe("notepad");
      expect(hinglishTopicCmd.mode).toBe("generate");
    }

    const obsidianCmd = routeFastCommand("explain closures and save it in obsidian");
    expect(obsidianCmd?.kind).toBe("app_compose");
    if (obsidianCmd?.kind === "app_compose") {
      expect(obsidianCmd.app).toBe("obsidian");
      expect(obsidianCmd.mode).toBe("generate");
      expect(obsidianCmd.prompt).toBe("explain closures");
    }

    const stickyCmd = routeFastCommand("apni capabilities likh do sticky notes me");
    expect(stickyCmd?.kind).toBe("app_compose");
    if (stickyCmd?.kind === "app_compose") {
      expect(stickyCmd.app).toBe("sticky notes");
      expect(stickyCmd.mode).toBe("generate");
    }

    const typePoemCmd = routeFastCommand("type a short poem on rain into notepad");
    expect(typePoemCmd?.kind).toBe("app_compose");
    if (typePoemCmd?.kind === "app_compose") {
      expect(typePoemCmd.app).toBe("notepad");
      expect(typePoemCmd.mode).toBe("generate");
    }

    const openLiteralCmd = routeFastCommand("open notepad and write Hello World");
    expect(openLiteralCmd?.kind).toBe("app_compose");
    if (openLiteralCmd?.kind === "app_compose") {
      expect(openLiteralCmd.app).toBe("notepad");
      expect(openLiteralCmd.mode).toBe("literal");
      expect(openLiteralCmd.text).toBe("Hello World");
    }

    // Ensure social/web commands are never hijacked by app_compose
    expect(parseAppComposeCommand("open linkedin and message to ojas -hello")).toBeNull();
    expect(classifyRuntimeMode("draft a cover letter for backend engineer in word").targetAgent).toBe("laptopAgent");
  });
});

