/**
 * Tests for practice.ts, the port of backend/app/learning/practice.py.
 *
 * - every generator, over 200 seeds and every parameter set the lessons use: the same keys (in the
 *   same order) and value types as the Python generators, answers recomputed independently from the
 *   prompt, wrong answers really wrong, the right number of correct options, and every `$...$`
 *   segment rendering with KaTeX in strict mode;
 * - byte-for-byte parity with Python: the random draws Python made (recorded in PY_REPLAYS) are
 *   replayed through the port, and the JSON must hash to what Python produced;
 * - the helpers (ports of backend/tests/test_learning.py).
 */
import { createHash } from "node:crypto";
import katex from "katex";
import { describe, expect, it } from "vitest";
import contentJson from "../../standalone/content.json";
import { parseInline, type Inline } from "@/lib/richtext";
import { Fraction } from "./fraction";
import {
  GENERATORS,
  choice,
  divisors,
  fmtList,
  fracTex,
  gcd,
  generate,
  isPrime,
  lcm,
  numTex,
  numberQ,
  pyFormatFixed,
  pyFormatGeneral,
} from "./practice";
import { Random } from "./rng";
import type { ContentJson, Q } from "./types";

const content = contentJson as unknown as ContentJson;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Params = Record<string, any>;

// ---------------------------------------------------------------- what Python produces

/** [id, title, lesson] of every Python generator, in registration order. */
const PY_GENERATORS: [string, string, string][] = [
  ["count-objects", "How many objects?", "l1-counting-objects"],
  ["next-number", "What comes next?", "l1-one-two-three"],
  ["skip-count", "Counting in equal jumps", "l1-equal-groups"],
  ["rows-total", "Equal rows", "l1-equal-groups"],
  ["compare-numbers", "Which symbol?", "l1-bigger-smaller"],
  ["order-numbers", "Put in order", "l1-number-lines"],
  ["number-line-move", "Moving on the number line", "l1-negative-numbers"],
  ["build-number", "Digits and place value", "l1-number-symbols"],
  ["digit-value", "What is this digit worth?", "l1-number-symbols"],
  ["classify-number", "Which families?", "l1-integers"],
  ["fraction-of-shape", "What fraction is shaded?", "l1-fractions"],
  ["equivalent-fraction", "Equivalent fractions", "l1-numerators-denominators"],
  ["compare-fractions", "Which fraction is bigger?", "l1-numerators-denominators"],
  ["fraction-to-decimal", "Fraction to decimal", "l1-decimals"],
  ["decimal-to-fraction", "Decimal to fraction", "l1-decimals"],
  ["percent-of", "Percent of a number", "l1-percentages"],
  ["fraction-to-percent", "Fraction to percent", "l1-percentages"],
  ["ratio-scale", "Scaling a ratio", "l1-ratios"],
  ["is-prime", "Prime or not?", "l1-prime-numbers"],
  ["even-odd", "Even or odd?", "l1-even-odd"],
  ["factor-check", "Which are factors?", "l1-factors"],
  ["count-factors", "How many factors?", "l1-factors"],
  ["is-multiple", "Is it a multiple?", "l1-multiples"],
  ["remainder", "What is left over?", "l1-divisibility"],
  ["divides", "Does it share exactly?", "l1-divisibility"],
  ["gcd", "Greatest common divisor", "l1-greatest-common-divisor"],
  ["lcm", "Least common multiple", "l1-least-common-multiple"],
];

const NUMBER_KEYS = ["type", "kind", "prompt", "answer", "tolerance", "unit", "common_wrong", "explanation", "hint", "visual", "generated_from"];
const CHOICE_KEYS = ["type", "kind", "prompt", "options", "multi", "explanation", "hint", "visual", "generated_from"];
const CHOICE_VISUAL_KEYS = ["type", "kind", "prompt", "options", "multi", "explanation", "visual", "hint", "generated_from"];
const TRUEFALSE_KEYS = ["type", "kind", "prompt", "answer", "diagnosis", "revisit", "explanation", "visual", "hint", "generated_from"];

/** Key order of Python's generate(gid) output (list(q.keys())). */
const PY_KEYS: Record<string, string[]> = {
  "count-objects": NUMBER_KEYS,
  "next-number": NUMBER_KEYS,
  "skip-count": NUMBER_KEYS,
  "rows-total": NUMBER_KEYS,
  "compare-numbers": CHOICE_KEYS,
  "order-numbers": ["type", "kind", "prompt", "items", "order_label", "explanation", "hint", "visual", "generated_from"],
  "number-line-move": NUMBER_KEYS,
  "build-number": NUMBER_KEYS,
  "digit-value": NUMBER_KEYS,
  "classify-number": CHOICE_KEYS,
  "fraction-of-shape": NUMBER_KEYS,
  "equivalent-fraction": NUMBER_KEYS,
  "compare-fractions": CHOICE_VISUAL_KEYS,
  "fraction-to-decimal": NUMBER_KEYS,
  "decimal-to-fraction": NUMBER_KEYS,
  "percent-of": NUMBER_KEYS,
  "fraction-to-percent": NUMBER_KEYS,
  "ratio-scale": NUMBER_KEYS,
  "is-prime": TRUEFALSE_KEYS,
  "even-odd": CHOICE_KEYS,
  "factor-check": CHOICE_VISUAL_KEYS,
  "count-factors": NUMBER_KEYS,
  "is-multiple": TRUEFALSE_KEYS,
  remainder: NUMBER_KEYS,
  divides: TRUEFALSE_KEYS,
  gcd: NUMBER_KEYS,
  lcm: NUMBER_KEYS,
};

/** [x, format(x, ".3g"), format(x, ".4f"), format(x, ".2g")] from Python. */
const PY_FLOAT_FORMATS: [number, string, string, string][] = [
  [0.3333333333333333, "0.333", "0.3333", "0.33"], [0.125, "0.125", "0.1250", "0.12"], [0.2857142857142857, "0.286", "0.2857", "0.29"],
  [1e-5, "1e-05", "0.0000", "1e-05"], [123456.789, "1.23e+05", "123456.7890", "1.2e+05"], [0.5, "0.5", "0.5000", "0.5"],
  [0.1, "0.1", "0.1000", "0.1"], [9.995, "9.99", "9.9950", "10"], [0.0001234, "0.000123", "0.0001", "0.00012"],
  [1.234e-5, "1.23e-05", "0.0000", "1.2e-05"], [1e16, "1e+16", "10000000000000000.0000", "1e+16"], [99.95, "100", "99.9500", "1e+02"],
  [999.5, "1e+03", "999.5000", "1e+03"], [0.15, "0.15", "0.1500", "0.15"], [2.5, "2.5", "2.5000", "2.5"],
  [-0.3333333333333333, "-0.333", "-0.3333", "-0.33"], [-0.0001234, "-0.000123", "-0.0001", "-0.00012"],
  [1234567.0, "1.23e+06", "1234567.0000", "1.2e+06"], [0.875, "0.875", "0.8750", "0.88"], [0.625, "0.625", "0.6250", "0.62"],
  [0.14285714285714285, "0.143", "0.1429", "0.14"], [0.999, "0.999", "0.9990", "1"], [0.9995, "1", "0.9995", "1"],
];

/**
 * Python runs recorded with backend/app/learning/practice.py: [generator, params, the random draws
 * it made, sha256 of json.dumps(q, ensure_ascii=False, separators=(",", ":"))]. Draws are
 * ["r", value] for random(), ["i", a, b, result] for randint, ["c", len, index] for choice and
 * ["s", len, k, indexes] for sample. Seeds were picked to cover every wording branch.
 */
