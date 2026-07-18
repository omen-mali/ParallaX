/**
 * ParallaX CLI banner.
 *
 * Block wordmark with the brand violet on the X and a dim mono tagline.
 * Color is emitted only when safe: suppressed for non-TTY stdout, NO_COLOR,
 * or TERM=dumb, so piped/redirected output stays plain text.
 */

const TOP = "█▀█ ▄▀█ █▀█ ▄▀█ █   █   ▄▀█";
const BOTTOM = "█▀▀ █▀█ █▀▄ █▀█ █▄▄ █▄▄ █▀█";
const X_TOP = "▀▄▀";
const X_BOTTOM = "▄▀▄";
const TAGLINE = "one brain, three dialects";

const VIOLET_LIGHT = "\u001B[38;5;141m"; // ≈ #a78bfa
const VIOLET_DEEP = "\u001B[38;5;98m"; // ≈ #8b5cf6
const DIM = "\u001B[38;5;242m";
const RESET = "\u001B[0m";

export function colorAllowed(
  stream: { isTTY?: boolean } = process.stdout,
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  if (env.NO_COLOR !== undefined && env.NO_COLOR !== "") {
    return false;
  }
  if (env.TERM === "dumb") {
    return false;
  }
  return stream.isTTY === true;
}

export interface BannerOptions {
  version?: string;
  color?: boolean;
}

export function renderBanner(options: BannerOptions = {}): string {
  const color = options.color ?? colorAllowed();
  const meta =
    options.version === undefined
      ? `parallax · ${TAGLINE}`
      : `parallax v${options.version} · ${TAGLINE}`;
  if (!color) {
    return `${TOP} ${X_TOP}\n${BOTTOM} ${X_BOTTOM}\n\n${meta}\n\n`;
  }
  return [
    `${TOP} ${VIOLET_LIGHT}${X_TOP}${RESET}`,
    `${BOTTOM} ${VIOLET_DEEP}${X_BOTTOM}${RESET}`,
    "",
    `${DIM}${meta}${RESET}`,
    "",
    "",
  ].join("\n");
}
