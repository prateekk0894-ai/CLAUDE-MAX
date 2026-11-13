import { createServer } from "node:http";
import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { CaptionError, writeCaption } from "./lib/captions.js";
import { ASPECTS, ProviderError, provider, providerStatus } from "./lib/images.js";
import { DEFAULT_PERSONA, PersonaSchema, checkScene, referencePrompt, scenePrompt, standalonePrompt } from "./lib/persona.js";

const here = path.dirname(fileURLToPath(import.meta.url));
if (existsSync(path.join(here, ".env"))) process.loadEnvFile(path.join(here, ".env"));

const DATA = process.env.STUDIO_DATA_DIR || path.join(here, "data");
const IMAGES = path.join(DATA, "images");
const PUBLIC = path.join(here, "public");
const TYPES = { ".html": "text/html; charset=utf-8", ".jpg": "image/jpeg", ".svg": "image/svg+xml" };

class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

async function readJson(file, fallback) {
  try {
    return JSON.parse(await readFile(file, "utf8"));
  } catch (error) {
    if (error.code === "ENOENT") return fallback;
    throw error;
  }
}
const writeJson = (file, value) => writeFile(file, JSON.stringify(value, null, 2));

const personaFile = path.join(DATA, "persona.json");
const galleryFile = path.join(DATA, "gallery.json");
const loadPersona = () => readJson(personaFile, DEFAULT_PERSONA);
const loadGallery = () => readJson(galleryFile, []);
// One seed per reference face; reusing it keeps seed-based providers as close to the same person as they can get.
const seedFile = path.join(DATA, "seed.json");

async function referenceFile() {
  const names = await readdir(DATA);
  return names.find((n) => n.startsWith("reference."));
}

async function state() {
  const ref = await referenceFile();
  return {
    persona: await loadPersona(),
    reference: ref ? `/media/${ref}?v=${Date.now()}` : null,
    gallery: await loadGallery(),
    provider: providerStatus(),
    aspects: ASPECTS,
  };
}

function aspectOf(body) {
  const aspect = body.aspect || "4:5";
  if (!ASPECTS.includes(aspect)) throw new HttpError(400, "Unsupported aspect ratio.");
  return aspect;
}

const routes = {
  "GET /api/state": () => state(),

  "PUT /api/persona": async (body) => {
    const parsed = PersonaSchema.safeParse(body);
    if (!parsed.success) throw new HttpError(400, parsed.error.issues[0].message);
    await writeJson(personaFile, parsed.data);
    return state();
  },

  // (Re)generate the reference face. Existing photos keep their old face.
  "POST /api/reference": async () => {
    const persona = await loadPersona();
    const seed = Math.floor(Math.random() * 1_000_000);
    const image = await provider().reference(referencePrompt(persona), "1:1", seed);
    const old = await referenceFile();
    if (old) await rm(path.join(DATA, old));
    await writeFile(path.join(DATA, `reference.${image.ext}`), image.bytes);
    await writeJson(seedFile, { seed });
    return state();
  },

  "POST /api/photos": async (body) => {
    const check = checkScene(body.scene);
    if (!check.ok) throw new HttpError(400, check.error);
    const aspect = aspectOf(body);
    const ref = await referenceFile();
    if (!ref) throw new HttpError(409, "Generate the reference face first.");

    const persona = await loadPersona();
    const refBytes = await readFile(path.join(DATA, ref));
    const { seed } = await readJson(seedFile, { seed: 42 });
    const source = provider();
    const prompt = source.usesReference ? scenePrompt(persona, check.scene) : standalonePrompt(persona, check.scene);
    const image = await source.scene(prompt, { bytes: refBytes }, aspect, seed);

    const id = randomUUID();
    const file = `${id}.${image.ext}`;
    await writeFile(path.join(IMAGES, file), image.bytes);
    const gallery = await loadGallery();
    gallery.unshift({ id, file, scene: check.scene, aspect, createdAt: new Date().toISOString() });
    await writeJson(galleryFile, gallery);
    return state();
  },

  "POST /api/caption": async (body) => {
    const gallery = await loadGallery();
    const item = gallery.find((g) => g.id === body.id);
    if (!item) throw new HttpError(404, "Photo not found.");
    Object.assign(item, await writeCaption(await loadPersona(), item.scene));
    await writeJson(galleryFile, gallery);
    return state();
  },

  "DELETE /api/photos": async (body) => {
    const gallery = await loadGallery();
    const item = gallery.find((g) => g.id === body.id);
    if (!item) throw new HttpError(404, "Photo not found.");
    await rm(path.join(IMAGES, item.file), { force: true });
    await writeJson(galleryFile, gallery.filter((g) => g !== item));
    return state();
  },
};

async function readBody(req) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > 64 * 1024) throw new HttpError(413, "Request too large.");
    chunks.push(chunk);
  }
  if (!chunks.length) return {};
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    throw new HttpError(400, "Invalid JSON.");
  }
}

async function serveFile(res, root, relative) {
  const file = path.join(root, relative);
  if (!file.startsWith(root + path.sep)) throw new HttpError(403, "Forbidden.");
  let bytes;
  try {
    bytes = await readFile(file);
  } catch {
    throw new HttpError(404, "Not found.");
  }
  res.writeHead(200, {
    "Content-Type": TYPES[path.extname(file)] || "application/octet-stream",
    // Only the app page may run script; media files (including SVG placeholders) may not.
    "Content-Security-Policy":
      root === PUBLIC
        ? "default-src 'none'; style-src 'unsafe-inline'; img-src 'self'; script-src 'unsafe-inline'; connect-src 'self'"
        : "default-src 'none'; style-src 'unsafe-inline'",
    "X-Content-Type-Options": "nosniff",
  });
  res.end(bytes);
}

async function handle(req, res) {
  const url = new URL(req.url, "http://localhost");
  const route = routes[`${req.method} ${url.pathname}`];
  if (route) {
    const result = await route(req.method === "GET" ? {} : await readBody(req));
    res.writeHead(200, { "Content-Type": "application/json" });
    return res.end(JSON.stringify(result));
  }
  if (req.method !== "GET") throw new HttpError(404, "Not found.");
  if (url.pathname === "/") return serveFile(res, PUBLIC, "index.html");
  if (url.pathname.startsWith("/media/")) {
    const name = path.basename(url.pathname);
    return serveFile(res, DATA, name.startsWith("reference.") ? name : path.join("images", name));
  }
  throw new HttpError(404, "Not found.");
}

export async function start(port = Number(process.env.PORT) || 4321) {
  await mkdir(IMAGES, { recursive: true });
  const server = createServer((req, res) => {
    handle(req, res).catch((error) => {
      const known = error instanceof HttpError || error instanceof ProviderError || error instanceof CaptionError;
      if (!known) console.error(error);
      res.writeHead(error.status || (known ? 502 : 500), { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: known ? error.message : "Something went wrong. Check the server log." }));
    });
  });
  // Local only: this app has no login.
  await new Promise((resolve) => server.listen(port, "127.0.0.1", resolve));
  return server;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const server = await start();
  console.log(`Influencer Studio: http://localhost:${server.address().port}  (images: ${providerStatus().name})`);
}
