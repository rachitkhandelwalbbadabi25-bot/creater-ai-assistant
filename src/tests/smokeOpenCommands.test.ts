import { describe, expect, test } from "bun:test";
import { directMappings } from "../graph/laptopAgent.js";

describe('Direct Mappings', () => {
  test('all required shortcuts resolve to expected URLs', () => {
    const expected: Record<string, string> = {
      gmail: 'https://mail.google.com',
      youtube: 'https://www.youtube.com',
      github: 'https://github.com',
      chatgpt: 'https://chat.openai.com',
      linkedin: 'https://www.linkedin.com',
      twitter: 'https://twitter.com',
      x: 'https://twitter.com',
    };
    for (const [key, url] of Object.entries(expected)) {
      expect(directMappings[key]).toBe(url);
    }
  });
});
