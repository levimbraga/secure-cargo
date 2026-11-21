/**
 * "Read from invoice": the gross weight printed on a DANFE (the printed copy of a Brazilian
 * electronic invoice, NF-e), read by Claude vision and shown to the driver for confirmation.
 *
 * **Never invented.** The model is not asked for a number: it copies the characters printed in
 * the "PESO BRUTO" box and the label it found them under. The Worker parses those characters
 * itself (Brazilian format: "1.234,500" is 1234.5 kg) and keeps the weight only when the label
 * is a gross weight and the text is a plain number. Anything else answers "not found", and the
 * driver types the weight. The model never sees or returns a weight that is not printed.
 */
import Anthropic from "@anthropic-ai/sdk";

import { costUsd, DEFAULT_MODEL, type PhotoInput } from "./claude";

export const INVOICE_PROMPT_VERSION = "invoice-1";

export interface InvoiceAnswer {
	found: boolean;
	/** The label printed next to the value, e.g. "PESO BRUTO". */
	label: string;
	/** The value exactly as printed, e.g. "1.234,500". */
	text: string;
	/** The unit printed next to it, when there is one. */
	unit: "kg" | "t" | "none";
	is_invoice: boolean;
}

export interface InvoiceReading {
	gross_kg: number | null;
	label: string;
	text: string;
	is_invoice: boolean;
}

export const INVOICE_SCHEMA = {
	type: "object",
	additionalProperties: false,
	required: ["is_invoice", "found", "label", "text", "unit"],
	properties: {
		is_invoice: { type: "boolean", description: "The photo shows a DANFE or another Brazilian invoice." },
		found: { type: "boolean", description: "The gross weight (PESO BRUTO) box is readable." },
		label: { type: "string", description: "The label printed over the value, copied exactly." },
		text: { type: "string", description: "The value copied character by character, as printed. Empty if not found." },
		unit: { type: "string", enum: ["kg", "t", "none"] },
	},
} as const;

const SYSTEM = `You read one field of a photographed Brazilian invoice (DANFE): the gross weight,
in the box labelled "PESO BRUTO" (in the "TRANSPORTADOR / VOLUMES TRANSPORTADOS" section).
Copy the characters exactly as printed, with their dots and commas. Do not convert, round,
add or compute anything, and do not use any other box (not "PESO LÍQUIDO", not quantities).
If the box is not visible or not legible, answer found=false and an empty text.`;

/** "1.234,500" -> 1234.5; "12.000" -> 12000; "850" -> 850; anything else -> null. */
export function parseBrazilianNumber(text: string): number | null {
	const value = text.trim().replace(/\s/g, "");
	if (!/^\d{1,3}(\.\d{3})*(,\d+)?$|^\d+(,\d+)?$/.test(value)) return null;
	const number = Number(value.replace(/\./g, "").replace(",", "."));
	return Number.isFinite(number) ? number : null;
}

/** The weight from what the model copied, or null: never a value that is not printed. */
export function readingOf(raw: unknown): InvoiceReading {
	const answer = (raw ?? {}) as Partial<InvoiceAnswer>;
	const text = typeof answer.text === "string" ? answer.text.slice(0, 40) : "";
	const label = typeof answer.label === "string" ? answer.label.slice(0, 60) : "";
	const isInvoice = answer.is_invoice === true;
	const gross = /peso\s*bruto/i.test(label);
	let kg = answer.found === true && isInvoice && gross ? parseBrazilianNumber(text) : null;
	if (kg !== null && answer.unit === "t") kg *= 1000;
	if (kg !== null && (kg <= 0 || kg > 80_000)) kg = null;
	return { gross_kg: kg === null ? null : Math.round(kg * 10) / 10, label, text, is_invoice: isInvoice };
}

export interface InvoiceCall {
	reading: InvoiceReading;
	model: string;
	inputTokens: number;
	outputTokens: number;
	costUsd: number;
}

export async function readInvoice(apiKey: string, photo: PhotoInput, model: string = DEFAULT_MODEL): Promise<InvoiceCall> {
	const client = new Anthropic({ apiKey, maxRetries: 1, timeout: 60_000 });
	const response = await client.messages.create({
		model,
		max_tokens: 1_000,
		system: SYSTEM,
		messages: [
			{
				role: "user",
				content: [
					{ type: "image", source: { type: "base64", media_type: photo.mediaType, data: photo.base64 } },
					{ type: "text", text: "Copy the PESO BRUTO field." },
				],
			},
		],
		output_config: { effort: "low", format: { type: "json_schema", schema: INVOICE_SCHEMA } },
	} as Anthropic.MessageCreateParamsNonStreaming);
	const block = response.content.find((item) => item.type === "text");
	let parsed: unknown = null;
	try {
		parsed = JSON.parse(block?.type === "text" ? block.text : "");
	} catch {
		parsed = null;
	}
	const inputTokens = response.usage.input_tokens;
	const outputTokens = response.usage.output_tokens;
	const answeredBy = response.model || model;
	return { reading: readingOf(parsed), model: answeredBy, inputTokens, outputTokens, costUsd: costUsd(answeredBy, inputTokens, outputTokens) };
}
