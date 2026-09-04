#!/usr/bin/env bun
/**
 * P4 W1 — "Graph lane colours are the only palette we invent" (§3.4). Generates, from one small
 * source table of hues, four sets of eight lane colours (one per theme kind) and writes two
 * artifacts: `contributes.colors` entries in `packages/host-vscode/package.json` (so VS Code
 * injects `--vscode-kiraVersion-graphLaneN` per the active theme kind, themable via
 * `workbench.colorCustomizations`) and the literal fallback chain plus the CSS rules that
 * consume it in `packages/ui/src/theme/vscode-tokens.css`.
 *
 * **Only the "dark" kind's colours become the CSS literal fallback.** `--vscode-*` names VS
 * Code did not itself define as a colour id (a *contributed* id, like ours) are never found in
 * a theme's own JSON, so nothing else can supply them at runtime when no VS Code is present —
 * which is exactly the harness's everyday situation (`apps/harness/src/themeSwitcher.ts` injects
 * only a small hand-written dev palette, not the full contributed set). The single literal
 * fallback governs that case regardless of theme kind: one lane palette when nothing else
 * provides one, four when VS Code does.
 *
 * Two checks are the substance of this file, not the colours themselves:
 *  - **Contrast**: every lane colour against its kind's `editor.background`, at the WCAG
 *    non-text-contrast bar (3:1; 4.5:1 for the two high-contrast kinds), with a margin so a
 *    rounding difference between this script's arithmetic and a browser's never flips the bar.
 *  - **Distinguishability under CVD**: every pair of the eight (which subsumes every adjacent
 *    pair), simulated under protanopia, deuteranopia and tritanopia via the commonly-used
 *    Brettel/Viénot linear-RGB approximation matrices, must clear a CIE76 ΔE threshold —
 *    "clearly different", not merely "technically distinct".
 *
 * `--check` (wired into `bun run check` as `check:lane-palette`) regenerates both artifacts in
 * memory and fails if either differs from what's on disk — the same discipline
 * `gen-settings.ts` already applies, catching a hand-edit or a stale file after this script's
 * own source table changed.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const PACKAGE_JSON_PATH = join(import.meta.dir, "..", "packages", "host-vscode", "package.json");
const TOKENS_CSS_PATH = join(
  import.meta.dir,
  "..",
  "packages",
  "ui",
  "src",
  "theme",
  "vscode-tokens.css",
);

const LANE_COUNT = 8;

// ---------------------------------------------------------------------------------------
// Colour math — sRGB <-> linear <-> XYZ <-> Lab, WCAG contrast, and the three CVD matrices.
// No dependency: this is the "twenty lines of arithmetic" AGENTS.md's prefer-a-library rule
// explicitly does not ask for here.
// ---------------------------------------------------------------------------------------

type Rgb = readonly [r: number, g: number, b: number]; // sRGB, 0..1
type Lab = readonly [l: number, a: number, b: number];

function srgbToLinear(c: number): number {
  return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
}

function linearToSrgb(c: number): number {
  const clamped = Math.min(1, Math.max(0, c));
  return clamped <= 0.0031308 ? clamped * 12.92 : 1.055 * clamped ** (1 / 2.4) - 0.055;
}

function toLinear(rgb: Rgb): Rgb {
  return [srgbToLinear(rgb[0]), srgbToLinear(rgb[1]), srgbToLinear(rgb[2])];
}

function toSrgb(rgbLinear: Rgb): Rgb {
  return [linearToSrgb(rgbLinear[0]), linearToSrgb(rgbLinear[1]), linearToSrgb(rgbLinear[2])];
}

/** Standard HSL -> sRGB, h in degrees, s/l in 0..1. */
function hslToRgb(h: number, s: number, l: number): Rgb {
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const hp = (((h % 360) + 360) % 360) / 60;
  const x = c * (1 - Math.abs((hp % 2) - 1));
  let [r1, g1, b1] = [0, 0, 0];
  if (hp < 1) [r1, g1, b1] = [c, x, 0];
  else if (hp < 2) [r1, g1, b1] = [x, c, 0];
  else if (hp < 3) [r1, g1, b1] = [0, c, x];
  else if (hp < 4) [r1, g1, b1] = [0, x, c];
  else if (hp < 5) [r1, g1, b1] = [x, 0, c];
  else [r1, g1, b1] = [c, 0, x];
  const m = l - c / 2;
  return [r1 + m, g1 + m, b1 + m];
}

