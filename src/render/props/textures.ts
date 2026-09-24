// All prop textures, generated once per material set (browser / worker only; node tests
// skip textures). Tiling detail textures are close to white so vertex colours set the hue.

import type * as THREE from 'three';
import { Rng } from '../../world/rng';
import { clampByte, dataTexture, TileFbm, TileNoise } from './paint';
import { paintPalmLeafAtlas, paintPalmTrunkAtlas } from './texPalm';
import { paintFoliageAtlas } from './texFoliage';
import { paintSignAtlas } from './texSign';

export interface PropTextures {
  palmLeaf: THREE.Texture;
  palmTrunk: THREE.Texture;
  palmTrunkRoughness: THREE.Texture;
  foliage: THREE.Texture;
  bark: THREE.Texture;
  sign: THREE.Texture;
  metal: THREE.Texture;
  grime: THREE.Texture;
  concrete: THREE.Texture;
  wood: THREE.Texture;
  fabric: THREE.Texture;
}

export function createPropTextures(): PropTextures {
  const trunk = paintPalmTrunkAtlas();
  return {
    palmLeaf: paintPalmLeafAtlas(),
    palmTrunk: trunk.map,
    palmTrunkRoughness: trunk.roughness,
    foliage: paintFoliageAtlas(),
    bark: barkTexture(),
    sign: paintSignAtlas(),
    metal: metalTexture(),
    grime: grimeTexture(),
    concrete: concreteTexture(),
    wood: woodTexture(),
    fabric: fabricTexture(),
  };
}

/** Live-oak bark: dark grey-brown, deep vertical furrows broken into blocky ridges. */
function barkTexture(): THREE.Texture {
  // Deep vertical furrows (ridges warped along v) broken into long plates by faint
  // horizontal cracks; dark grey-brown with lighter ridge tops.
  const rng = new Rng('bark');
  const warp = new TileFbm(3, 6, 4, rng.fork('w'));
  const plates = new TileNoise(10, 5, rng.fork('p'));
  const fine = new TileFbm(24, 24, 3, rng.fork('f'));
  const lichen = new TileFbm(4, 4, 4, rng.fork('l'));
  return dataTexture(512, 512, (u, v) => {
    const wu = u + 0.08 * (warp.sample(u, v) - 0.5);
    const ridge = Math.abs(Math.sin(wu * Math.PI * 9));
    const furrow = Math.pow(ridge, 0.45);
    const plate = plates.sample(wu, v);
    const crack = Math.abs(Math.sin(v * Math.PI * 10 + plate * 6)) < 0.08 ? 0.7 : 1;
    const k = (0.3 + 0.7 * furrow) * crack * (0.82 + 0.36 * fine.sample(u, v));
    const l = Math.max(0, lichen.sample(u, v) - 0.62) * 1.6;
    return [clampByte((104 + 60 * l) * k), clampByte((96 + 64 * l) * k), clampByte((88 + 40 * l) * k)];
  });
}

/** Galvanised steel: faint spangle cells and streaks. */
function metalTexture(): THREE.Texture {
  const rng = new Rng('metal');
  const cells = new TileNoise(40, 40, rng.fork('c'));
  const streak = new TileNoise(6, 60, rng.fork('s'));
  const blot = new TileFbm(3, 3, 4, rng.fork('b'));
  return dataTexture(256, 256, (u, v) => {
    const cx = Math.floor(u * 40), cy = Math.floor(v * 40);
    const cell = cells.sample((cx + 0.5) / 40, (cy + 0.5) / 40);
    const k = 0.9 + 0.06 * (cell - 0.5) + 0.05 * (streak.sample(u, v) - 0.5) + 0.12 * (blot.sample(u, v) - 0.5);
    return [clampByte(240 * k), clampByte(240 * k), clampByte(238 * k)];
  });
}

/** Near-white grime: subtle dirt blotches for paint and plastic. */
function grimeTexture(): THREE.Texture {
  const rng = new Rng('grime');
  const blot = new TileFbm(3, 3, 5, rng.fork('b'));
  const fine = new TileNoise(128, 128, rng.fork('f'));
  return dataTexture(256, 256, (u, v) => {
    const k = 0.93 + 0.12 * (blot.sample(u, v) - 0.5) + 0.03 * (fine.sample(u, v) - 0.5);
    return [clampByte(250 * k), clampByte(249 * k), clampByte(246 * k)];
  });
}

/** Concrete: fine grain, pits and soft stains. */
function concreteTexture(): THREE.Texture {
  const rng = new Rng('concrete');
  const blot = new TileFbm(4, 4, 5, rng.fork('b'));
  const grain = new TileNoise(256, 256, rng.fork('g'));
  const pits = new TileNoise(96, 96, rng.fork('p'));
  return dataTexture(256, 256, (u, v) => {
    const p = pits.sample(u, v) > 0.86 ? 0.82 : 1;
    const k = (0.9 + 0.14 * (blot.sample(u, v) - 0.5) + 0.07 * (grain.sample(u, v) - 0.5)) * p;
    return [clampByte(246 * k), clampByte(244 * k), clampByte(238 * k)];
  });
}

/** Wood: grain running along v (vertical), plank-to-plank variation. */
function woodTexture(): THREE.Texture {
  const rng = new Rng('wood');
  const warp = new TileFbm(2, 8, 4, rng.fork('w'));
  const rings = new TileNoise(24, 3, rng.fork('r'));
  const fine = new TileNoise(128, 16, rng.fork('f'));
  return dataTexture(256, 256, (u, v) => {
    const g = rings.sample(u + 0.08 * warp.sample(u, v), v);
    const band = 0.5 + 0.5 * Math.sin(g * 40);
    const k = 0.82 + 0.1 * band + 0.08 * (fine.sample(u, v) - 0.5);
    return [clampByte(250 * k), clampByte(240 * k), clampByte(225 * k)];
  });
}

/** Woven fabric: fine cross-hatch. */
function fabricTexture(): THREE.Texture {
  const rng = new Rng('fabric');
  const blot = new TileFbm(2, 2, 3, rng.fork('b'));
  return dataTexture(128, 128, (u, v) => {
    const x = Math.floor(u * 128), y = Math.floor(v * 128);
    const weave = (x + y) % 2 === 0 ? 1 : 0.94;
    const k = weave * (0.95 + 0.06 * (blot.sample(u, v) - 0.5));
    return [clampByte(252 * k), clampByte(252 * k), clampByte(250 * k)];
  });
}