const PY_REPLAYS: [string, Params, (string | number | number[])[][], string][] = [
  ["build-number", {}, [["i", 1, 9, 7], ["r", 0.757954], ["i", 1, 9, 7], ["i", 0, 9, 0]], "f82ee75804959e38bd7db13f8a858ac2fe267710286eeaebfb577a173e73929d"],
  ["build-number", {}, [["i", 1, 9, 1], ["r", 0.091585], ["i", 0, 9, 5]], "e56efb76ca4fa824a2e076b050b5ac53db298c4b6fc4544e04bce81033d851b0"],
  ["classify-number", {"pool": ["7", "-2/5", "0"]}, [["c", 3, 1]], "4cce670647999e58bf05c9ea02cddbf26f4d8f6aad18e1cdbd8f29d58e638929"],
  ["classify-number", {"pool": ["7", "-2/5", "0"]}, [["c", 3, 0]], "d44ef17c7cbd1eb5f65aec06631d7862ef7a0c880979dc53d815b47e093e67cf"],
  ["classify-number", {"pool": ["7", "-2/5", "0"]}, [["c", 3, 2]], "531eba184fbf896a844c138cdb6e31f1e5c2592c634800046047054c6577b894"],
  ["classify-number", {}, [["c", 11, 6]], "0f76050b1b5bdafb346a07c5ffae4e052aa44b3979d2b6cc2555ecfca98ab831"],
  ["classify-number", {}, [["c", 11, 2]], "531eba184fbf896a844c138cdb6e31f1e5c2592c634800046047054c6577b894"],
  ["classify-number", {}, [["c", 11, 0]], "d44ef17c7cbd1eb5f65aec06631d7862ef7a0c880979dc53d815b47e093e67cf"],
  ["classify-number", {}, [["c", 11, 3]], "6da73c4725fec3ef4d2d6d98a8788db77fa3332f1b3c48d596d7e0b5cfaf955f"],
  ["compare-fractions", {}, [["r", 0.844422], ["s", 7, 2, [6, 3]], ["i", 1, 7, 1], ["i", 1, 4, 3]], "97fb7507244c05f62c3c5aabfaba4e2b788c043da967a698f6ec5318d3877904"],
  ["compare-fractions", {}, [["r", 0.134364], ["s", 9, 2, [1, 4]]], "18712ee69083555ce82ed4d311b8732db830b2d7c3998d5bd55e9d5d3f0ec91e"],
  ["compare-fractions", {}, [["r", 0.79334], ["s", 7, 2, [6, 0]], ["i", 1, 7, 4], ["i", 1, 1, 1]], "1a3d992351f5d201e8ae7732d11fdaa6d8b3258f68f90c37f55d3bb028384e34"],
  ["compare-numbers", {"max": 100, "min": 0}, [["i", 0, 100, 49], ["r", 0.757954], ["i", 0, 100, 53]], "fb0a9b26a9b61cb6c028f5d31fa48b473eb1f130563649de80bddc28bd9f5f45"],
  ["compare-numbers", {"max": 100, "min": 0}, [["i", 0, 100, 7], ["r", 0.091585]], "cdb426253cde90a2577faede45b018a418346d1af0c8b12bf65e5e8dccf7f1bf"],
  ["compare-numbers", {"max": 100, "min": 0}, [["i", 0, 100, 30], ["r", 0.592641], ["i", 0, 100, 16]], "c41fc7e71b3dadf4cb4d976fea90227afef9d7545efaa6d8a5d501ec7e02c716"],
  ["compare-numbers", {"max": 1000, "min": 0}, [["i", 0, 1000, 864], ["r", 0.385245], ["i", 0, 1000, 911]], "017aa38b3dd0eb84014dd69a94e387447552fb0f1ca8059cfda0dfa2d60615d7"],
  ["compare-numbers", {"max": 1000, "min": 0}, [["i", 0, 1000, 978], ["r", 0.863109], ["i", 0, 1000, 869]], "709ec7a7b2d9bbeb5c9b179ba3107e01b7c15cb96e166dfaaa98231043bd5505"],
  ["compare-numbers", {"max": 1000, "min": 0}, [["i", 0, 1000, 585], ["r", 0.032585]], "ea0b7e66a04e921fb3821a8e1657de7d258d6e4c81e7dbe98b680bf4deb9a303"],
  ["compare-numbers", {"max": 15, "min": -15}, [["i", -15, 15, 12], ["r", 0.385245], ["i", -15, 15, 13]], "782c4f6655678ea31dc608e894df860394fc380debdda0af53ce2b527932536d"],
  ["compare-numbers", {"max": 15, "min": -15}, [["i", -15, 15, -11], ["r", 0.569204], ["i", -15, 15, 10]], "f54c6e616c10f710338bfe5cf7e57dad9eef291ef8efd51c5529577dd2dd9fc9"],
  ["compare-numbers", {"max": 15, "min": -15}, [["i", -15, 15, 15], ["r", 0.863109], ["i", -15, 15, 12]], "c6fbef7f6fb15ded4588b730f572a5d28d6f15084b51cdeb660288e68bb3f580"],
  ["compare-numbers", {"max": 15, "min": -15}, [["i", -15, 15, -8], ["r", 0.592641], ["i", -15, 15, -11]], "9e58ae130efd97a18d470762032ba244d40c237fc512ebc7b0b5ed079c2745d6"],
  ["compare-numbers", {"max": 20, "min": -20}, [["i", -20, 20, 4], ["r", 0.757954], ["i", -20, 20, 6]], "3fda4629da865e97d66c7d761c878057a1754e9b085e1bcf8dbe10a1a470faa1"],
  ["compare-numbers", {"max": 20, "min": -20}, [["i", -20, 20, -12], ["r", 0.569204], ["i", -20, 20, -16]], "9e2085ccf7ec340325455713174fe78dc401d73c6c76f1d59cafc36b8cf1db48"],
  ["compare-numbers", {"max": 20, "min": -20}, [["i", -20, 20, -17], ["r", 0.091585]], "6e12264df8945d6a28a9fc138cf4045024445ee6ab7af7c365d19d60cea5d71e"],
  ["compare-numbers", {"max": 20, "min": -20}, [["i", -20, 20, -5], ["r", 0.303299], ["i", -20, 20, 5]], "ff0342d664a3084cb1a0def699dde065f013dc0438d0851816c710b0c83ef4ab"],
  ["compare-numbers", {}, [["i", 0, 100, 49], ["r", 0.757954], ["i", 0, 100, 53]], "fb0a9b26a9b61cb6c028f5d31fa48b473eb1f130563649de80bddc28bd9f5f45"],
  ["compare-numbers", {}, [["i", 0, 100, 7], ["r", 0.091585]], "cdb426253cde90a2577faede45b018a418346d1af0c8b12bf65e5e8dccf7f1bf"],
  ["compare-numbers", {}, [["i", 0, 100, 30], ["r", 0.592641], ["i", 0, 100, 16]], "c41fc7e71b3dadf4cb4d976fea90227afef9d7545efaa6d8a5d501ec7e02c716"],
  ["count-factors", {}, [["i", 6, 36, 33]], "165e74b7e3d4aab7dce00e91635cea7f75df7188d7c435ceae8eb5225622d427"],
  ["count-factors", {}, [["i", 6, 36, 36]], "74bc56ea15a812be90cb7fea36c1be24d60245cd885711e3a2228843aa5a4a83"],
  ["count-factors", {}, [["i", 6, 36, 13]], "537ec9b487091bf28f76cde22e12414c2396b6b8a8c97ab5668d6d17e2086df7"],
  ["count-factors", {}, [["i", 6, 36, 25]], "b2c262819ebd287dd47a5bd18553c8de7861fc358fbf4fdb3df4a92d5a7017e7"],
  ["count-objects", {"max": 12, "min": 4}, [["i", 4, 12, 10], ["c", 6, 3]], "aed59c22a12d58b28a0507c2db37f8758c7a7ddeaa2c3d744b83f5efcee68d8c"],
  ["count-objects", {"max": 12, "min": 4}, [["i", 4, 12, 6], ["c", 6, 4]], "a46220812ae6fdd4491abdd239d4432fd9cc28857a41803279befd96f3e8a754"],
  ["count-objects", {"max": 12, "min": 4}, [["i", 4, 12, 4], ["c", 6, 0]], "ecee3fef2df2ec45965153fb7ba53f52cc4d15b2c48b5a0f09abb1113428379f"],
  ["count-objects", {"max": 12, "min": 4}, [["i", 4, 12, 7], ["c", 6, 2]], "684796075df80320434128e04a97c1f8de9b080e713e5fb0686bdc6bccb04528"],
  ["count-objects", {"max": 15, "min": 5}, [["i", 5, 15, 11], ["c", 6, 3]], "f16ffec2bad7ff1a6aeb5a39938b8dfe8c6efb8f68ac3a2d197b791c77e5aa7a"],
  ["count-objects", {"max": 15, "min": 5}, [["i", 5, 15, 7], ["c", 6, 4]], "88da47896c79f9ded43c96fc16f95c79ed43b7406ec37586149c1028d308aab8"],
  ["count-objects", {"max": 15, "min": 5}, [["i", 5, 15, 5], ["c", 6, 0]], "106aeced0f23d92c8648f982b953c51c0b15a1a252bd77c0dd366291aa4d099b"],
  ["count-objects", {"max": 15, "min": 5}, [["i", 5, 15, 8], ["c", 6, 2]], "42432d51180fb090184908e982b7ffd10847224adfd3d003737eb407d0ed20d2"],
  ["count-objects", {"max": 30, "min": 12}, [["i", 12, 30, 24], ["c", 6, 3]], "4b53a955652a43ade771a2d7758466f7ce8059f2c0d69c8a0295421ed76ccb3f"],
  ["count-objects", {"max": 30, "min": 12}, [["i", 12, 30, 16], ["c", 6, 4]], "50b0ce67206ea5957efedf046df6e2dcbefaad8aa2fa9ab29505b4fd1d726430"],
  ["count-objects", {"max": 30, "min": 12}, [["i", 12, 30, 13], ["c", 6, 0]], "ce95c4dd1a63708dd072dd74e30fe16fc1b05fee9fc1ac7fde35dc23dab215ec"],
  ["count-objects", {"max": 30, "min": 12}, [["i", 12, 30, 19], ["c", 6, 2]], "089aa38e060d316fbfe38e3ad4fcfa6c967a31c18fc8074645c571bf0086ed1c"],
  ["count-objects", {}, [["i", 3, 15, 9], ["c", 6, 3]], "e90d201c4b41991222635fe4ce9f77c3f082d321bf2823b88bbc446c23955d3b"],
  ["count-objects", {}, [["i", 3, 15, 5], ["c", 6, 4]], "34766c75b054fc30f297b124d56f79c1b67fd3b348e6fd2838793d4cd4ef0c27"],
  ["count-objects", {}, [["i", 3, 15, 3], ["c", 6, 0]], "21b599ca8c158b83483e553c2bfa4be004f67d31bfa71999dceeead07c8472cc"],
  ["count-objects", {}, [["i", 3, 15, 6], ["c", 6, 2]], "f15ae79294b536c47da7d185b5fdb7f3248259136ea28571ea4e3077f81a281d"],
  ["decimal-to-fraction", {}, [["c", 12, 6]], "36b5f319b2897b7010dbb9dcb2841306f10b92b4c8026a37010e0a035d3458a8"],
  ["decimal-to-fraction", {}, [["c", 12, 2]], "d57090dca2eecce05dd01fbbab2a1e423415e1c09842544d2b5dd3cedb57fbe7"],
  ["decimal-to-fraction", {}, [["c", 12, 7]], "29a6fc15fb8cb2421d521a9cc7a264181ab701477e4c62a4d5d96788d3ebef90"],
  ["decimal-to-fraction", {}, [["c", 12, 10]], "43cf9f6ce7d83cb4323fb9c4895ffe60faeaa74252827ae35d103750485f3130"],
  ["digit-value", {}, [["i", 1000, 9999, 7311], ["i", 0, 3, 3]], "ab2003349d5334ad68506659587c93600889a76b22f4ff21c6e23fd6ebf17ab8"],
  ["digit-value", {}, [["i", 1000, 9999, 3201], ["i", 0, 3, 0]], "ef509dadf93f7b34295d7dbc6921d10b251b899e55690254b20ace34408e9616"],
  ["digit-value", {}, [["i", 1000, 9999, 4898], ["i", 0, 3, 1]], "aa2760f1d53497e32a95621125a7ed99c1b76fc9ebe0bcceb851aa9d7034376f"],
  ["digit-value", {}, [["i", 1000, 9999, 4867], ["i", 0, 3, 2]], "7007a816677cf8bdda8c8db5de307a13325ea415aaaca73733fc865edc2717d7"],
  ["divides", {}, [["i", 2, 10, 8], ["r", 0.757954], ["i", 12, 90, 65]], "7020751b5e7e334e154aeebb9ffe53db74048905a6e8c85c7255291d0c7b8a63"],
  ["divides", {}, [["i", 2, 10, 4], ["r", 0.569204], ["i", 12, 90, 20]], "8d7e920d68d8aa884cbea053f44b8d88e5dc40554de8b543888251fb8f918724"],
  ["equivalent-fraction", {}, [["i", 2, 6, 5], ["i", 1, 4, 4], ["i", 2, 4, 2]], "fdcc4c48f0e3dae83f4610dec2667a2c03d72f5ceb5d33f1eb9263b08375f4cc"],
  ["even-odd", {"max": 60, "min": -60}, [["i", -60, 60, 48]], "4eddab1e46bd81966353569556c7725d4727687fda4908317f465d29e506b961"],
  ["even-odd", {"max": 60, "min": -60}, [["i", -60, 60, -43]], "5df8dfd0ed65aae5afcd76913a178a6eec03e735af7db2bd801b182931bb2e19"],
  ["even-odd", {"max": 60, "min": -60}, [["i", -60, 60, -30]], "9193f1a2c5b5a3172e2d52792ae3d6e1a09dc9131cdb01624775785ae7fa942e"],
  ["even-odd", {"max": 60, "min": -60}, [["i", -60, 60, 19]], "b32235a33b316602a6df0fee796d33ab662a5e71a879373d04a0dbece61bc020"],
  ["even-odd", {}, [["i", 0, 200, 98]], "edbe7def37e48c77a6fe1376d1e9d8693637167ab9e0f80b4a3caff320bdbb78"],
  ["even-odd", {}, [["i", 0, 200, 159]], "794f6fb9001af44c690ccae95afab75563b001db9b835eede9177ecd151dbdbf"],
  ["factor-check", {}, [["c", 12, 6], ["s", 3, 3, [1, 0, 2]], ["s", 11, 3, [8, 7, 6]]], "c5b8f877366c6df525d8332b41ecddebebf305fa12f63ed061c4de65bf1798ed"],
  ["factor-check", {}, [["c", 12, 2], ["s", 4, 3, [0, 1, 3]], ["s", 14, 3, [7, 12, 13]]], "3f7e4388a45a666e7f51bc696e5cafcd960f2f3438aacdf3969d7e4915ab5c8a"],
  ["factor-check", {}, [["c", 12, 3], ["s", 6, 3, [4, 5, 1]], ["s", 16, 3, [11, 14, 9]]], "e50f87112e31e1e0c018afdfdfe290489ba304cd3eef406e1579d9f80285b371"],
  ["factor-check", {}, [["c", 12, 9], ["s", 6, 3, [2, 5, 0]], ["s", 34, 3, [29, 15, 3]]], "36117b07914df1348ee1d55605a1a99dac3f5b42c837bebf857e428ec237f9e8"],
  ["fraction-of-shape", {}, [["i", 2, 12, 8], ["i", 1, 7, 7]], "dbe43ad4f80b67ef121dfc1591b344820204733c8d25fa53a3be0a39c715c6fc"],
  ["fraction-of-shape", {}, [["i", 2, 12, 2], ["i", 1, 1, 1]], "08d8e0ea2bbfc7141edb83ca646e05e5e1fab955d6594c1380dacae43115cffd"],
  ["fraction-to-decimal", {}, [["c", 6, 3], ["i", 1, 9, 7]], "bb1b62d11e8c13c6d4ebc897adcfb59c3b79f061a223154b06f1ec05bd441655"],
  ["fraction-to-percent", {}, [["c", 7, 6], ["i", 1, 49, 25]], "add0360f8d10c5b086e1dff995251565be452391b5a337fb6add3cd9039ec664"],
  ["gcd", {"max": 60}, [["i", 2, 12, 8], ["i", 1, 7, 7], ["i", 1, 7, 4]], "b8064c7189d396d8fe8dfe5683dd74e0bf429384d439c8c93a49c1d9d294d810"],
  ["gcd", {"max": 60}, [["i", 2, 12, 2], ["i", 1, 30, 3], ["i", 1, 30, 3], ["i", 2, 12, 7], ["i", 1, 8, 3], ["i", 1, 8, 5]], "a98ebd616e776024edfc678a92a64607c7dffd950a79793a9a719cafafbed75c"],
  ["gcd", {"max": 60}, [["i", 2, 12, 5], ["i", 1, 12, 10], ["i", 1, 12, 9]], "a03014c314e159f3e317222d89082e20acc5d42fc771fc9661a30a70614d162d"],
  ["gcd", {"max": 60}, [["i", 2, 12, 5], ["i", 1, 12, 5], ["i", 1, 12, 2]], "c4666dc3714c0021a057e208ffed7262124fcdc1d378eb7df0536402c428bad3"],
  ["gcd", {}, [["i", 2, 12, 8], ["i", 1, 6, 4], ["i", 1, 6, 1]], "4a8264b3b2384e9dbb0eade99d54f0fdfafb8ebf87dc6dec818b5fa073fb0841"],
  ["gcd", {}, [["i", 2, 12, 4], ["i", 1, 12, 10], ["i", 1, 12, 2]], "da7b074dd3221cf549870a118a2d558cf0fa5e72596341897fac916d4c73b623"],
  ["gcd", {}, [["i", 2, 12, 2], ["i", 1, 24, 3], ["i", 1, 24, 3], ["i", 2, 12, 7], ["i", 1, 6, 2], ["i", 1, 6, 6]], "e14549a1cc1c6515408c8092fa0bc2125f83bc233349111e9e2116dac92e6218"],
  ["gcd", {}, [["i", 2, 12, 5], ["i", 1, 9, 5], ["i", 1, 9, 2]], "c4666dc3714c0021a057e208ffed7262124fcdc1d378eb7df0536402c428bad3"],
  ["is-multiple", {}, [["i", 2, 9, 8], ["r", 0.757954], ["i", 10, 100, 63]], "6db825add232923c5d906cb1064d725c2ffd5eff90add96d75e3eefeb28e40de"],
  ["is-multiple", {}, [["i", 2, 9, 2], ["r", 0.091585], ["i", 2, 12, 7]], "29d689ae33f3ebaa47c2c096c7e94cd1cfad80ee55c3f54dbe0f62174a762033"],
  ["is-prime", {"max": 100}, [["r", 0.844422], ["c", 74, 53]], "b0cacd26e974dcffa60d434721d609bfb3869399b2e00aa98eadd7af15843415"],
  ["is-prime", {"max": 100}, [["r", 0.134364], ["c", 25, 24]], "4421ef7ef29f6b60216c29f5d6423cccf7854c7ac2f0733de2fd863a409f05a0"],
  ["is-prime", {"max": 100}, [["r", 0.571403], ["c", 74, 54]], "4d1434c6bee2c54c03537c0f7af92f840049a20b1fd721210b40f278cd75c1f4"],
  ["is-prime", {"max": 50}, [["r", 0.844422], ["c", 34, 26]], "0dc0261cf68bb09bf66b19a8dce6e602e600a7665fd940e1d3c6c437fc0cb79b"],
  ["is-prime", {"max": 50}, [["r", 0.134364], ["c", 15, 13]], "4e56736f3c40dd82d2ef766bbf8605e7afa479c04a53813cfb104d1641608189"],
  ["is-prime", {"max": 50}, [["r", 0.956034], ["c", 34, 3]], "bcefa1dba396fc615ab6a94e09244deb71338df8d8ab59e1b4d22a7be9ce7efe"],
  ["is-prime", {"max": 60}, [["r", 0.844422], ["c", 42, 26]], "0dc0261cf68bb09bf66b19a8dce6e602e600a7665fd940e1d3c6c437fc0cb79b"],
  ["is-prime", {"max": 60}, [["r", 0.134364], ["c", 17, 2]], "9210f5223ea0e58f99a7d0744ebac30e2fa114cad8c2788bc60bb89e6e90fa4c"],
  ["is-prime", {"max": 60}, [["r", 0.956034], ["c", 42, 3]], "bcefa1dba396fc615ab6a94e09244deb71338df8d8ab59e1b4d22a7be9ce7efe"],
  ["is-prime", {}, [["r", 0.844422], ["c", 42, 26]], "0dc0261cf68bb09bf66b19a8dce6e602e600a7665fd940e1d3c6c437fc0cb79b"],
  ["is-prime", {}, [["r", 0.134364], ["c", 17, 2]], "9210f5223ea0e58f99a7d0744ebac30e2fa114cad8c2788bc60bb89e6e90fa4c"],
  ["is-prime", {}, [["r", 0.956034], ["c", 42, 3]], "bcefa1dba396fc615ab6a94e09244deb71338df8d8ab59e1b4d22a7be9ce7efe"],
  ["lcm", {"max": 15}, [["s", 14, 2, [13, 6]]], "c4121dac7bf17b69510f4abe5cee8d23a518d958c625e7fe7cab9d41cbd78395"],
  ["lcm", {"max": 15}, [["s", 14, 2, [2, 9]]], "310bc509dbc6522ae24065e1ac5c532865bd9a4691749f9cfc2d691d5e1724d8"],
  ["lcm", {"max": 15}, [["s", 14, 2, [13, 0]]], "3c0c7e945b1a719837e8ad49bbbeb8c36e2c644c0d9fa009a2a6a19cea54641b"],
  ["lcm", {"max": 15}, [["s", 14, 2, [3, 4]]], "cedc9299abc99875404fcacc7c55ae190d3bd7fb461943f5220423f34a8e28b9"],
  ["lcm", {}, [["s", 11, 2, [6, 10]]], "230297675e3ce5ffd143fbb0c62118ff1921cc190f139c39e78c1606bdbee312"],
  ["lcm", {}, [["s", 11, 2, [2, 9]]], "310bc509dbc6522ae24065e1ac5c532865bd9a4691749f9cfc2d691d5e1724d8"],
  ["lcm", {}, [["s", 11, 2, [0, 1]]], "71cfaf0ff28e1c4f30fa5d0953d95573c6d23bd2daa81497eae22e6e05bbcb08"],
  ["lcm", {}, [["s", 11, 2, [3, 4]]], "cedc9299abc99875404fcacc7c55ae190d3bd7fb461943f5220423f34a8e28b9"],
  ["next-number", {}, [["i", 0, 99, 49], ["r", 0.757954]], "769569e25706358fb3cdb0485ad558254d42dcdfd7b4d24f18e5cdee6c5518ee"],
  ["next-number", {}, [["i", 0, 99, 7], ["r", 0.091585]], "f6561c1ac057844c9397444e46c131026fd3e339da3b3087cc926ed44ff4ee70"],
  ["number-line-move", {}, [["i", -5, 5, 1], ["i", 2, 8, 8], ["r", 0.890244]], "5fde41fa4d7e9d8ca2079e5e47d0213487427407e1a8ea40ff156edb4bb1fa9b"],
  ["number-line-move", {}, [["i", -5, 5, -3], ["i", 2, 8, 6], ["r", 0.847434]], "d82e74b26c682fdb523e6d497245cf10b194367839b25b35989de18985e1665c"],
  ["number-line-move", {}, [["i", -5, 5, -5], ["i", 2, 8, 2], ["r", 0.084872]], "1dc2e49d75d152d131d70610daad960f9e50df50f39b6ed891c934da77248d78"],
  ["number-line-move", {}, [["i", -5, 5, 4], ["i", 2, 8, 8], ["r", 0.08057]], "b6a4d5975fa6602b93c4ddc18991e26a0b7904c048b8f8172c5c649799c55780"],
  ["order-numbers", {"count": 4, "max": 60, "min": 0}, [["s", 61, 4, [54, 24, 48, 56]]], "b4dbbc553e54628451ae28cf9b0a5f8f2033ec9e1ed8e2ef0605f41884daf286"],
  ["order-numbers", {"count": 5, "max": 99, "min": 0}, [["s", 100, 5, [49, 97, 53, 5, 33]]], "e7606f7194dd5bd8bf8ee9cc76a9e742dd5d5030aa381523ccb8f264f476d37a"],
  ["order-numbers", {}, [["s", 51, 4, [24, 48, 26, 2]]], "1eb01f5be24ddbd28ca16ba1b7143c1cb2e380981ee3df5d5d75c2166faa50c1"],
  ["percent-of", {}, [["c", 7, 6], ["c", 8, 6]], "74c2571cf4bd1a241aa7d9b5bdc437b76d1ba7a82d79c60271ce4e0c9ab73eca"],
  ["percent-of", {}, [["c", 7, 1], ["c", 8, 1]], "5a1f2715d30b9f6c3bf64e0aa6d01a3299999407f2d3b3eb19054a43befb6fb5"],
  ["percent-of", {}, [["c", 7, 1], ["c", 8, 5]], "763b145eac16e32362761403c929112700a936bdeb09e4810c0fcba9099bd428"],
  ["ratio-scale", {}, [["c", 6, 3], ["i", 2, 5, 5]], "6943e0cdbf61d2de570c6653ddadf5d4fb1071f664d52cfa91809c110015197e"],
  ["remainder", {}, [["i", 2, 9, 8], ["i", 9, 60, 57]], "52b441b59a0b6dd2707ac0116dcb8a79fb4a4b0bc9709b4c62b2e36cdebf2157"],
  ["remainder", {}, [["i", 2, 9, 5], ["i", 6, 60, 6]], "981cf1c90db0cb70ba3d992020f97ab5e42b1e3b23c6e4f86ca74208d4591751"],
  ["rows-total", {}, [["i", 2, 5, 5], ["i", 2, 6, 5]], "dbada02b4c200acf8ad0a3e42e13b1662969208edabb53f1e30304c06c13e1ad"],
  ["rows-total", {}, [["i", 2, 5, 3], ["i", 2, 6, 6]], "739b35e635535699a374c9bb835860bfd4bc32eb4e8f1b4eebdc2f87b00adcda"],
  ["rows-total", {}, [["i", 2, 5, 2], ["i", 2, 6, 2]], "5ffe8b72836cfeee4a492cb687f88bd0dff0c6c509f0adece2e9a2ec8380f2cc"],
  ["rows-total", {}, [["i", 2, 5, 2], ["i", 2, 6, 5]], "c97026861dd903bc55b236415cd2776f8193bf1b460ae97014039c1c0d74ffb1"],
  ["skip-count", {"steps": [1, 4]}, [["c", 2, 1], ["i", 2, 6, 5]], "9d0e6f71378059fcfaf8573e81790ca51c99e8fcbd7c2c6239aedd415785ec0b"],
  ["skip-count", {"steps": [1, 4]}, [["c", 2, 0], ["i", 2, 6, 6]], "47d9bb4a25d38cf63a6268950e74aafcb4f453b9d8c71abe3a51ee5bdcf202d1"],
  ["skip-count", {"steps": [1, 4]}, [["c", 2, 0], ["i", 2, 6, 2]], "e61780c257aafcd1108eb9177d26030323385944358559ada6eccf7669aa769b"],
  ["skip-count", {"steps": [1, 4]}, [["c", 2, 0], ["i", 2, 6, 4]], "cae5502d4b2df8030a32eb5aae48ed4213c5f68535781c5628dc0879e7c115fd"],
  ["skip-count", {}, [["c", 4, 3], ["i", 2, 6, 5]], "503bd45debfb6ffadfec1dc7907749f42ac3b8e15ed50c99ca7236bcf52c7d0b"],
  ["skip-count", {}, [["c", 4, 1], ["i", 2, 6, 6]], "4140513615b1664e29e13f9a766ed3acdc0cebc5fd81c032489df4b9b9025afc"],
  ["skip-count", {}, [["c", 4, 0], ["i", 2, 6, 2]], "c1d47346b30cf8751af4c51be6aaac7889e1ba8183f8b53108579030ed44a014"],
  ["skip-count", {}, [["c", 4, 1], ["i", 2, 6, 4]], "ed792060adfb6edc5d8fa322a857d3a8a9030e8fc51c47275d9a3aa78591ddc9"],
];

