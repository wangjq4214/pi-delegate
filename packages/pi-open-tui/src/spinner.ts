import { sanitizeStatus } from "./utils.ts";

const BRAILLE_FRAMES = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];
const ASCII_FRAMES = ["|", "/", "-", "\\"];

/** Compatibility fallback only when no normal native working indicator is available. */
export function fallbackSpinner(frame: number, ascii: boolean): string {
	const frames = ascii ? ASCII_FRAMES : BRAILLE_FRAMES;
	return frames[frame % frames.length]!;
}

/** Read-only presentation of a native frame. ASCII preserves its rotation phase,
 * rather than starting another animation clock. Explicit custom host frames survive. */
export function workingSpinner(frame: string, ascii: boolean): string {
	const clean = sanitizeStatus(frame);
	const phase = BRAILLE_FRAMES.indexOf(clean);
	return ascii && phase >= 0 ? ASCII_FRAMES[Math.floor(phase * ASCII_FRAMES.length / BRAILLE_FRAMES.length)]! : clean;
}