function hexToRgb(hex: string): Rgb {
  const n = Number.parseInt(hex.slice(1), 16);
  return [((n >> 16) & 0xff) / 255, ((n >> 8) & 0xff) / 255, (n & 0xff) / 255];
}

function rgbToHex(rgb: Rgb): string {
  const toByte = (c: number) => Math.round(Math.min(1, Math.max(0, c)) * 255);
  return `#${[rgb[0], rgb[1], rgb[2]]
    .map((c) => toByte(c).toString(16).padStart(2, "0"))
    .join("")}`;
}

/** WCAG relative luminance — the dot product both the contrast formula and the sRGB->XYZ `Y`
 *  row use, kept as one function since they are the same weights. */
function relativeLuminance(rgbLinear: Rgb): number {
  return 0.2126 * rgbLinear[0] + 0.7152 * rgbLinear[1] + 0.0722 * rgbLinear[2];
}

/** WCAG contrast ratio (SC 1.4.11's non-text formula is the same arithmetic as 1.4.3's text
 *  one — only the bar differs, and the bar is a caller concern, not this function's). */
function contrastRatio(a: Rgb, b: Rgb): number {
  const la = relativeLuminance(toLinear(a));
  const lb = relativeLuminance(toLinear(b));
  const [lighter, darker] = la >= lb ? [la, lb] : [lb, la];
  return (lighter + 0.05) / (darker + 0.05);
}

function linearToXyz(rgbLinear: Rgb): readonly [number, number, number] {
  const [r, g, b] = rgbLinear;
  return [
    0.4124564 * r + 0.3575761 * g + 0.1804375 * b,
    0.2126729 * r + 0.7151522 * g + 0.072175 * b,
    0.0193339 * r + 0.119192 * g + 0.9503041 * b,
  ];
}

const D65 = { x: 0.95047, y: 1.0, z: 1.08883 };

function xyzToLab(xyz: readonly [number, number, number]): Lab {
  const f = (t: number) => (t > (6 / 29) ** 3 ? Math.cbrt(t) : t / (3 * (6 / 29) ** 2) + 4 / 29);
  const fx = f(xyz[0] / D65.x);
  const fy = f(xyz[1] / D65.y);
  const fz = f(xyz[2] / D65.z);
  return [116 * fy - 16, 500 * (fx - fy), 200 * (fy - fz)];
}

function toLab(rgb: Rgb): Lab {
  return xyzToLab(linearToXyz(toLinear(rgb)));
}

function deltaE76(a: Lab, b: Lab): number {
  return Math.sqrt((a[0] - b[0]) ** 2 + (a[1] - b[1]) ** 2 + (a[2] - b[2]) ** 2);
}

/** Simplified Brettel/Viénot-style dichromacy simulation matrices, applied in linear RGB —
 *  the standard, widely-used approximation (e.g. as shipped in many open-source colourblind
 *  simulators): each output channel is a fixed linear combination of the input's linear R/G/B,
 *  collapsing the dimension the deficiency removes. Good enough to catch "these two hues
 *  collapse to the same colour", which is the only thing this check needs. */
const CVD_MATRICES: Readonly<Record<string, readonly (readonly [number, number, number])[]>> = {
  protanopia: [
    [0.567, 0.433, 0],
    [0.558, 0.442, 0],
    [0, 0.242, 0.758],
  ],
  deuteranopia: [
    [0.625, 0.375, 0],
    [0.7, 0.3, 0],
    [0, 0.3, 0.7],
  ],
  tritanopia: [
    [0.95, 0.05, 0],
    [0, 0.433, 0.567],
    [0, 0.475, 0.525],
  ],
};