// ---------------------------------------------------------------- helpers for the checks

/** Replays recorded draws instead of generating random ones. */
class Replay extends Random {
  private i = 0;
  constructor(private readonly draws: (string | number | number[])[][]) {
    super(1);
  }
  private next(kind: string) {
    const d = this.draws[this.i++];
    if (!d || d[0] !== kind) throw new Error(`draw ${this.i - 1}: expected ${d?.[0]}, the port asked for ${kind}`);
    return d;
  }
  done(): boolean {
    return this.i === this.draws.length;
  }
  random(): number {
    return this.next("r")[1] as number;
  }
  randint(a: number, b: number): number {
    const d = this.next("i");
    expect([a, b]).toEqual([d[1], d[2]]);
    return d[3] as number;
  }
  choice<T>(xs: readonly T[]): T {
    const d = this.next("c");
    expect(xs.length).toBe(d[1]);
    return xs[d[2] as number];
  }
  sample<T>(xs: readonly T[], k: number): T[] {
    const d = this.next("s");
    expect([xs.length, k]).toEqual([d[1], d[2]]);
    return (d[3] as number[]).map((j) => xs[j]);
  }
}

const sha256 = (s: string) => createHash("sha256").update(s, "utf8").digest("hex");

const bruteDivisors = (n: number) => Array.from({ length: n }, (_, i) => i + 1).filter((d) => n % d === 0);
const brutePrime = (n: number) => n > 1 && bruteDivisors(n).length === 2;
function euclid(a: number, b: number): number {
  return b === 0 ? Math.abs(a) : euclid(b, a % b);
}
const frac = (s: string) => {
  const f = Fraction.parse(s);
  if (!f) throw new Error(`not a number: ${s}`);
  return f;
};
function match(s: string, re: RegExp): string[] {
  const m = re.exec(s);
  if (!m) throw new Error(`${re} does not match ${JSON.stringify(s)}`);
  return m.slice(1);
}
/** "\tfrac{3}{4}", "-\tfrac{1}{2}" or "7" -> Fraction */
function texFrac(t: string): Fraction {
  const m = /^(-?)\\tfrac\{(\d+)\}\{(\d+)\}$/.exec(t);
  if (m) return new Fraction(BigInt(m[2]) * (m[1] ? -1n : 1n), BigInt(m[3]));
  return frac(t);
}

