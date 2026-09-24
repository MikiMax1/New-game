// Shared building constants: bucket keys, vertex attribute layout and the ids the
// facade / detail shaders understand. Pure data (no three.js), so the generator can
// run in a Web Worker and the renderer can turn the same numbers into GLSL #defines.

/** Bucket (= material) keys emitted by generateBuilding. */
export const BUILDING_FACADE_KEY = 'bldFacade';
export const BUILDING_DETAIL_KEY = 'bldDetail';
export const BUILDING_KEYS = [BUILDING_FACADE_KEY, BUILDING_DETAIL_KEY] as const;

/**
 * Facade bucket vertex layout (walls only; every wall is a vertical quad):
 * - position, normal (horizontal, outward)
 * - uv: u = metres along the wall, increasing to the right as seen from outside
 *       (i.e. along cross(up, normal)); v = metres above the building base (lot.groundY)
 * - color: base wall colour (linear RGB)
 * - facA: floorH, bayW, groundH, topH   (m; floors start at groundH; windows stop at topH)
 * - facB: winW, winH, sill, depth       (m; window size, sill above each floor, reveal depth)
 * - facC: pattern, ground, seed, glass + 8 * surface
 * - facD: trim r, g, b (linear), occupancy | crown << 2 | flags << 5
 */
export const FACADE_ATTRS = { facA: 4, facB: 4, facC: 4, facD: 4 } as const;

/**
 * Detail bucket vertex layout (roofs, parapets, awnings, ledges, equipment, signs...):
 * - uv: metres (surface-specific planar mapping); signs use atlas UVs
 * - color: base colour (linear RGB)
 * - detA: surface, seed, p1, p2
 */
export const DETAIL_ATTRS = { detA: 4 } as const;

/** Upper-floor facade patterns (facC.x). */
export const PAT = {
  BLANK: 0, // plain wall surface (optionally a mural)
  PUNCHED: 1, // punched windows with sills (apartments, older offices)
  CURTAIN: 2, // glass curtain wall with spandrels and mullions
  RIBBON: 3, // continuous horizontal window bands (MiMo / 1960s offices)
  BALCONY: 4, // continuous balconies: slab edges, glass rails, recessed glass
  DECO: 5, // Art Deco punched windows, fluting, relief spandrels, portholes
  EGGCRATE: 6, // MiMo brise-soleil grid of deep fins
  INDUSTRIAL: 7, // metal or tilt-up panels, optional clerestory windows
  GARAGE: 8, // open parking decks
  SIDING: 9, // clapboard / trailer siding with small windows
  MED: 10, // Mediterranean: casements, arched tops, shutters
  MODERN: 11, // modern villa: floor-to-ceiling glass alternating with solid panels
  LOUVER: 12, // mechanical louvres (tower tops, plant rooms)
  SCREEN: 13, // MiMo cheese-hole / breeze-block screen wall
} as const;

/** Ground floor treatments (facC.y). */
export const GND = {
  SAME: 0, // same windows as the upper floors
  SHOP: 1, // storefront glass, bulkhead, transom; doors in some bays
  SHOPDOOR: 2, // storefront bay with a door
  LOBBY: 3, // tall lobby glass
  BLANK: 4, // solid wall with a base band
  DOOR: 5, // single entrance door centred in the segment
  GARAGE: 6, // residential garage door centred in the segment
  DOCK: 7, // loading dock doors at 1.2 m with seals and bumpers
  ROLLUP: 8, // grade-level roll-up doors
  SHUTTER: 9, // storefront with roll-down security shutters
  ARCADE: 10, // arched loggia with recessed back wall
  PARKING: 11, // open parking level
  SERVICE: 12, // blank wall with occasional steel service doors
} as const;

/** Glass tints (low 3 bits of facC.w). */
export const GLASS = { CLEAR: 0, TEAL: 1, BLUE: 2, BRONZE: 3, SILVER: 4, DARK: 5, GREEN: 6, LOWE: 7 } as const;

/** Wall surface materials (facC.w >> 3). */
export const WSURF = { STUCCO: 0, CONCRETE: 1, METAL: 2, SIDING: 3, PANEL: 4, WOOD: 5, STONE: 6 } as const;