function applyCvd(rgbLinear: Rgb, matrix: readonly (readonly [number, number, number])[]): Rgb {
  const [m0, m1, m2] = matrix;
  if (!m0 || !m1 || !m2) throw new Error("unreachable: CVD matrix must have 3 rows");
  const [r, g, b] = rgbLinear;
  return [
    m0[0] * r + m0[1] * g + m0[2] * b,
    m1[0] * r + m1[1] * g + m1[2] * b,
    m2[0] * r + m2[1] * g + m2[2] * b,
  ];
}

/** "Clearly different" under CIE76 ΔE — well above the ~2.3 just-noticeable-difference bar,
 *  chosen so two lane colours read as distinct even after a CVD simulation desaturates and
 *  hue-shifts them, not merely as technically unequal. */
const DISTINGUISHABILITY_THRESHOLD = 10;

interface DistinguishabilityViolation {
  readonly kind: string;
  readonly variant: string;
  readonly laneA: number;
  readonly laneB: number;
  readonly deltaE: number;
}

/** Every pair of `colors` (which is every adjacent pair too, since adjacency is a subset of
 *  "every pair"), under normal vision and each of the three CVD simulations. Returns every
 *  violation found rather than throwing on the first — `findPalette`'s search needs to know
 *  whether a candidate failed, not just that one did. */
function findDistinguishabilityViolations(
  kind: string,
  colors: readonly string[],
): readonly DistinguishabilityViolation[] {
  const variants: Readonly<Record<string, (rgb: Rgb) => Rgb>> = {
    "normal vision": (rgb) => rgb,
    protanopia: (rgb) => toSrgb(applyCvd(toLinear(rgb), CVD_MATRICES.protanopia as never)),
    deuteranopia: (rgb) => toSrgb(applyCvd(toLinear(rgb), CVD_MATRICES.deuteranopia as never)),
    tritanopia: (rgb) => toSrgb(applyCvd(toLinear(rgb), CVD_MATRICES.tritanopia as never)),
  };
  const violations: DistinguishabilityViolation[] = [];
  for (const [variantName, simulate] of Object.entries(variants)) {
    const labs = colors.map((hex) => toLab(simulate(hexToRgb(hex))));
    for (let i = 0; i < labs.length; i++) {
      for (let j = i + 1; j < labs.length; j++) {
        const a = labs[i];
        const b = labs[j];
        if (!a || !b) throw new Error("unreachable: labs indexed within bounds");
        const de = deltaE76(a, b);
        if (de < DISTINGUISHABILITY_THRESHOLD) {
          violations.push({ kind, variant: variantName, laneA: i, laneB: j, deltaE: de });
        }
      }
    }
  }
  return violations;
}

// ---------------------------------------------------------------------------------------
// The source table: hues + saturations, and the per-kind lightness search against contrast.
// ---------------------------------------------------------------------------------------

/**
 * Both protanopia and deuteranopia simulation matrices collapse the red-green axis, leaving
 * (roughly) only a blue<->yellow axis plus lightness to distinguish colours by — a fact an
 * evenly-spaced 45°-per-lane hue wheel runs straight into: some pair among eight hues 45° apart
 * always lands inside the red-green confusion zone (verified empirically while building this
 * script — see its Findings entry in docs/plans/P4.md). So lane *hue* carries only one bit: a
 * lane is either "blue" or "orange", the two ends of the axis every one of the three CVD
 * variants here preserves best. What distinguishes the four lanes *within* one hue is lightness
 * and saturation (`LANE_TIERS` below) — a channel CVD does not remove.
 *
 * The two hues themselves are not the geometric complement (that would be ~35°); they were
 * picked by a small offline grid search over both hues (5° steps, blue in 195..265, orange in
 * 15..65) maximising the worst-case ΔE across every lane pair, CVD variant and theme kind —
 * 205°/15° won that search by a wide margin (worst pair ΔE ≈ 12, against a 10 bar) over the
 * naive 205°/25° complement (worst pair ΔE ≈ 6, i.e. barely passing).
 */
