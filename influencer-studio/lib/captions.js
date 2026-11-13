import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { z } from "zod";

const CaptionSchema = z.object({
  caption: z.string().min(1),
  hashtags: z.array(z.string()),
  altText: z.string(),
});

export class CaptionError extends Error {}

function systemPrompt(persona) {
  return (
    `You write social media posts for ${persona.name} (${persona.handle}), a fictional, openly AI-generated ` +
    `virtual influencer. Niche: ${persona.niche}. Personality: ${persona.personality}. ` +
    `Write in ${persona.captionLanguage || "English"}, in first person, in the persona's own voice. ` +
    "Never claim to be a real human or to have physically used or tested a product. " +
    "caption: 1-3 short lines, no hashtags inside it. hashtags: 6-10 relevant tags, each starting with #, " +
    "always including #aiinfluencer. altText: one plain English sentence describing the photo."
  );
}

const userPrompt = (scene) => `Write the post for this photo: ${scene}`;

function tryJson(text) {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

// Free, keyless. Limit: one request per 30 s per IP.
async function pollinationsCaption(persona, scene) {
  const body = JSON.stringify({
    messages: [
      {
        role: "system",
        content:
          systemPrompt(persona) +
          ' Reply with only a JSON object: {"caption": string, "hashtags": [string], "altText": string}.',
      },
      { role: "user", content: userPrompt(scene) },
    ],
  });
  let res;
  for (let attempt = 0; ; attempt++) {
    res = await fetch("https://text.pollinations.ai/", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body,
      signal: AbortSignal.timeout(120_000),
    });
    if (res.ok) break;
    if (res.status !== 402 && res.status !== 429) throw new CaptionError(`Pollinations error ${res.status}`);
    const wait = Number(res.headers.get("retry-after")) || 30;
    if (attempt > 1 || wait > 60) throw new CaptionError(`Free limit reached. Try again in about ${wait} seconds.`);
    await new Promise((r) => setTimeout(r, (wait + 1) * 1000));
  }
  // The model may wrap the JSON in prose or a code fence; take the outermost object.
  const text = await res.text();
  const parsed = CaptionSchema.safeParse(tryJson(text.slice(text.indexOf("{"), text.lastIndexOf("}") + 1)));
  if (!parsed.success) throw new CaptionError("The free model returned an unusable caption. Try again.");
  const tags = parsed.data.hashtags.map((t) => (t.startsWith("#") ? t : `#${t}`));
  if (!tags.some((t) => t.toLowerCase() === "#aiinfluencer")) tags.push("#aiinfluencer");
  return { ...parsed.data, hashtags: tags };
}

let client;

async function claudeCaption(persona, scene) {
  let response;
  try {
    client ??= new Anthropic();
    response = await client.beta.messages.create({
      model: "claude-opus-5-5",
      max_tokens: 16000,
      // If the model declines, the API retries on a fallback model in the same call.
      betas: ["server-side-fallback-2026-07-01"],
      fallbacks: "default",
      output_config: { effort: "low", format: zodOutputFormat(CaptionSchema) },
      system: systemPrompt(persona),
      messages: [{ role: "user", content: userPrompt(scene) }],
    });
  } catch (error) {
    if (error instanceof Anthropic.AuthenticationError) {
      throw new CaptionError("Claude API key is missing or invalid. Set ANTHROPIC_API_KEY in .env.");
    } else if (error instanceof Anthropic.RateLimitError) {
      throw new CaptionError("Claude API rate limit hit. Try again in a minute.");
    } else if (error instanceof Anthropic.APIError) {
      throw new CaptionError(`Claude API error ${error.status ?? ""}: ${error.message}`);
    }
    // No credentials at all surfaces as a plain Error from the client constructor.
    throw new CaptionError(`Captions unavailable. Is ANTHROPIC_API_KEY set in .env? (${error.message})`);
  }

  if (response.stop_reason === "refusal") throw new CaptionError("The model declined to caption this scene.");
  if (response.stop_reason === "max_tokens") throw new CaptionError("Caption was cut off. Try again.");
  const text = response.content.find((block) => block.type === "text")?.text;
  if (!text) throw new CaptionError("The model returned no caption.");
  return CaptionSchema.parse(JSON.parse(text));
}

export function writeCaption(persona, scene) {
  const name = (process.env.CAPTION_PROVIDER || "pollinations").toLowerCase();
  if (name === "claude") return claudeCaption(persona, scene);
  if (name === "pollinations") return pollinationsCaption(persona, scene);
  throw new CaptionError(`Unknown CAPTION_PROVIDER "${name}"`);
}
