import { describe, expect, it } from "vitest";
import { GUIDE_TOPICS, guideTopic, guideTopicHtml } from "./guide";

describe("guide", () => {
  it("has unique short ids that fit Telegram callback data", () => {
    const ids = GUIDE_TOPICS.map(t => t.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids.every(id => `g:${id}`.length <= 64)).toBe(true);
  });

  it("renders every topic within the Telegram message limit", () => {
    for (const topic of GUIDE_TOPICS) {
      const html = guideTopicHtml(topic);
      expect(html.length).toBeLessThan(4000);
      expect(topic.how.length).toBeGreaterThan(0);
    }
    expect(guideTopic("today")?.title).toContain("Можно потратить");
    expect(guideTopic("nope")).toBeNull();
  });
});
