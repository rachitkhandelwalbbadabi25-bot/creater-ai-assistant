import { describe, test, expect } from "bun:test";
import { routeFastCommand, parseYouTubeCommand } from "../src/graph/commandRouter.js";

describe("Phase 1 — YouTube PLAY vs SEARCH Command Routing Tests", () => {
  test("Test 1: 'play Hustle 5 video' produces PLAY with query 'Hustle 5'", () => {
    const res = routeFastCommand("play Hustle 5 video");
    expect(res).toEqual({
      kind: "youtube",
      raw: "play Hustle 5 video",
      action: "play",
      query: "Hustle 5",
      selection: "first",
    });
  });

  test("Test 2: 'Hustle 5 ki video chala' produces PLAY with query 'Hustle 5'", () => {
    const res = routeFastCommand("Hustle 5 ki video chala");
    expect(res).toEqual({
      kind: "youtube",
      raw: "Hustle 5 ki video chala",
      action: "play",
      query: "Hustle 5",
      selection: "first",
    });
  });

  test("Test 3: 'CarryMinati ka video chala' produces PLAY with query 'CarryMinati'", () => {
    const res = routeFastCommand("CarryMinati ka video chala");
    expect(res).toEqual({
      kind: "youtube",
      raw: "CarryMinati ka video chala",
      action: "play",
      query: "CarryMinati",
      selection: "first",
    });
  });

  test("Test 4: 'search Hustle 5 videos on YouTube' produces SEARCH with query 'Hustle 5'", () => {
    const res = routeFastCommand("search Hustle 5 videos on YouTube");
    expect(res).toEqual({
      kind: "youtube",
      raw: "search Hustle 5 videos on YouTube",
      action: "search",
      query: "Hustle 5",
    });
  });

  test("Test 5: 'find CarryMinati videos on YouTube' produces SEARCH with query 'CarryMinati'", () => {
    const res = routeFastCommand("find CarryMinati videos on YouTube");
    expect(res).toEqual({
      kind: "youtube",
      raw: "find CarryMinati videos on YouTube",
      action: "search",
      query: "CarryMinati",
    });
  });

  test("Test 6: 'play CarryMinati on YouTube' produces PLAY with query 'CarryMinati'", () => {
    const res = routeFastCommand("play CarryMinati on YouTube");
    expect(res).toEqual({
      kind: "youtube",
      raw: "play CarryMinati on YouTube",
      action: "play",
      query: "CarryMinati",
      selection: "first",
    });
  });

  test("Test 7: Direct URL handling remains unchanged", () => {
    const url = "https://youtu.be/mmYHb4RNdJE?si=12345";
    const res = routeFastCommand(url);
    expect(res).toEqual({
      kind: "open_url",
      raw: url,
      url: url,
    });
  });

  test("Additional Hinglish & English command variations", () => {
    expect(parseYouTubeCommand("Hustle 5 ka video chala")).toEqual({ action: "play", query: "Hustle 5", selection: "first" });
    expect(parseYouTubeCommand("Hustle 5 ki video play kar")).toEqual({ action: "play", query: "Hustle 5", selection: "first" });
    expect(parseYouTubeCommand("Hustle 5 ka video play karo")).toEqual({ action: "play", query: "Hustle 5", selection: "first" });
    expect(parseYouTubeCommand("CarryMinati ki video chala")).toEqual({ action: "play", query: "CarryMinati", selection: "first" });
    expect(parseYouTubeCommand("play CarryMinati video")).toEqual({ action: "play", query: "CarryMinati", selection: "first" });
    expect(parseYouTubeCommand("YouTube pe CarryMinati ki video chala")).toEqual({ action: "play", query: "CarryMinati", selection: "first" });
    expect(parseYouTubeCommand("search Hustle 5 videos")).toEqual({ action: "search", query: "Hustle 5" });
    expect(parseYouTubeCommand("show me CarryMinati videos")).toEqual({ action: "search", query: "CarryMinati" });
    expect(parseYouTubeCommand("YouTube search for CarryMinati")).toEqual({ action: "search", query: "CarryMinati" });
  });
});
