/** Car paint colours (sRGB hex), weighted toward the whites, greys and blacks of real traffic. */
export const PAINT_COLORS = [
  0xf2f2f0, 0xf2f2f0, 0xe8e8e6, 0x1b1c1e, 0x1b1c1e, 0x9aa0a6, 0x9aa0a6, 0x5d6166, 0x7d8286,
  0x1f3a5f, 0x8b1a1a, 0xb22222, 0x2e4d3a, 0xc9b27c, 0x6b4f3a, 0x3d5a80, 0xd9d4c7, 0x0f5257,
];

/** Fixed colours for liveried vehicles. */
export const LIVERY: Record<string, number> = { taxi: 0xf2c230, police: 0xf4f4f2, bus: 0xf1f1ee, boxTruck: 0xf1f1ee };
