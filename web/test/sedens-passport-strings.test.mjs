// Fitness Passport copy: complete in both languages, and free of the words the Passport must never use.
import { test } from "node:test";
import assert from "node:assert/strict";
import { PASSPORT } from "../src/sedens/strings-passport.js";
import { STRINGS } from "../src/sedens/strings.js";

const keys = (lang) => Object.keys(PASSPORT[lang]).sort();
const placeholders = (text) => (text.match(/\{\w+\}/g) || []).sort().join(",");

test("every Passport key exists in both languages, with the same placeholders", () => {
  assert.deepEqual(keys("ko"), keys("en"));
  for (const key of keys("en")) assert.equal(placeholders(PASSPORT.ko[key]), placeholders(PASSPORT.en[key]), key);
});

test("Passport keys are namespaced, not empty, and merged into the SEDENS strings", () => {
  for (const lang of ["en", "ko"]) {
    for (const [key, value] of Object.entries(PASSPORT[lang])) {
      assert.match(key, /^pp\./, key);
      assert.ok(value.trim(), `${lang}.${key}`);
      assert.equal(STRINGS[lang][key], value, `${lang}.${key} is merged`);
    }
  }
});

test("the home card is a working link, no longer a later phase", () => {
  for (const lang of ["en", "ko"]) assert.doesNotMatch(STRINGS[lang]["home.passport_body"], /later phase|이후 단계/i);
});

// Words the Passport must never use to describe a person. An exact sentence that negates them could be listed
// here; none is needed because the Passport copy simply never says them.
const FORBIDDEN = [
  /calorie/i, /\bscores?\b/i, /improv/i, /strength gain/i, /injury prevention/i, /fitness age/i, /muscle activation/i,
  /칼로리/, /점수/, /개선/, /근력 향상/, /부상 예방/, /체력 나이/, /근육 활성도/,
];
const EXEMPT = new Set([]);

test("no forbidden vocabulary in the English or Korean Passport copy", () => {
  for (const lang of ["en", "ko"]) {
    for (const [key, value] of Object.entries(PASSPORT[lang])) {
      if (EXEMPT.has(value)) continue;
      for (const pattern of FORBIDDEN) assert.ok(!pattern.test(value), `${lang}.${key} matches ${pattern}`);
    }
  }
});

test("a comparison is never called better or worse except to say it is neither", () => {
  for (const lang of ["en", "ko"]) {
    for (const [key, value] of Object.entries(PASSPORT[lang])) {
      if (/better|worse|더 낫|나쁜|좋아/.test(value)) assert.ok(/not better or worse|더 낫거나 나쁜 것은 아니에요/.test(value), `${lang}.${key}`);
    }
  }
});

test("repeatability is stated as not established, and the not-enough-information sentence is exact", () => {
  assert.match(PASSPORT.en["pp.cmp_repeat"], /has not been established/);
  assert.match(PASSPORT.ko["pp.cmp_repeat"], /확인되지 않았어요/);
  assert.equal(PASSPORT.en["pp.not_enough"], "There isn't enough comparable information yet.");
});

test("every comparison refusal code has copy in both languages", () => {
  for (const code of ["different_customer", "low_quality", "demo_vs_real", "different_protocol", "different_measurement_version", "different_model", "different_rules_version", "observation_withheld"]) {
    for (const lang of ["en", "ko"]) assert.ok(PASSPORT[lang][`pp.reason_${code}`], `${lang}.${code}`);
  }
});

test("Korean Passport sentences use the polite 해요체 and not 합니다체", () => {
  for (const [key, value] of Object.entries(PASSPORT.ko)) {
    assert.doesNotMatch(value, /(합니다|입니다|습니다)[.!]?$/, key);
  }
});
