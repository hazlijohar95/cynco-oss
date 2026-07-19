// Shared RGB triple for the color-science helpers: 8-bit channels (0-255) as
// parsed from the palette hex strings. Kept as a plain object so every helper
// in src/color stays pure and dependency-free.
export type Rgb = { r: number; g: number; b: number };