/** All learner-facing text in a question. */
function texts(q: Q): string[] {
  const out: string[] = [q.prompt, q.explanation];
  if (q.hint) out.push(q.hint);
  if (q.diagnosis) out.push(q.diagnosis);
  for (const o of q.options ?? []) out.push(o.text, ...(o.diagnosis ? [o.diagnosis] : []));
  for (const w of q.common_wrong ?? []) out.push(w.diagnosis);
  for (const it of q.items ?? []) out.push(it);
  if (q.visual?.caption) out.push(q.visual.caption);
  return out;
}

function mathIn(nodes: Inline[], out: string[] = [], stray: string[] = []): { math: string[]; stray: string[] } {
  for (const n of nodes) {
    if (n.type === "math") out.push(n.tex);
    else if (n.type === "text") {
      if (n.text.includes("$")) stray.push(n.text);
    } else if (n.type === "bold" || n.type === "italic") mathIn(n.children, out, stray);
  }
  return { math: out, stray };
}

const rendered = new Set<string>();
function checkTex(q: Q): void {
  for (const s of texts(q)) {
    const { math, stray } = mathIn(parseInline(s));
    expect(stray, `unmatched $ in ${JSON.stringify(s)}`).toEqual([]);
    for (const tex of math) {
      if (rendered.has(tex)) continue;
      expect(() => katex.renderToString(tex, { throwOnError: true, strict: "error" }), tex).not.toThrow();
      rendered.add(tex);
    }
  }
}

