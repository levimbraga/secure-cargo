/**
 * The one call that spends Anthropic credits: the photos of a load to a structured analysis.
 *
 * Model choice and its measured accuracy and cost: `docs/perception-eval.md`. The prompt asks
 * for what can be seen and nothing else; weights are never asked for and never accepted.
 */
import Anthropic from "@anthropic-ai/sdk";

import { ANALYSIS_SCHEMA, CARGO_TYPES, type PhotoAnalysis, sanitizeAnalysis } from "./schema";

/** Chosen by measuring accuracy against cost on our photos (docs/perception-eval.md). */
export const DEFAULT_MODEL = "claude-opus-5-5";

/** US$ per million tokens (input, output), from the Anthropic price list (checked 2026-11-20). */
export const PRICES_PER_MTOK: Record<string, { input: number; output: number }> = {
	"claude-haiku-5-5": { input: 0.1, output: 0.5 },
	"claude-sonnet-5-5": { input: 2, output: 10 },
	"claude-opus-5-5": { input: 4, output: 20 },
};

export interface PhotoInput {
	mediaType: "image/jpeg" | "image/png" | "image/webp";
	base64: string;
	position: string;
}

export interface AnalysisCall {
	analysis: PhotoAnalysis;
	model: string;
	inputTokens: number;
	outputTokens: number;
	costUsd: number;
}

export class AnalysisFailed extends Error {
	constructor(
		readonly code: "refused" | "truncated" | "invalid_output",
		message: string,
	) {
		super(message);
	}
}

export function costUsd(model: string, inputTokens: number, outputTokens: number): number {
	const price = PRICES_PER_MTOK[model] ?? PRICES_PER_MTOK["claude-opus-5-5"]!;
	return (inputTokens * price.input + outputTokens * price.output) / 1_000_000;
}

const SYSTEM = `You inspect photographs of cargo loaded on a truck, for a cargo-securement check.
Report only what you can see. The output is turned into a top-down plan of the truck bed that
a person then corrects, so be honest about uncertainty instead of guessing confidently.

Conventions:
- The truck bed is seen from above in the plan. "along" is where a unit's centre is along the
  bed: 0 at the headboard (the front wall behind the cab), 1 at the rear end of the bed.
  "across" is 0 at the truck's left edge (the driver's side) and 1 at its right edge. On a
  photo taken from behind the truck, the truck's left is on the left of the photo.
- Dimensions are in metres: length along the truck, width across it, height. Use the bed and
  the usual size of things (a pallet is 1.2 x 1.0 m, a 200 L drum is 0.6 m across) as scale.
- Number every cargo unit (1, 2, 3...). A stack of two pallets is two units; the upper one is
  "stacked_on" the lower one. Group many small identical cartons into blocks of about one
  pallet each, as "stacked_boxes".
- "box" is where the unit is on the photo given by "photo" (0-based), as fractions of the
  photo's width and height: [x0, y0, x1, y1].
- Restraints: count straps, chains and ropes you can see. "top_over" goes over the load from
  one side of the truck to the other; "diagonal" goes from a corner of a unit to the bed.
  List the units each one secures when you can tell.
- Violations of the Brazilian rule (CONTRAN 945/2022) you can see: ropes used to lash cargo,
  cargo above the headboard that could slide forward, a gap between the headboard and the
  load, lashings tied to the wooden floor instead of the metal frame.
- Truck body: flatbed (open, maybe low side rails), box (closed van), curtain_sider. Size:
  vuc (small urban truck), toco (two axles), truck (three axles, rigid), semi (semi-trailer).
  Use "unknown" when you cannot tell.
- Never estimate weight or mass. It cannot be seen; the user provides it.
- If the photos do not show cargo on a truck, set is_truck_load to false and leave the lists
  empty.
- Cargo types: ${CARGO_TYPES.join(", ")}. "long_pipes" is only for round things lying lengthwise
  (pipes, tubes, round bars, logs); it is drawn as a bundle of cylinders. A square-sided block
  (a bundle of sawn lumber, boards or profiles, a wrapped package) is a "crate" with its real
  length, width and height. Use the closest type when nothing matches and say so in "uncertain".`;

/** Ask Claude for the analysis of 1 to 4 photos of one load. */
export async function analyzePhotos(
	apiKey: string,
	photos: PhotoInput[],
	model: string = DEFAULT_MODEL,
): Promise<AnalysisCall> {
	const client = new Anthropic({ apiKey, maxRetries: 1, timeout: 90_000 });
	const content: Anthropic.ContentBlockParam[] = [];
	photos.forEach((photo, index) => {
		content.push({ type: "text", text: `Photo ${index} (${photo.position} of the truck):` });
		content.push({ type: "image", source: { type: "base64", media_type: photo.mediaType, data: photo.base64 } });
	});
	content.push({ type: "text", text: "Describe this load as the schema asks." });

	// Sonnet and Opus may decline a request their safety classifiers flag; the server-side
	// fallback then answers with another model (Haiku has no fallback). Billing follows the
	// model that answered.
	const fallback = !model.startsWith("claude-haiku");
	const response = await client.beta.messages.create({
		model,
		max_tokens: 16_000,
		system: SYSTEM,
		messages: [{ role: "user", content: content as Anthropic.Beta.BetaContentBlockParam[] }],
		output_config: { effort: "low", format: { type: "json_schema", schema: ANALYSIS_SCHEMA } },
		...(fallback ? { betas: ["server-side-fallback-2026-07-01"], fallbacks: "default" as const } : {}),
	});
	if (response.stop_reason === "refusal") throw new AnalysisFailed("refused", "The model declined to analyse the photos.");
	if (response.stop_reason === "max_tokens") throw new AnalysisFailed("truncated", "The analysis was cut off.");
	const textBlock = response.content.find((block) => block.type === "text");
	let parsed: unknown;
	try {
		parsed = JSON.parse(textBlock?.type === "text" ? textBlock.text : "");
	} catch {
		throw new AnalysisFailed("invalid_output", "The analysis was not valid JSON.");
	}
	const inputTokens = response.usage.input_tokens + (response.usage.cache_creation_input_tokens ?? 0) + (response.usage.cache_read_input_tokens ?? 0);
	const outputTokens = response.usage.output_tokens;
	const answeredBy = response.model || model;
	return {
		analysis: sanitizeAnalysis(parsed, photos.length),
		model: answeredBy,
		inputTokens,
		outputTokens,
		costUsd: costUsd(answeredBy, inputTokens, outputTokens),
	};
}
