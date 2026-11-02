import { describe, expect, it } from "vitest";
import { divisors, families, frac, fracCmp, fracEq, gcd, isPrime, lcm, parseFrac, smallestFamily, toRoman, toWords } from "./numbers";

describe("number helpers", () => {
  it("gcd, lcm and divisors agree with brute force", () => {
    for (let a = 1; a <= 60; a++) {
      expect(divisors(a)).toEqual(Array.from({ length: a }, (_, i) => i + 1).filter((d) => a % d === 0));
      for (let b = 1; b <= 30; b++) {
        const g = gcd(a, b);
        expect(a % g).toBe(0);
        expect(b % g).toBe(0);
        expect(lcm(a, b) * g).toBe(a * b);
      }
    }
  });

  it("finds exactly 25 primes below 100", () => {
    expect(Array.from({ length: 100 }, (_, i) => i).filter(isPrime)).toHaveLength(25);
    expect(isPrime(1)).toBe(false);
    expect(isPrime(91)).toBe(false);
  });

  it("writes Roman numerals and English words", () => {
    expect(toRoman(1994)).toBe("MCMXCIV");
    expect(toRoman(0)).toBeNull();
    expect(toWords(0)).toBe("zero");
    expect(toWords(305)).toBe("three hundred and five");
    expect(toWords(2049)).toBe("two thousand and forty-nine");
    expect(toWords(4072)).toBe("four thousand and seventy-two");
  });

  it("parses fractions and decimals exactly", () => {
    expect(parseFrac("3/4")).toEqual({ n: 3, d: 4 });
    expect(parseFrac("0.75")).toEqual({ n: 3, d: 4 });
    expect(parseFrac("-2/4")).toEqual({ n: -1, d: 2 });
    expect(parseFrac("1/0")).toBeNull();
    expect(fracEq(frac(2, 4), frac(1, 2))).toBe(true);
    expect(fracCmp(frac(1, 8), frac(1, 4))).toBe(-1);
  });

  it("classifies numbers into nested families (N starts at 1)", () => {
    expect(families(frac(7))).toEqual(["natural", "whole", "integers", "rational"]);
    expect(families(frac(0))).toEqual(["whole", "integers", "rational"]);
    expect(families(frac(-3))).toEqual(["integers", "rational"]);
    expect(families(frac(1, 2))).toEqual(["rational"]);
    expect(smallestFamily(frac(0), ["natural", "whole"])).toBe("whole");
    expect(smallestFamily(frac(-1), ["natural", "whole"])).toBeNull();
  });
});