const LESSONS = new Set(Object.keys(content.lessons));
const revisitOk = (r: unknown) => r === null || (typeof r === "string" && LESSONS.has(r));

/** Shape and type checks that every question of a given type must pass. */
function checkShape(gid: string, q: Q): void {
  expect(Object.keys(q)).toEqual(PY_KEYS[gid]);
  expect(JSON.parse(JSON.stringify(q))).toEqual(q); // plain JSON: no BigInt, no undefined
  expect(q.generated_from).toBe(gid);
  expect(typeof q.prompt).toBe("string");
  expect(typeof q.kind).toBe("string");
  expect(typeof q.explanation === "string" && q.explanation.length > 0).toBe(true);
  expect(q.hint).toBeNull();
  if (q.visual !== null) {
    expect(typeof q.visual.widget).toBe("string");
    expect(typeof q.visual.props).toBe("object");
    expect(typeof q.visual.caption).toBe("string");
  }
  if (q.type === "number") {
    expect(typeof q.answer).toBe("string");
    expect(Fraction.parse(q.answer)).not.toBeNull();
    expect(q.answer).toBe(frac(q.answer).toString()); // canonical, as str(Fraction)
    expect(q.tolerance).toBeNull();
    expect(q.unit === null || q.unit === "%").toBe(true);
    const seen = new Set<string>();
    for (const w of q.common_wrong) {
      expect(Object.keys(w)).toEqual(["answer", "diagnosis", "revisit"]);
      expect(typeof w.answer).toBe("string");
      expect(frac(w.answer).eq(frac(q.answer)), `common wrong ${w.answer} equals the answer`).toBe(false);
      expect(seen.has(w.answer)).toBe(false);
      seen.add(w.answer);
      expect(typeof w.diagnosis === "string" && w.diagnosis.length > 0).toBe(true);
      expect(revisitOk(w.revisit)).toBe(true);
    }
  } else if (q.type === "choice") {
    expect(typeof q.multi).toBe("boolean");
    q.options.forEach((o: Q, i: number) => {
      expect(Object.keys(o)).toEqual(["id", "text", "correct", "diagnosis", "revisit"]);
      expect(o.id).toBe(String.fromCharCode(97 + i));
      expect(typeof o.text).toBe("string");
      expect(typeof o.correct).toBe("boolean");
      if (o.correct) expect([o.diagnosis, o.revisit]).toEqual([null, null]);
      else {
        expect(typeof o.diagnosis === "string" && o.diagnosis.length > 0).toBe(true);
        expect(revisitOk(o.revisit)).toBe(true);
      }
    });
    expect(q.options.some((o: Q) => o.correct)).toBe(true);
  } else if (q.type === "truefalse") {
    expect(typeof q.answer).toBe("boolean");
    expect(typeof q.diagnosis).toBe("string");
    expect(revisitOk(q.revisit)).toBe(true);
  } else if (q.type === "order") {
    expect(q.order_label).toBe("smallest to largest");
    for (const it of q.items) expect(typeof it).toBe("string");
  } else throw new Error(`unexpected type ${q.type}`);
}