const CLUSTER_HUES: readonly [blue: number, orange: number] = [205, 15];

/**
 * Saturation and target-contrast tiers, keyed by `Math.floor(lane / 2)`: lanes 0/1 share tier 0
 * (one blue, one orange), lanes 2/3 share tier 1, and so on — every lane's (hue, tier) pair is
 * unique, and the four tiers sharing a hue are what CVD-distinguishability actually rests on, so
 * their saturation *and* target-contrast move together, monotonically, from tier to tier. A
 * non-monotonic tier order (tried first) let two non-adjacent tiers land at nearly the same
 * rendered lightness despite different-looking multipliers, which is exactly the "two lanes
 * quietly converge" failure this scheme exists to rule out.
 */
const LANE_TIERS: readonly { readonly saturation: number; readonly targetMultiplier: number }[] = [
  { saturation: 0.9, targetMultiplier: 1.0 },
  { saturation: 0.72, targetMultiplier: 1.7 },
  { saturation: 0.52, targetMultiplier: 2.4 },
  { saturation: 0.32, targetMultiplier: 3.1 },
];

interface ThemeKindSpec {
  readonly key: "dark" | "light" | "high-contrast" | "high-contrast-light";
  readonly manifestKey: "dark" | "light" | "highContrast" | "highContrastLight";
  readonly background: string;
  readonly contrastBar: number;
}

const THEME_KINDS: readonly ThemeKindSpec[] = [
  { key: "dark", manifestKey: "dark", background: "#1e1e1e", contrastBar: 3 },
  { key: "light", manifestKey: "light", background: "#ffffff", contrastBar: 3 },
  { key: "high-contrast", manifestKey: "highContrast", background: "#000000", contrastBar: 4.5 },
  {
    key: "high-contrast-light",
    manifestKey: "highContrastLight",
    background: "#ffffff",
    contrastBar: 4.5,
  },
];

const LIGHTNESS_STEP = 0.01;

function pickLightness(
  hue: number,
  saturation: number,
  background: Rgb,
  bar: number,
  targetMultiplier: number,
): number {
  const bgLuminance = relativeLuminance(toLinear(background));
  const target = bar * targetMultiplier;
  if (bgLuminance < 0.5) {
    // Dark background: search upward from a mid lightness toward white.
    for (let l = 0.35; l <= 0.97; l += LIGHTNESS_STEP) {
      const rgb = hslToRgb(hue, saturation, l);
      if (contrastRatio(rgb, background) >= target) return l;
    }
  } else {
    // Light background: search downward toward black.
    for (let l = 0.6; l >= 0.03; l -= LIGHTNESS_STEP) {
      const rgb = hslToRgb(hue, saturation, l);
      if (contrastRatio(rgb, background) >= target) return l;
    }
  }
  throw new Error(
    `gen-lane-palette: no lightness for hue ${hue}° sat ${saturation} clears contrast ` +
      `bar ${bar}:1 against background ${rgbToHex(background)}`,
  );
}

function generatePalette(spec: ThemeKindSpec): readonly string[] {
  const background = hexToRgb(spec.background);
  const colors: string[] = [];
  for (let lane = 0; lane < LANE_COUNT; lane++) {
    const hue = CLUSTER_HUES[lane % 2];
    const tier = LANE_TIERS[Math.floor(lane / 2) % LANE_TIERS.length];
    if (!tier) throw new Error("unreachable: LANE_TIERS indexed by floor(lane / 2) % length");
    const lightness = pickLightness(
      hue,
      tier.saturation,
      background,
      spec.contrastBar,
      tier.targetMultiplier,
    );
    colors.push(rgbToHex(hslToRgb(hue, tier.saturation, lightness)));
  }
  return colors;
}

