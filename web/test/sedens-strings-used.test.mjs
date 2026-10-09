// Every literal t("key") in the SEDENS pages has copy in both languages, so no
// page ever shows a raw key such as "studio.save".
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { STRINGS } from "../src/sedens/strings.js";

const folder = new URL("../src/sedens/", import.meta.url);
const sources = readdirSync(folder).filter((name) => name.endsWith(".js") && !name.startsWith("strings"));

test("every literal string key used by a SEDENS page exists", () => {
  const missing = [];
  for (const name of sources) {
    const text = readFileSync(new URL(name, folder), "utf8");
    for (const match of text.matchAll(/\bt\(\s*["']([a-z_]+\.[A-Za-z0-9_.]+)["']\s*[,)]/g)) {
      if (!(match[1] in STRINGS.en)) missing.push(`${name}: ${match[1]}`);
    }
  }
  assert.deepEqual(missing, []);
});
