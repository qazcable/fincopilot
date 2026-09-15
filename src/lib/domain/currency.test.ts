import { afterEach, describe, expect, it } from "vitest";
import { convertMinor, parseNbkRss } from "./currency";
import { formatApprox, formatMoney, setCurrencyResolver } from "./money";

const rss = `<rss><channel>
  <item><title>USD</title><pubDate>15.09.2026</pubDate><description>486.12</description><quant>1</quant><index>UP</index><change>1.5</change></item>
  <item><title>RUB</title><pubDate>15.09.2026</pubDate><description>5.9</description><quant>1</quant><index>DOWN</index><change>-0.02</change></item>
  <item><title>AMD</title><pubDate>15.09.2026</pubDate><description>12.4</description><quant>10</quant><index></index><change>0</change></item>
  <item><title>bad</title><description>x</description></item>
</channel></rss>`;

describe("NBK rates", () => {
  it("parses rates per unit and the date", () => {
    const { date, rates } = parseNbkRss(rss);
    expect(date).toBe("2026-09-15");
    expect(rates).toHaveLength(3);
    expect(rates[0]).toEqual({ code: "USD", rate: 486.12, change: 1.5, direction: "UP" });
    expect(rates[2]).toMatchObject({ code: "AMD", rate: 1.24, direction: "SAME" });
  });

  it("converts through tenge", () => {
    const { rates } = parseNbkRss(rss);
    // 48 612 ₸ → 100 $
    expect(convertMinor(4_861_200, "KZT", "USD", rates)).toBe(10_000);
    expect(convertMinor(10_000, "USD", "KZT", rates)).toBe(4_861_200);
    // 100 $ → рубли через тенге
    expect(convertMinor(10_000, "USD", "RUB", rates)).toBe(Math.round((10_000 * 486.12) / 5.9));
    expect(convertMinor(100, "KZT", "JPY", rates)).toBeNull();
    expect(convertMinor(100, "EUR", "EUR", rates)).toBe(100);
  });
});

const plain = (text: string) => text.replace(/ /g, " ");

describe("formatMoney currency", () => {
  afterEach(() => setCurrencyResolver(() => null));

  it("uses the user's currency by default and an explicit one when given", () => {
    expect(plain(formatMoney(120_000))).toBe("1 200 ₸");
    setCurrencyResolver(() => "USD");
    expect(plain(formatMoney(120_050))).toBe("1 200,50 $");
    expect(plain(formatMoney(120_000, { currency: "EUR" }))).toBe("1 200 €");
    expect(plain(formatMoney(120_000, { currency: false }))).toBe("1 200");
    expect(plain(formatApprox(8_512, "USD"))).toBe("≈ 85,12 $");
  });
});
