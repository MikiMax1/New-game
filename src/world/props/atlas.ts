// Texture atlas layouts shared by the geometry builders (which assign UVs) and the texture
// painters in src/render/props/textures.ts (which draw into the same rectangles).
//
// Rectangles are given in atlas pixels with the origin at the TOP-LEFT (canvas convention)
// and converted to UVs with v pointing up (v = 1 at the top row), which is how the
// render side uploads the textures.

export interface UvRect {
  u0: number;
  v0: number;
  u1: number;
  v1: number;
}

export interface PixelRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface AtlasRegion extends UvRect {
  px: PixelRect;
}

function region(atlasW: number, atlasH: number, x: number, y: number, w: number, h: number): AtlasRegion {
  return { u0: x / atlasW, u1: (x + w) / atlasW, v0: 1 - (y + h) / atlasH, v1: 1 - y / atlasH, px: { x, y, w, h } };
}

/** UV inside a region: (s, t) in [0, 1]^2 with t = 0 at the bottom of the region. */
export function regionUv(r: UvRect, s: number, t: number): [number, number] {
  return [r.u0 + (r.u1 - r.u0) * s, r.v0 + (r.v1 - r.v0) * t];
}

// ---------------------------------------------------------------------------------------
// Palm leaves (alpha-tested). Pinnate fronds are drawn vertically: the rachis runs up the
// middle of the column (s = 0.5), t = 0 is the frond base and t = 1 its tip. Fan leaves are
// "unwrapped": s is the angle across the fan, t the distance from the hastula.
export const PALM_LEAF_SIZE = { w: 2048, h: 1024 };
const pl = (x: number, y: number, w: number, h: number) => region(PALM_LEAF_SIZE.w, PALM_LEAF_SIZE.h, x, y, w, h);
export const PALM_LEAF = {
  royalA: pl(0, 0, 256, 1024),
  royalB: pl(256, 0, 256, 1024),
  coconutA: pl(512, 0, 256, 1024),
  coconutB: pl(768, 0, 256, 1024),
  dead: pl(1024, 0, 256, 1024),
  sabalFan: pl(1280, 0, 512, 512),
  sabalFanDead: pl(1280, 512, 512, 512),
  boot: pl(1792, 0, 256, 256),
  spear: pl(1792, 256, 256, 256),
} as const;

// ---------------------------------------------------------------------------------------
// Palm trunks. Each column wraps once around the trunk (s) and tiles vertically every
// PALM_TRUNK_TILE metres (the texture repeats in t).
export const PALM_TRUNK_SIZE = { w: 1024, h: 512 };
const pt = (x: number, y: number, w: number, h: number) => region(PALM_TRUNK_SIZE.w, PALM_TRUNK_SIZE.h, x, y, w, h);
export const PALM_TRUNK = {
  royal: pt(0, 0, 256, 512),
  crownshaft: pt(256, 0, 256, 512),
  coconut: pt(512, 0, 256, 512),
  sabal: pt(768, 0, 128, 512),
  sabalBoots: pt(896, 0, 128, 512),
} as const;
export const PALM_TRUNK_TILE: Record<keyof typeof PALM_TRUNK, number> = {
  royal: 2.4,
  crownshaft: 2.0,
  coconut: 1.4,
  sabal: 1.6,
  sabalBoots: 1.1,
};

// ---------------------------------------------------------------------------------------
// Broadleaf foliage (alpha-tested): leaf clusters, hedge surface, grass, Spanish moss.
export const FOLIAGE_SIZE = { w: 1024, h: 1024 };
const fo = (x: number, y: number, w: number, h: number) => region(FOLIAGE_SIZE.w, FOLIAGE_SIZE.h, x, y, w, h);
export const FOLIAGE = {
  oakA: fo(0, 0, 512, 512),
  oakB: fo(512, 0, 512, 512),
  shrubGreen: fo(0, 512, 256, 256),
  shrubCroton: fo(256, 512, 256, 256),
  shrubFlower: fo(512, 512, 256, 256),
  hedge: fo(768, 512, 256, 256),
  grass: fo(0, 768, 256, 256),
  duneGrass: fo(256, 768, 256, 256),
  moss: fo(512, 768, 128, 256),
  grassDry: fo(640, 768, 128, 256),
  ixora: fo(768, 768, 256, 256),
} as const;

// ---------------------------------------------------------------------------------------
// Printed faces: signs, labels, grilles, posters. Opaque.
export const SIGN_SIZE = { w: 1024, h: 1024 };
const sg = (x: number, y: number, w: number, h: number) => region(SIGN_SIZE.w, SIGN_SIZE.h, x, y, w, h);
export const STREET_NAMES = ['SOLMAR BLVD', 'OCEAN DR', 'SW 8 ST', 'CORAL WAY', 'BAYSHORE AVE', 'PALMETTO ST'] as const;
export const SIGN = {
  stop: sg(0, 0, 256, 256),
  allWay: sg(256, 0, 256, 96),
  busStop: sg(256, 96, 128, 160),
  pedHand: sg(384, 96, 64, 64),
  pedWalk: sg(448, 96, 64, 64),
  lens: sg(384, 160, 64, 64),
  pushButton: sg(448, 160, 64, 64),
  streetNames: STREET_NAMES.map((_, i) => sg(512, i * 96, 512, 96)),
  adA: sg(0, 256, 256, 384),
  adB: sg(256, 256, 256, 384),
  fanGrille: sg(0, 640, 128, 128),
  louver: sg(128, 640, 128, 128),
  coilGuard: sg(256, 640, 128, 128),
  meterFace: sg(384, 640, 128, 128),
  newspaper: [sg(512, 576, 512, 64), sg(512, 640, 512, 64), sg(512, 704, 512, 64)],
  lifeguard: sg(512, 768, 256, 64),
  trashLabel: sg(768, 768, 256, 64),
  payStation: sg(0, 768, 128, 256),
  stripes: sg(128, 768, 128, 128),
  hazard: sg(256, 768, 128, 128),
  bigBelly: sg(384, 768, 128, 256),
  transformer: sg(128, 896, 128, 128),
  crosswalkPlaque: sg(512, 832, 256, 128),
  oneWay: sg(768, 832, 256, 96),
} as const;

// ---------------------------------------------------------------------------------------
// Tiling material textures (u, v in metres / TILE_METRES).
export const TILE_METRES = {
  concrete: 2,
  wood: 1.5,
  metal: 1.5,
  grime: 2,
  bark: 1.6,
  fabric: 1,
} as const;
