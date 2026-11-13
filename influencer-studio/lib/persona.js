import { z } from "zod";

export const MIN_AGE = 21;

export const PersonaSchema = z.object({
  name: z.string().trim().min(1).max(60),
  handle: z.string().trim().max(40),
  age: z.number().int().min(MIN_AGE, `Persona must be an adult (${MIN_AGE}+)`).max(80),
  gender: z.string().trim().min(1).max(30),
  origin: z.string().trim().max(60),
  face: z.string().trim().min(1).max(300),
  hair: z.string().trim().min(1).max(200),
  build: z.string().trim().max(200),
  style: z.string().trim().max(300),
  niche: z.string().trim().max(200),
  personality: z.string().trim().max(400),
  captionLanguage: z.string().trim().max(60),
});

// A fully fictional starting point. Edit it in the UI.
export const DEFAULT_PERSONA = {
  name: "Myra Sen",
  handle: "@myra.sen.ai",
  age: 24,
  gender: "woman",
  origin: "Indian",
  face: "oval face, warm brown eyes, soft arched brows, small nose stud, light freckles, friendly smile",
  hair: "long dark-brown wavy hair with a middle part",
  build: "slim, average height",
  style: "modern Indo-western streetwear, earthy tones, minimal gold jewellery",
  niche: "lifestyle, cafes, travel and everyday fashion in Indian cities",
  personality: "warm, witty, a little filmy, talks like a close friend",
  captionLanguage: "Hinglish",
};

// Scenes this studio will not render. The image provider applies its own
// safety filter as well; this is only the first, cheap check.
const BLOCKED = /\b(nude|naked|nsfw|topless|lingerie|explicit|porn\w*|sex\w*|erotic\w*|underage|teen\w*|child\w*|minor|schoolgirl)\b/i;

export function checkScene(scene) {
  const text = String(scene ?? "").trim();
  if (!text) return { ok: false, error: "Describe the scene first." };
  if (text.length > 500) return { ok: false, error: "Scene is too long (max 500 characters)." };
  if (BLOCKED.test(text)) return { ok: false, error: "This studio only makes safe-for-work content." };
  return { ok: true, scene: text };
}

function identity(p) {
  const who = [p.origin, p.gender].filter(Boolean).join(" ");
  return [`a fictional ${p.age}-year-old adult ${who}`, p.face, p.hair, p.build]
    .filter(Boolean)
    .join(", ");
}

/** Prompt for the one "reference face" every later photo is anchored to. */
export function referencePrompt(p) {
  return (
    `Photorealistic studio portrait photo of ${identity(p)}. ` +
    "Head and shoulders, facing the camera, relaxed soft smile, plain white t-shirt, " +
    "plain light-grey background, soft even lighting, natural skin texture, sharp focus, 85mm lens."
  );
}

/** Prompt for a new photo of the same person, given the reference image. */
export function scenePrompt(p, scene) {
  return (
    "Keep the exact same person from the reference image: identical face, hair and skin tone. " +
    `New photo: ${scene}. ` +
    (p.style ? `Outfit and styling: ${p.style}. ` : "") +
    "Photorealistic, natural lighting, candid social-media photo. Fully clothed, tasteful, safe for work."
  );
}

/** Prompts to paste into a free image app (e.g. Gemini) when making photos by hand. */
const REAL = "It must look like a real, unedited phone photo: natural skin texture with pores, no smoothing, no illustration or CGI look.";

export function manualReferencePrompt(p) {
  return `${referencePrompt(p)} ${REAL} Square 1:1 image.`;
}

export function manualScenePrompt(p, scene, aspect) {
  return (
    "Use the attached photo as the reference. Keep the exact same person: identical face, hair and skin tone. " +
    `New photo: ${scene}. ` +
    (p.style ? `Outfit and styling: ${p.style}. ` : "") +
    `Fully clothed, natural lighting. ${REAL} Aspect ratio ${aspect}.`
  );
}

/**
 * Prompt for providers that cannot see the reference image: describe the person again.
 * Kept short and scene-first on purpose: the free Pollinations model returned an
 * unrelated image when given the longer wording used for the other providers.
 */
export function standalonePrompt(p, scene) {
  const who = [p.origin, p.gender].filter(Boolean).join(" ");
  return [
    `Photo of a ${p.age}-year-old ${who}, ${scene}`,
    [p.face, p.hair].filter(Boolean).join(", "),
    p.style,
    "Photorealistic, sharp face.",
  ]
    .filter(Boolean)
    .join(". ");
}