/** Night occupancy profiles (facD.w & 3). */
export const OCC = { RESIDENTIAL: 0, OFFICE: 1, HOTEL: 2, RETAIL: 3 } as const;

/** Facade flags (facD.w >> 5). */
export const FLAG = {
  AC: 1, // through-wall AC units under some windows
  BARS: 2, // security bars on windows
  SHUTTERS: 4, // wooden shutters beside windows
  ARCHED: 8, // arched window heads
  PORTHOLE: 16, // porthole windows in some bays
  DIVIDERS: 32, // balcony dividers / deco fluting
  METAL_RAIL: 64, // metal picket railings instead of glass
  MURAL: 128, // painted mural on blank walls
  SIGNBAND: 256, // painted sign band above storefronts
  FINS: 512, // vertical fins / mullion caps emphasised
  SPANDREL_PANEL: 1024, // opaque coloured spandrel panels instead of spandrel glass
  AWNING_SHADE: 2048, // storefront shaded by an awning (darker transom)
  DOOR_ALT: 4096, // storefronts: a door in every other bay (strip malls)
} as const;

/** Crown lighting colours (facD.w >> 2 & 7): 0 = none. Linear-ish RGB used by the shader. */
export const CROWN_COLORS: readonly (readonly [number, number, number])[] = [
  [0, 0, 0],
  [1.0, 0.25, 0.75], // magenta
  [0.2, 0.55, 1.0], // blue
  [0.55, 0.3, 1.0], // violet
  [0.2, 0.95, 0.9], // cyan
  [1.0, 0.95, 0.85], // white
  [1.0, 0.55, 0.2], // amber
  [0.35, 1.0, 0.45], // green
];

/** Detail surfaces (detA.x). */
export const DSURF = {
  PLAIN: 0, // painted stucco / concrete (ledges, parapets, fins, canopies)
  MEMBRANE: 1, // flat roof membrane (TPO / modified bitumen)
  GRAVEL: 2, // ballasted gravel roof
  TILE: 3, // barrel (Spanish) roof tiles; uv: u along eave, v up slope
  METAL_ROOF: 4, // corrugated / standing-seam metal; ribs along v
  AWNING: 5, // fabric awning; p1 = stripe width (0 = plain), p2 = stripe colour index
  EQUIPMENT: 6, // HVAC equipment; p1 = 1 for a top fan grille
  GLASS: 7, // glass (railings, skylights, sawtooth glazing)
  SIGN: 8, // sign text from the atlas; uv = atlas uv; p1 = text colour index, p2 = light mode
  HELIPAD: 9, // helipad markings; uv centred on the pad
  PARKING: 10, // asphalt with stall lines; p1 = stall width
  POOL: 11, // pool water with parallax tiled floor
  PAVERS: 12, // driveway / plaza pavers
  WOOD: 13, // wood planks (porches, docks, tanks)
  SOLAR: 14, // solar panels
  LED: 15, // light strip / neon tube (emissive at night)
  CONCRETE: 16, // raw concrete (columns, slabs, docks)
  DARK: 17, // dark rubber / openings / vents
  SHINGLE: 18, // asphalt shingles
  CANOPY: 19, // canopy soffit with downlights
} as const;

/** Sign light modes (detA.w for SIGN). */
export const SIGN_LIGHT = { PAINTED: 0, NEON: 1, BACKLIT: 2 } as const;

/** Sign text colours (detA.z for SIGN), linear RGB. */
export const SIGN_COLORS: readonly (readonly [number, number, number])[] = [
  [0.95, 0.95, 0.92], // white
  [1.0, 0.18, 0.55], // hot pink
  [0.1, 0.75, 1.0], // cyan
  [1.0, 0.8, 0.15], // yellow
  [0.9, 0.12, 0.1], // red
  [0.15, 0.85, 0.35], // green
  [0.04, 0.05, 0.08], // near black
  [0.08, 0.2, 0.55], // navy
];

/** Awning stripe colours (detA.w for AWNING), linear RGB. */
export const AWNING_STRIPE_COLORS: readonly (readonly [number, number, number])[] = [
  [0.9, 0.9, 0.86],
  [0.85, 0.82, 0.7],
  [0.05, 0.05, 0.06],
  [0.95, 0.75, 0.2],
];