const get = (p: Params, k: string, d: unknown) => (Object.prototype.hasOwnProperty.call(p, k) ? p[k] : d);
const correctTexts = (q: Q) => q.options.filter((o: Q) => o.correct).map((o: Q) => o.text);
const num = (q: Q) => frac(q.answer);

/** Recompute each answer from the prompt alone, without the port's helpers. */
const CHECKS: Record<string, (q: Q, p: Params) => void> = {
  "count-objects": (q, p) => {
    const n = q.visual.props.count;
    expect(n).toBeGreaterThanOrEqual(get(p, "min", 3));
    expect(n).toBeLessThanOrEqual(get(p, "max", 15));
    expect(q.answer).toBe(String(n));
    expect(q.prompt).toContain(`${q.visual.props.object}s`);
  },
  "next-number": (q) => {
    const [dir, n] = match(q.prompt, /just \*\*(before|after)\*\* (\d+)\?/);
    expect(num(q).eq(dir === "before" ? Number(n) - 1 : Number(n) + 1)).toBe(true);
  },
  "skip-count": (q, p) => {
    const [k, seq] = match(q.prompt, /jumps of (\d+): ([\d, ]+), \.\.\. What/);
    const xs = seq.split(", ").map(Number);
    expect(xs).toEqual(xs.map((_, i) => Number(k) * (i + 1)));
    expect(get(p, "steps", [2, 3, 5, 10])).toContain(Number(k));
    expect(num(q).eq(xs[xs.length - 1] + Number(k))).toBe(true);
  },
  "rows-total": (q) => {
    const [r, c] = match(q.prompt, /in (\d+) equal rows with (\d+) chairs/).map(Number);
    expect(num(q).eq(r * c)).toBe(true);
  },
  "compare-numbers": (q, p) => {
    const [a, b] = match(q.prompt, /\$\\;(-?\d+) \\;\\square\\; (-?\d+)\$$/).map(Number);
    for (const v of [a, b]) expect(v >= get(p, "min", 0) && v <= get(p, "max", 100)).toBe(true);
    expect(correctTexts(q)).toEqual([a < b ? "$<$" : a > b ? "$>$" : "$=$"]);
    expect(q.options.map((o: Q) => o.text)).toEqual(["$<$", "$>$", "$=$"]);
  },
  "order-numbers": (q, p) => {
    const vals = q.items.map((s: string) => Number(match(s, /^\$(-?\d+)\$$/)[0]));
    expect(vals.length).toBe(get(p, "count", 4));
    for (let i = 1; i < vals.length; i++) expect(vals[i]).toBeGreaterThan(vals[i - 1]);
    for (const v of vals) expect(v >= get(p, "min", 0) && v <= get(p, "max", 50)).toBe(true);
  },
  "number-line-move": (q) => {
    const [s, k, dir] = match(q.prompt, /^Start at \$(-?\d+)\$ on the number line and move (\d+) steps to the (left|right)\./);
    expect(num(q).eq(dir === "left" ? Number(s) - Number(k) : Number(s) + Number(k))).toBe(true);
  },
  "build-number": (q) => {
    const [h, t, o] = match(q.prompt, /\*\*(\d)\*\* hundreds, \*\*(\d)\*\* tens and \*\*(\d)\*\* ones/).map(Number);
    expect(h).toBeGreaterThan(0);
    expect(num(q).eq(100 * h + 10 * t + o)).toBe(true);
  },
  "digit-value": (q) => {
    const [n, d, place] = match(q.prompt, /^In the number (\d{4}), what is the digit \*\*(\d)\*\* \(in the (\w+) place\) worth\?$/);
    const pos = ["thousands", "hundreds", "tens", "ones"].indexOf(place);
    expect(n[pos]).toBe(d);
    expect(d).not.toBe("0");
    expect(num(q).eq(Number(d) * 10 ** (3 - pos))).toBe(true);
  },
  "classify-number": (q) => {
    const [shown] = match(q.prompt, /^Which families does the number (.+) belong to\?/);
    const v = shown.startsWith("$") ? texFrac(shown.slice(1, -1)) : frac(shown.split("−").join("-"));
    const int = v.isInteger();
    expect(q.options.map((o: Q) => o.correct)).toEqual([int && v.ge(1), int && v.ge(0), int, true]);
    expect(q.multi).toBe(true);
  },
  "fraction-of-shape": (q) => {
    const [d, n] = match(q.prompt, /cut into (\d+) equal slices and you eat (\d+) of them/).map(Number);
    expect(n).toBeLessThan(d);
    expect(num(q).eq(new Fraction(n, d))).toBe(true);
  },
  "equivalent-fraction": (q) => {
    const [a, b, D] = match(q.prompt, /\\tfrac\{(\d+)\}\{(\d+)\} = \\tfrac\{\\;\?\\;\}\{(\d+)\}\$$/).map(Number);
    expect(D % b).toBe(0);
    expect(num(q).eq((a * D) / b)).toBe(true);
  },
  "compare-fractions": (q) => {
    const [x, y] = match(q.prompt, /\$\\;(.+) \\;\\square\\; (.+)\$$/).map(texFrac);
    expect(correctTexts(q)).toEqual([x.lt(y) ? "$<$" : x.gt(y) ? "$>$" : "$=$"]);
    const [dx, dy] = match(q.explanation, /As decimals: ([\d.]+) and ([\d.]+)\.$/).map(frac);
    expect(Math.abs(dx.toNumber() - x.toNumber())).toBeLessThan(0.005);
    expect(Math.abs(dy.toNumber() - y.toNumber())).toBeLessThan(0.005);
  },
  "fraction-to-decimal": (q) => {
    const [n, d] = match(q.prompt, /^Write \$\\tfrac\{(\d+)\}\{(\d+)\}\$ as a decimal\.$/).map(Number);
    expect([2, 4, 5, 10, 20, 25]).toContain(d);
    expect(num(q).eq(new Fraction(n, d))).toBe(true);
    const [dec] = match(q.explanation, /written \*\*([\d.]+)\*\*\.$/);
    expect(frac(dec).eq(new Fraction(n, d))).toBe(true);
  },
  "decimal-to-fraction": (q) => {
    const [s] = match(q.prompt, /^Write ([\d.]+) as a fraction\./);
    expect(num(q).eq(frac(s))).toBe(true);
  },
  "percent-of": (q) => {
    const [pct, base] = match(q.prompt, /^What is (\d+)% of (\d+)\?$/).map(Number);
    expect(num(q).eq(new Fraction(pct * base, 100))).toBe(true);
    expect(num(q).isInteger()).toBe(true);
  },
  "fraction-to-percent": (q) => {
    const [n, d] = match(q.prompt, /\\tfrac\{(\d+)\}\{(\d+)\}/).map(Number);
    expect(num(q).eq(new Fraction(100 * n, d))).toBe(true);
    expect(q.unit).toBe("%");
  },
  "ratio-scale": (q) => {
    const [a, b, flour] = match(q.prompt, /uses (\d+) cups of flour for every (\d+) eggs\. If you use (\d+) cups/).map(Number);
    expect(flour % a).toBe(0);
    expect(num(q).eq((b * flour) / a)).toBe(true);
  },
  "is-prime": (q, p) => {
    const [n] = match(q.prompt, /^True or false: (\d+) is a prime number\.$/).map(Number);
    expect(n).toBeLessThanOrEqual(get(p, "max", 60));
    expect(q.answer).toBe(brutePrime(n));
  },
  "even-odd": (q, p) => {
    const [n] = match(q.prompt, /^Is \$?(-?\d+)\$? even or odd\?$/).map(Number);
    expect(n >= get(p, "min", 0) && n <= get(p, "max", 200)).toBe(true);
    expect(correctTexts(q)).toEqual([Math.abs(n) % 2 === 0 ? "Even" : "Odd"]);
  },
  "factor-check": (q) => {
    const [n] = match(q.prompt, /factors of (\d+)\?/).map(Number);
    for (const o of q.options) expect(o.correct).toBe(n % Number(o.text) === 0);
    expect(q.options.filter((o: Q) => !o.correct).length).toBe(3);
    expect(q.options.filter((o: Q) => o.correct).length).toBe(Math.min(3, bruteDivisors(n).length - 2));
    expect(q.multi).toBe(true);
  },
  "count-factors": (q) => {
    const [n] = match(q.prompt, /^How many factors does (\d+) have\?/).map(Number);
    expect(num(q).eq(bruteDivisors(n).length)).toBe(true);
  },
  "is-multiple": (q) => {
    const [a, b] = match(q.prompt, /^True or false: (\d+) is a multiple of (\d+)\.$/).map(Number);
    expect(q.answer).toBe(a % b === 0);
  },
  remainder: (q) => {
    const [a, b] = match(q.prompt, /^(\d+) stickers are shared equally among (\d+) friends/).map(Number);
    expect(num(q).eq(a % b)).toBe(true);
  },
  divides: (q) => {
    const [b, a] = match(q.prompt, /^True or false: (\d+) divides (\d+) /).map(Number);
    expect(q.answer).toBe(a % b === 0);
  },
  gcd: (q, p) => {
    const [a, b] = match(q.prompt, /greatest common divisor of (\d+) and (\d+)\?$/).map(Number);
    expect(a).not.toBe(b);
    expect(Math.max(a, b)).toBeLessThanOrEqual(get(p, "max", 48));
    expect(num(q).eq(euclid(a, b))).toBe(true);
  },
  lcm: (q, p) => {
    const [a, b] = match(q.prompt, /least common multiple of (\d+) and (\d+)\?$/).map(Number);
    expect(Math.max(a, b)).toBeLessThanOrEqual(get(p, "max", 12));
    expect(num(q).eq((a * b) / euclid(a, b))).toBe(true);
  },
};

