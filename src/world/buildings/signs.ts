// Sign texts and the layout of the sign atlas texture. The generator only needs the
// layout to compute UVs; src/render/buildingMaterials.ts draws the atlas at runtime.
// All names are original / generic words (no real brands or hotels).

export const SIGN_GROUPS = {
  shop: [
    'FARMACIA', 'CAFETERIA', 'BOTANICA', 'PANADERIA', 'MERCADO', 'JOYERIA', 'LAVANDERIA', 'FERRETERIA',
    'PELUQUERIA', 'RESTAURANTE', 'ZAPATERIA', 'FLORISTERIA', 'CARNICERIA', 'CAFE LA ESQUINA', 'BODEGA',
    'MUEBLERIA', 'OPTICA', 'DULCERIA', 'CASA DE CAMBIO', 'TIENDA',
  ],
  hotel: [
    'HOTEL MARISOL', 'BELLAMAR', 'CORALINA', 'LA BRISA', 'PALMERA', 'AQUAMARINA', 'SOL Y MAR',
    'HOTEL ESTRELLA', 'THE SEAGRAPE', 'OCEANAIRE', 'SANDPIPER', 'HOTEL LUNA', 'BAYLIGHT', 'ORQUIDEA',
  ],
  mall: [
    'NAILS', 'LAUNDROMAT', 'PHARMACY', 'DENTAL', 'PIZZA', 'TAX SERVICE', 'BEAUTY SUPPLY', 'CELL PHONES',
    'INSURANCE', 'DONUTS', 'CHECK CASHING', 'TACOS', 'DRY CLEANERS', 'LIQUOR', 'PAWN SHOP', 'BARBER',
  ],
  industrial: [
    'SOLMAR LOGISTICS', 'GULF MARINE SUPPLY', 'BAYSIDE COLD STORAGE', 'SUNCOAST TILE', 'PORT SOLMAR FREIGHT',
    'COASTAL PAPER CO', 'HARBOR STEEL', 'TROPIC PRODUCE',
  ],
  bait: ['BAIT & TACKLE', 'LIVE BAIT', 'AIRBOAT TOURS', 'COLD BEER', 'SWAMP STOP', 'FISH CAMP'],
} as const;

export type SignGroup = keyof typeof SIGN_GROUPS;

/** Flat list; the atlas slot of a text is its index here. */
export const SIGN_TEXTS: readonly string[] = [
  ...SIGN_GROUPS.shop, ...SIGN_GROUPS.hotel, ...SIGN_GROUPS.mall, ...SIGN_GROUPS.industrial, ...SIGN_GROUPS.bait,
];

export const SIGN_ATLAS = {
  width: 2048,
  height: 2048,
  cols: 2,
  rows: 32,
  slotW: 1024,
  slotH: 64,
  fontPx: 44,
} as const;

export function signIndex(group: SignGroup, k: number): number {
  let base = 0;
  for (const g of Object.keys(SIGN_GROUPS) as SignGroup[]) {
    if (g === group) return base + (((k % SIGN_GROUPS[g].length) + SIGN_GROUPS[g].length) % SIGN_GROUPS[g].length);
    base += SIGN_GROUPS[g].length;
  }
  return 0;
}

/** Approximate drawn width of a text in atlas pixels (bold caps). */
export function signTextWidth(index: number): number {
  const t = SIGN_TEXTS[index] ?? '';
  return Math.min(SIGN_ATLAS.slotW - 64, t.length * 0.66 * SIGN_ATLAS.fontPx);
}

/**
 * Atlas UV rectangle [u0, v0, u1, v1] for a sign W x H metres showing text `index`,
 * keeping the letter aspect when the sign is wide enough, squeezing the text otherwise.
 */
export function signUV(index: number, W: number, H: number): [number, number, number, number] {
  const A = SIGN_ATLAS;
  const col = Math.floor(index / A.rows) % A.cols;
  const row = index % A.rows;
  const cx = col * A.slotW + A.slotW / 2;
  const tw = signTextWidth(index);
  let span = (W / Math.max(0.05, H)) * A.slotH;
  span = Math.max(span, tw / 0.86);
  span = Math.min(span, A.slotW - 8);
  const u0 = (cx - span / 2) / A.width;
  const u1 = (cx + span / 2) / A.width;
  // canvas row 0 is at the top; textures are flipped so v = 1 is the top
  const v1 = 1 - (row * A.slotH + 2) / A.height;
  const v0 = 1 - ((row + 1) * A.slotH - 2) / A.height;
  return [u0, v0, u1, v1];
}