interface GeneratedPalettes {
  readonly byKind: Readonly<Record<ThemeKindSpec["key"], readonly string[]>>;
}

/** Builds all four kinds' palettes from the fixed `CLUSTER_HUES`/`LANE_TIERS` source table and
 *  re-verifies CVD-distinguishability at generation time (contrast is guaranteed by construction:
 *  `pickLightness` never returns a lightness that misses the bar). This is a regression guard,
 *  not a search — the source table above is the one committed design, picked by an offline grid
 *  search recorded in `CLUSTER_HUES`'s own comment; if it is ever hand-edited to something that
 *  no longer clears the bar, this throws with the exact offending pairs rather than silently
 *  writing an insufficiently-distinguishable palette. */
function generateAll(): GeneratedPalettes {
  const byKind = Object.fromEntries(
    THEME_KINDS.map((spec) => [spec.key, generatePalette(spec)]),
  ) as Record<ThemeKindSpec["key"], readonly string[]>;

  const violations = THEME_KINDS.flatMap((spec) =>
    findDistinguishabilityViolations(spec.key, byKind[spec.key]),
  );
  if (violations.length > 0) {
    const detail = violations
      .map(
        (v) => `${v.kind}/${v.variant} lane${v.laneA}<->lane${v.laneB} ΔE=${v.deltaE.toFixed(2)}`,
      )
      .join("; ");
    throw new Error(
      `gen-lane-palette: CLUSTER_HUES/LANE_TIERS no longer clear the CVD-distinguishability bar ` +
        `(${DISTINGUISHABILITY_THRESHOLD}): ${detail}`,
    );
  }
  return { byKind };
}

// ---------------------------------------------------------------------------------------
// Rendering: contributes.colors (package.json) and the CSS token/rule block.
// ---------------------------------------------------------------------------------------

function laneId(lane: number): string {
  return `kiraVersion.graphLane${lane}`;
}

function renderColorsContribution(palettes: GeneratedPalettes): readonly unknown[] {
  const entries: unknown[] = [];
  for (let lane = 0; lane < LANE_COUNT; lane++) {
    const defaults: Record<string, string> = {};
    for (const spec of THEME_KINDS) {
      const value = palettes.byKind[spec.key][lane];
      if (value === undefined) throw new Error("unreachable: palette has LANE_COUNT entries");
      defaults[spec.manifestKey] = value;
    }
    entries.push({
      id: laneId(lane),
      description: `Kira Version: commit graph lane colour ${lane}.`,
      defaults,
    });
  }
  return entries;
}

const CSS_TOKENS_START =
  "  /* kv-lane-tokens:start (scripts/gen-lane-palette.ts) — do not hand-edit */";
const CSS_TOKENS_END = "  /* kv-lane-tokens:end */";
const CSS_RULES_START =
  "/* kv-lane-rules:start (scripts/gen-lane-palette.ts) — do not hand-edit */";
const CSS_RULES_END = "/* kv-lane-rules:end */";
const CSS_OUTLINE_START =
  "  /* kv-lane-outline:start (scripts/gen-lane-palette.ts) — do not hand-edit */";
const CSS_OUTLINE_END = "  /* kv-lane-outline:end */";

function renderCssTokens(palettes: GeneratedPalettes): string {
  const darkColors = palettes.byKind.dark;
  const lines = Array.from({ length: LANE_COUNT }, (_, lane) => {
    const literal = darkColors[lane];
    return `  --kv-graph-lane-${lane}: var(--vscode-kiraVersion-graphLane${lane}, ${literal});`;
  });
  return [CSS_TOKENS_START, ...lines, CSS_TOKENS_END].join("\n");
}