/** Every (generator, params) combination: defaults, and every parameter set a lesson uses. */
function combos(): [string, Params][] {
  const seen = new Map<string, [string, Params]>();
  const add = (g: string, p: Params) => seen.set(`${g} ${JSON.stringify(p)}`, [g, p]);
  for (const g of Object.keys(GENERATORS)) add(g, {});
  for (const lesson of Object.values(content.lessons)) {
    for (const q of lesson.assessment.questions) if (q.type === "generated") add(q.generator, q.params ?? {});
    for (const g of (lesson as { practice?: string[] }).practice ?? []) add(g, {});
  }
  add("classify-number", { pool: ["7"] });
  add("skip-count", { steps: [1, 4] });
  return [...seen.values()];
}

// ---------------------------------------------------------------- tests

describe("generators", () => {
  it("are the 27 Python generators with the same ids, titles and lessons", () => {
    expect(Object.values(GENERATORS).map((g) => [g.id, g.title, g.lesson])).toEqual(PY_GENERATORS);
    expect(content.generators.map((g) => [g.id, g.title, g.lesson])).toEqual(PY_GENERATORS);
    for (const g of Object.values(GENERATORS)) expect(LESSONS.has(g.lesson)).toBe(true);
  });

  it("cover every generator the lessons use", () => {
    for (const lesson of Object.values(content.lessons)) {
      for (const q of lesson.assessment.questions) if (q.type === "generated") expect(GENERATORS[q.generator]).toBeDefined();
    }
  });

  it.each(combos())("%s %j: 200 questions are well formed, correct and render", (gid, params) => {
    const before = JSON.stringify(params);
    const bodies = new Set<string>();
    for (let seed = 0; seed < 200; seed++) {
      const q = generate(gid, new Random(seed), params);
      checkShape(gid, q);
      CHECKS[gid](q, params);
      checkTex(q);
      bodies.add(JSON.stringify(q));
    }
    expect(JSON.stringify(params)).toBe(before); // params are copied, never changed
    if (!("pool" in params)) expect(bodies.size).toBeGreaterThan(1); // really random
  });

  it("produce exactly Python's questions from the same random draws", () => {
    expect(new Set(PY_REPLAYS.map((r) => r[0]))).toEqual(new Set(Object.keys(GENERATORS)));
    for (const [gid, params, draws, hash] of PY_REPLAYS) {
      const rng = new Replay(draws);
      const q = generate(gid, rng, params);
      expect(rng.done(), `${gid}: every recorded draw is used`).toBe(true);
      const json = JSON.stringify(q);
      expect(sha256(json), `${gid} ${JSON.stringify(params)}\n${json}`).toBe(hash);
    }
  });

  it("generate() works without an rng and rejects unknown ids", () => {
    const q = generate("gcd");
    expect(q.generated_from).toBe("gcd");
    expect(() => generate("no-such-generator")).toThrow();
    expect(() => generate("__proto__")).toThrow();
    expect(generate("lcm", new Random(1), null).type).toBe("number");
  });

  it("select-all family questions require every family (test_learning.py)", () => {
    const q = generate("classify-number", new Random(0), { pool: ["7"] });
    expect(q.options.every((o: Q) => o.correct)).toBe(true);
    expect(q.multi).toBe(true);
    const half = generate("classify-number", new Random(0), { pool: ["1/2"] });
    expect(half.options.map((o: Q) => o.correct)).toEqual([false, false, false, true]);
    expect(half.prompt).toBe("Which families does the number $\\tfrac{1}{2}$ belong to? Choose **all** that apply.");
    const neg = generate("classify-number", new Random(0), { pool: ["-3"] });
    expect(neg.prompt).toBe("Which families does the number −3 belong to? Choose **all** that apply.");
    expect(neg.explanation).toBe("−3 belongs to: Integers, Fractions. The families are nested - each one contains the ones inside it.");
  });

  it("generated gcd and lcm answers are mathematically right (test_learning.py)", () => {
    const rng = new Random(3);
    for (let i = 0; i < 100; i++) {
      let q = generate("gcd", rng, {});
      let [a, b] = q.prompt.replace(/\?$/, "").split("of ")[1].split(" and ").map(Number);
      expect(frac(q.answer).eq(euclid(a, b))).toBe(true);
      q = generate("lcm", rng, {});
      [a, b] = q.prompt.replace(/\?$/, "").split("of ")[1].split(" and ").map(Number);
      expect(frac(q.answer).eq((a * b) / euclid(a, b))).toBe(true);
    }
  });
});

