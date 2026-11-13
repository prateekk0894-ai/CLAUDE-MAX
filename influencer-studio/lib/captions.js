import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { z } from "zod";

const CaptionSchema = z.object({
  caption: z.string(),
  hashtags: z.array(z.string()),
  altText: z.string(),
});

export class CaptionError extends Error {}

let client;

export async function writeCaption(persona, scene) {
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
      system:
        `You write social media posts for ${persona.name} (${persona.handle}), a fictional, openly AI-generated ` +
        `virtual influencer. Niche: ${persona.niche}. Personality: ${persona.personality}. ` +
        `Write in ${persona.captionLanguage || "English"}, in first person, in the persona's own voice. ` +
        "Never claim to be a real human or to have physically used or tested a product. " +
        "caption: 1-3 short lines, no hashtags inside it. hashtags: 6-10 relevant tags, each starting with #, " +
        "always including #aiinfluencer. altText: one plain English sentence describing the photo.",
      messages: [{ role: "user", content: `Write the post for this photo: ${scene}` }],
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
