import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { after, before, test } from "node:test";

process.env.IMAGE_PROVIDER = "mock";
process.env.STUDIO_DATA_DIR = await mkdtemp(path.join(os.tmpdir(), "studio-"));

const { start } = await import("../server.js");
const { DEFAULT_PERSONA, PersonaSchema, checkScene, scenePrompt } = await import("../lib/persona.js");

let server, base;
before(async () => {
  server = await start(0);
  base = `http://127.0.0.1:${server.address().port}`;
});
after(() => server.close());

const call = async (method, url, body) => {
  const res = await fetch(base + url, {
    method,
    headers: { "Content-Type": "application/json" },
    body: body && JSON.stringify(body),
  });
  return { status: res.status, body: await res.json() };
};

test("persona must be an adult", () => {
  assert.equal(PersonaSchema.safeParse(DEFAULT_PERSONA).success, true);
  assert.equal(PersonaSchema.safeParse({ ...DEFAULT_PERSONA, age: 17 }).success, false);
});

test("scene check blocks explicit requests and allows normal ones", () => {
  assert.equal(checkScene("nude on a beach").ok, false);
  assert.equal(checkScene("").ok, false);
  assert.equal(checkScene("reading a book in a cafe").ok, true);
  assert.match(scenePrompt(DEFAULT_PERSONA, "reading a book"), /same person.*reading a book/s);
});

test("photo needs a reference face first, then lands in the gallery", async () => {
  const early = await call("POST", "/api/photos", { scene: "walking in a park" });
  assert.equal(early.status, 409);

  const ref = await call("POST", "/api/reference");
  assert.match(ref.body.reference, /^\/media\/reference\.svg/);

  const made = await call("POST", "/api/photos", { scene: "walking in a park", aspect: "1:1" });
  assert.equal(made.status, 200);
  const [item] = made.body.gallery;
  assert.equal(item.scene, "walking in a park");

  const media = await fetch(`${base}/media/${item.file}`);
  assert.equal(media.status, 200);
  assert.equal(media.headers.get("content-type"), "image/svg+xml");

  const gone = await call("DELETE", "/api/photos", { id: item.id });
  assert.equal(gone.body.gallery.length, 0);
  assert.equal((await fetch(`${base}/media/${item.file}`)).status, 404);
});

test("bad input is rejected", async () => {
  assert.equal((await call("PUT", "/api/persona", { ...DEFAULT_PERSONA, age: 16 })).status, 400);
  assert.equal((await call("POST", "/api/photos", { scene: "x", aspect: "7:3" })).status, 400);
  assert.equal((await fetch(`${base}/media/..%2F..%2Fpackage.json`)).status, 404);
});
