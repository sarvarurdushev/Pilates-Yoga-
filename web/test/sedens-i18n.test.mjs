// SEDENS copy: complete in Korean and English, and free of claims SEDENS must not make.
import { test } from "node:test";
import assert from "node:assert/strict";
import { STRINGS } from "../src/sedens/strings.js";

const keys = (lang) => Object.keys(STRINGS[lang]).sort();
const placeholders = (text) => (text.match(/\{\w+\}/g) || []).sort().join(",");

test("every key exists in both languages", () => {
  assert.deepEqual(keys("ko"), keys("en"));
});

test("placeholders match between languages", () => {
  for (const key of keys("en")) assert.equal(placeholders(STRINGS.ko[key]), placeholders(STRINGS.en[key]), key);
});

test("no empty strings", () => {
  for (const lang of ["en", "ko"]) for (const [key, value] of Object.entries(STRINGS[lang])) assert.ok(value.trim(), `${lang}.${key}`);
});

const BANNED = [
  /posture score/i, /clinically/i, /corrects? (your )?posture/i, /prevents? injur/i, /injury prevention/i,
  /medical supervision/i, /supervised by/i, /ai knows/i, /diagnos(e|is) (your|the)/i,
  /자세 점수/, /임상적으로/, /부상 예방/, /자세 교정/, /진단해/,
];

test("no banned medical or outcome claims", () => {
  for (const lang of ["en", "ko"]) {
    for (const [key, value] of Object.entries(STRINGS[lang])) {
      for (const pattern of BANNED) assert.ok(!pattern.test(value), `${lang}.${key} matches ${pattern}`);
    }
  }
});

test("muscle activation is only ever mentioned to say the anatomy is not a measurement", () => {
  for (const lang of ["en", "ko"]) {
    for (const [key, value] of Object.entries(STRINGS[lang])) {
      if (/muscle activation|근육 활성도/i.test(value))
        assert.ok(/not measured muscle activation|측정된 근육 활성도가 아닙니다/.test(value), `${lang}.${key}`);
    }
  }
});

test("diagnosis is only ever mentioned to say SEDENS does not diagnose", () => {
  for (const lang of ["en", "ko"]) {
    for (const [key, value] of Object.entries(STRINGS[lang])) {
      if (/diagnos|진단/i.test(value)) assert.ok(/does not diagnose|진단하거나 치료하지 않습니다/.test(value), `${lang}.${key}`);
    }
  }
});

test("demonstration and simulation are named, and emergencies point to 119", () => {
  assert.match(STRINGS.en["room.simulated_access"], /simulated/);
  assert.match(STRINGS.ko["room.simulated_access"], /시뮬레이션/);
  assert.match(STRINGS.en["room.help"], /119/);
  assert.match(STRINGS.ko["room.help"], /119/);
});

test("t() substitutes placeholders and falls back to English, then the key", async () => {
  globalThis.localStorage = { getItem: () => "en", setItem() {} };
  const { t, setLang } = await import("../src/sedens/i18n.js?case=fallback");
  setLang("en");
  assert.equal(t("room.welcome", { room: "AI Private Room 01" }), "Welcome to AI Private Room 01");
  assert.equal(t("no.such.key"), "no.such.key");
  setLang("ko");
  assert.equal(t("room.welcome", { room: "AI Private Room 01" }), "AI Private Room 01에 오신 것을 환영합니다");
  setLang("xx");
  assert.equal(t("common.save"), "저장");
});