// Biome's CSS formatter always expands a rule body onto its own lines, never keeping a
// single-line `{ ... }` — the generator has to emit that shape itself, or `--check` would see
// its own freshly-generated file as "out of date" the moment `bun run format` touches it.
function renderCssRules(): string {
  const laneRules = Array.from({ length: LANE_COUNT }, (_, lane) =>
    [
      `.kv-lane-${lane} {`,
      `  stroke: var(--kv-graph-lane-${lane});`,
      `  fill: var(--kv-graph-lane-${lane});`,
      "}",
    ].join("\n"),
  );
  const nodeRule = [
    ".kv-node {",
    "  stroke: var(--kv-graph-node-outline, none);",
    "  stroke-width: var(--kv-graph-node-outline-width, 0);",
    "}",
  ].join("\n");
  return [CSS_RULES_START, ...laneRules, nodeRule, CSS_RULES_END].join("\n");
}

function renderCssOutlineTokens(): string {
  return [
    CSS_OUTLINE_START,
    "  --kv-graph-node-outline: var(--vscode-contrastActiveBorder, #f38518);",
    "  --kv-graph-node-outline-width: 1.5px;",
    CSS_OUTLINE_END,
  ].join("\n");
}

function replaceBetweenMarkers(
  source: string,
  startMarker: string,
  endMarker: string,
  replacement: string,
): string {
  const startIndex = source.indexOf(startMarker);
  const endIndex = source.indexOf(endMarker);
  if (startIndex === -1 || endIndex === -1 || endIndex < startIndex) {
    throw new Error(
      `gen-lane-palette: markers ${JSON.stringify(startMarker)} / ${JSON.stringify(endMarker)} ` +
        "not found (or out of order) in vscode-tokens.css",
    );
  }
  const before = source.slice(0, startIndex);
  const after = source.slice(endIndex + endMarker.length);
  return `${before}${replacement}${after}`;
}

function renderTokensCss(currentCss: string, palettes: GeneratedPalettes): string {
  let next = replaceBetweenMarkers(
    currentCss,
    CSS_TOKENS_START,
    CSS_TOKENS_END,
    renderCssTokens(palettes),
  );
  next = replaceBetweenMarkers(next, CSS_OUTLINE_START, CSS_OUTLINE_END, renderCssOutlineTokens());
  next = replaceBetweenMarkers(next, CSS_RULES_START, CSS_RULES_END, renderCssRules());
  return next;
}

function renderPackageJson(currentJson: string, palettes: GeneratedPalettes): string {
  const manifest = JSON.parse(currentJson) as Record<string, unknown>;
  const contributes = (manifest.contributes as Record<string, unknown> | undefined) ?? {};
  const next = {
    ...manifest,
    contributes: { ...contributes, colors: renderColorsContribution(palettes) },
  };
  return `${JSON.stringify(next, null, 2)}\n`;
}

// ---------------------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------------------

function main(): void {
  const check = process.argv.includes("--check");
  const palettes = generateAll();

  const currentPackageJson = readFileSync(PACKAGE_JSON_PATH, "utf8");
  const nextPackageJson = renderPackageJson(currentPackageJson, palettes);

  const currentTokensCss = readFileSync(TOKENS_CSS_PATH, "utf8");
  const nextTokensCss = renderTokensCss(currentTokensCss, palettes);

  if (check) {
    const problems: string[] = [];
    if (nextPackageJson !== currentPackageJson) {
      problems.push("packages/host-vscode/package.json's contributes.colors is out of date");
    }
    if (nextTokensCss !== currentTokensCss) {
      problems.push(
        "packages/ui/src/theme/vscode-tokens.css's generated lane block is out of date",
      );
    }
    if (problems.length > 0) {
      console.error(
        `gen-lane-palette --check: ${problems.join("; ")} — run \`bun run gen:lane-palette\`.`,
      );
      process.exit(1);
    }
    console.log("gen-lane-palette --check: both generated artifacts are up to date.");
    return;
  }

  writeFileSync(PACKAGE_JSON_PATH, nextPackageJson);
  writeFileSync(TOKENS_CSS_PATH, nextTokensCss);
  console.log(
    "gen-lane-palette: wrote packages/host-vscode/package.json (contributes.colors) and " +
      "packages/ui/src/theme/vscode-tokens.css (lane tokens + rules).",
  );
}

main();
