// Image providers. Each returns { bytes: Buffer, ext: "jpg" | "svg" }.
//
//   reference(prompt, aspect, seed)             -> first portrait, text-to-image
//   scene(prompt, referenceImage, aspect, seed) -> new photo of the same person
//
// usesReference says whether scene() can actually look at the reference image.
// Providers that cannot get the full written description of the person instead.

const REPLICATE = "https://api.replicate.com/v1";
const BASE_MODEL = () => process.env.REPLICATE_BASE_MODEL || "black-forest-labs/flux-1.1-pro";
const EDIT_MODEL = () => process.env.REPLICATE_EDIT_MODEL || "black-forest-labs/flux-kontext-pro";

export const ASPECTS = ["4:5", "1:1", "9:16", "16:9"];

export function providerName() {
  return (process.env.IMAGE_PROVIDER || "manual").toLowerCase();
}

export function providerStatus() {
  const name = providerName();
  if (name === "mock") return { name, ready: true, note: "Placeholder images only. Set IMAGE_PROVIDER=pollinations for free real photos." };
  if (name === "manual") {
    return { name, ready: true, note: "Manual mode: copy the prompt, make the photo in a free app such as Gemini, then upload it here." };
  }
  if (name === "pollinations") {
    return { name, ready: true, note: "Pollinations mode: free and automatic, but low quality. Photos do not look like a real person and the face changes between photos." };
  }
  if (name === "replicate") {
    const ready = Boolean(process.env.REPLICATE_API_TOKEN);
    return { name, ready, note: ready ? "" : "REPLICATE_API_TOKEN is missing in .env" };
  }
  return { name, ready: false, note: `Unknown IMAGE_PROVIDER "${name}"` };
}

export class ProviderError extends Error {}

async function replicateRun(model, input) {
  const headers = {
    Authorization: `Bearer ${process.env.REPLICATE_API_TOKEN}`,
    "Content-Type": "application/json",
    Prefer: "wait",
  };
  let res = await fetch(`${REPLICATE}/models/${model}/predictions`, {
    method: "POST",
    headers,
    body: JSON.stringify({ input }),
  });
  let body = await res.json().catch(() => ({}));
  if (!res.ok) throw new ProviderError(`Replicate ${res.status}: ${body.detail || body.title || "request failed"}`);

  // "Prefer: wait" holds the request for up to a minute; poll if still running.
  const deadline = Date.now() + 5 * 60_000;
  while (body.status === "starting" || body.status === "processing") {
    if (Date.now() > deadline) throw new ProviderError("Replicate timed out after 5 minutes");
    await new Promise((r) => setTimeout(r, 2000));
    res = await fetch(body.urls.get, { headers: { Authorization: headers.Authorization } });
    body = await res.json();
  }
  if (body.status !== "succeeded") throw new ProviderError(`Replicate: ${body.error || body.status}`);

  const url = Array.isArray(body.output) ? body.output[0] : body.output;
  if (typeof url !== "string") throw new ProviderError("Replicate returned no image");
  const img = await fetch(url);
  if (!img.ok) throw new ProviderError(`Could not download image (${img.status})`);
  return { bytes: Buffer.from(await img.arrayBuffer()), ext: "jpg" };
}

const replicate = {
  usesReference: true,
  reference: (prompt, aspect) =>
    replicateRun(BASE_MODEL(), { prompt, aspect_ratio: aspect, output_format: "jpg" }),
  scene: (prompt, ref, aspect) =>
    replicateRun(EDIT_MODEL(), {
      prompt,
      input_image: `data:${ref.mime};base64,${ref.bytes.toString("base64")}`,
      aspect_ratio: aspect,
      output_format: "jpg",
    }),
};

// Offline stand-in so the whole app can be tried without spending anything.
function placeholder(label, text, aspect) {
  const [w, h] = aspect.split(":").map(Number);
  const W = 800, H = Math.round((800 * h) / w);
  const esc = (s) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
  const words = text.split(/\s+/);
  const lines = [];
  for (const word of words) {
    const last = lines[lines.length - 1];
    if (last && (last + " " + word).length <= 38) lines[lines.length - 1] = last + " " + word;
    else lines.push(word);
  }
  const shown = lines.slice(0, 6);
  const tspans = shown.map((l, i) => `<tspan x="${W / 2}" dy="${i ? 34 : 0}">${esc(l)}</tspan>`).join("");
  const hue = [...text].reduce((a, c) => (a + c.charCodeAt(0)) % 360, 0);
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}">` +
    `<defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1">` +
    `<stop offset="0" stop-color="hsl(${hue} 45% 32%)"/><stop offset="1" stop-color="hsl(${(hue + 60) % 360} 50% 18%)"/></linearGradient></defs>` +
    `<rect width="${W}" height="${H}" fill="url(#g)"/>` +
    `<text x="${W / 2}" y="${H / 2 - 60}" text-anchor="middle" font-family="sans-serif" font-size="22" fill="#fff" opacity=".7" letter-spacing="3">${esc(label)}</text>` +
    `<text x="${W / 2}" y="${H / 2}" text-anchor="middle" font-family="sans-serif" font-size="26" fill="#fff">${tspans}</text>` +
    `</svg>`;
  return { bytes: Buffer.from(svg), ext: "svg" };
}

// Free, keyless. Limits: one image per 45 s per IP, 768x768 total area, small logo.
const POLLINATIONS_SIZE = { "4:5": [680, 850], "1:1": [768, 768], "9:16": [576, 1024], "16:9": [1024, 576] };

async function pollinationsImage(prompt, aspect, seed) {
  const [width, height] = POLLINATIONS_SIZE[aspect];
  const url =
    `https://image.pollinations.ai/prompt/${encodeURIComponent(prompt)}` +
    `?width=${width}&height=${height}&seed=${seed}&safe=true`;
  for (let attempt = 0; ; attempt++) {
    const res = await fetch(url, { signal: AbortSignal.timeout(180_000) });
    if (res.ok) return { bytes: Buffer.from(await res.arrayBuffer()), ext: "jpg" };
    if (res.status !== 402 && res.status !== 429) throw new ProviderError(`Pollinations error ${res.status}`);
    // Over the free rate limit: wait it out once, otherwise tell the user how long.
    const wait = Number(res.headers.get("retry-after")) || 45;
    if (attempt > 1 || wait > 60) throw new ProviderError(`Free limit reached. Try again in about ${wait} seconds.`);
    await new Promise((r) => setTimeout(r, (wait + 1) * 1000));
  }
}

const pollinations = {
  usesReference: false,
  reference: (prompt, aspect, seed) => pollinationsImage(prompt, aspect, seed),
  scene: (prompt, _ref, aspect, seed) => pollinationsImage(prompt, aspect, seed),
};

const mock = {
  usesReference: true,
  reference: async (prompt, aspect) => placeholder("MOCK REFERENCE", prompt, aspect),
  scene: async (prompt, _ref, aspect) => placeholder("MOCK PHOTO", prompt, aspect),
};

export function provider() {
  const status = providerStatus();
  if (!status.ready) throw new ProviderError(status.note);
  if (status.name === "manual") throw new ProviderError("Manual mode has no automatic generation. Copy the prompt and upload the photo instead.");
  return { replicate, pollinations, mock }[status.name];
}
