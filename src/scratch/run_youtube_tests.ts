import { routeFastCommand, parseYouTubeCommand } from "../graph/commandRouter.js";

function assertEqual(actual: any, expected: any, testName: string) {
  const actualStr = JSON.stringify(actual);
  const expectedStr = JSON.stringify(expected);
  if (actualStr === expectedStr) {
    console.log(`✅ PASS: ${testName}`);
  } else {
    console.error(`❌ FAIL: ${testName}\n   Actual:   ${actualStr}\n   Expected: ${expectedStr}`);
    process.exitCode = 1;
  }
}

console.log("Running Phase 1.1 YouTube PLAY vs SEARCH Unit Tests...\n");

// Command A
assertEqual(
  routeFastCommand("play first video which you see on youtube of hustle 5"),
  { kind: "youtube", raw: "play first video which you see on youtube of hustle 5", action: "play", query: "hustle 5", selection: "first" },
  "Command A: 'play first video which you see on youtube of hustle 5'"
);

// Command B
assertEqual(
  routeFastCommand("play the first video you see on youtube of hustle 5"),
  { kind: "youtube", raw: "play the first video you see on youtube of hustle 5", action: "play", query: "hustle 5", selection: "first" },
  "Command B: 'play the first video you see on youtube of hustle 5'"
);

// Command C
assertEqual(
  routeFastCommand("youtube pe hustle 5 ki first video chala"),
  { kind: "youtube", raw: "youtube pe hustle 5 ki first video chala", action: "play", query: "hustle 5", selection: "first" },
  "Command C: 'youtube pe hustle 5 ki first video chala'"
);

// Command D
assertEqual(
  routeFastCommand("play first hustle 5 video on youtube"),
  { kind: "youtube", raw: "play first hustle 5 video on youtube", action: "play", query: "hustle 5", selection: "first" },
  "Command D: 'play first hustle 5 video on youtube'"
);

// Command E
assertEqual(
  routeFastCommand("hustle 5 ki video chala"),
  { kind: "youtube", raw: "hustle 5 ki video chala", action: "play", query: "hustle 5", selection: "first" },
  "Command E: 'hustle 5 ki video chala'"
);

// Command F
assertEqual(
  routeFastCommand("play CarryMinati video"),
  { kind: "youtube", raw: "play CarryMinati video", action: "play", query: "CarryMinati", selection: "first" },
  "Command F: 'play CarryMinati video'"
);

// SEARCH tests
assertEqual(
  routeFastCommand("search hustle 5 videos on youtube"),
  { kind: "youtube", raw: "search hustle 5 videos on youtube", action: "search", query: "hustle 5" },
  "SEARCH 1: 'search hustle 5 videos on youtube'"
);

assertEqual(
  routeFastCommand("find CarryMinati videos on youtube"),
  { kind: "youtube", raw: "find CarryMinati videos on youtube", action: "search", query: "CarryMinati" },
  "SEARCH 2: 'find CarryMinati videos on youtube'"
);

// Hinglish & Quoted variations
assertEqual(
  parseYouTubeCommand("youtube par Hustle 5 ka pehla video chala"),
  { action: "play", query: "Hustle 5", selection: "first" },
  "Hinglish: 'youtube par Hustle 5 ka pehla video chala'"
);

assertEqual(
  parseYouTubeCommand("Hustle 5 ki sabse pehli video play kar"),
  { action: "play", query: "Hustle 5", selection: "first" },
  "Hinglish: 'Hustle 5 ki sabse pehli video play kar'"
);

assertEqual(
  parseYouTubeCommand('play "Hustle 5 first video"'),
  { action: "play", query: "Hustle 5 first video", selection: "first" },
  "Quoted query: 'play \"Hustle 5 first video\"'"
);

console.log("\nAll Phase 1.1 YouTube unit tests completed successfully.");
