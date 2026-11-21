declare module 'gifenc' {
  export function GIFEncoder(): { writeFrame(index: Uint8Array, w: number, h: number, o?: { palette?: number[][]; delay?: number; repeat?: number; transparent?: boolean }): void; finish(): void; bytes(): Uint8Array };
  export function quantize(rgba: Uint8Array | Uint8ClampedArray, max: number, o?: { format?: string }): number[][];
  export function applyPalette(rgba: Uint8Array | Uint8ClampedArray, palette: number[][], format?: string): Uint8Array;
}