describe("helpers", () => {
  it("number theory agrees with brute force (test_learning.py)", () => {
    for (let n = 1; n < 300; n++) {
      expect(divisors(n)).toEqual(bruteDivisors(n));
      expect(isPrime(n)).toBe(brutePrime(n));
    }
    expect(divisors(-12)).toEqual([1, 2, 3, 4, 6, 12]);
    expect(divisors(0)).toEqual([]);
    expect([isPrime(-7), isPrime(0), isPrime(1), isPrime(2)]).toEqual([false, false, false, true]);
    expect(lcm(4, 6)).toBe(12);
    expect(lcm(7, 5)).toBe(35);
    expect(lcm(-4, 6)).toBe(12);
    expect([gcd(84, 120), gcd(-4, 6), gcd(0, 5), gcd(0, 0)]).toEqual([12, 2, 5, 0]);
    expect(() => lcm(0, 0)).toThrow(); // like Python's ZeroDivisionError
  });

  it("format numbers and LaTeX like Python", () => {
    expect(fracTex(new Fraction(3, 4))).toBe("\\tfrac{3}{4}");
    expect(fracTex(new Fraction(-2, 5))).toBe("-\\tfrac{2}{5}");
    expect(fracTex(new Fraction(6, 3))).toBe("2");
    expect(fracTex(new Fraction(-3))).toBe("-3");
    expect([numTex(-5), numTex(0), numTex(7)]).toEqual(["-5", "0", "7"]);
    expect(fmtList([1, 2, 3])).toBe("1, 2, 3");
    for (const [x, g3, f4, g2] of PY_FLOAT_FORMATS) {
      expect([pyFormatGeneral(x, 3), pyFormatFixed(x, 4), pyFormatGeneral(x, 2)]).toEqual([g3, f4, g2]);
    }
  });

  it("choice() builds options with ids a, b, c", () => {
    expect(
      choice(
        [
          ["x", true, null, null],
          ["y", false, "why", "l1-zero"],
        ],
        true,
      ),
    ).toEqual({
      options: [
        { id: "a", text: "x", correct: true, diagnosis: null, revisit: null },
        { id: "b", text: "y", correct: false, diagnosis: "why", revisit: "l1-zero" },
      ],
      multi: true,
    });
  });

  it("numberQ() keeps answers as strings and drops 'wrong' answers that are right", () => {
    const q = numberQ("p", new Fraction(2, 4), "e", {
      commonWrong: [
        ["1/2", "same as the answer", null],
        [new Fraction(1, 2), "also the same", null],
        [2, "upside down", "l1-fractions"],
        ["2", "duplicate", null],
        [new Fraction(-6, 4), "negative", null],
      ],
    });
    expect(q).toEqual({
      type: "number",
      kind: "solve",
      prompt: "p",
      answer: "1/2",
      tolerance: null,
      unit: null,
      common_wrong: [
        { answer: "2", diagnosis: "upside down", revisit: "l1-fractions" },
        { answer: "-3/2", diagnosis: "negative", revisit: null },
      ],
      explanation: "e",
      hint: null,
      visual: null,
    });
    expect(numberQ("p", 7, "e", { kind: "recall", unit: "%" }).answer).toBe("7");
    expect(numberQ("p", "0.5", "e").answer).toBe("0.5"); // strings are kept as given, like Python
    expect(Object.keys(numberQ("p", -3, "e"))).toEqual(NUMBER_KEYS.slice(0, -1));
  });
});
