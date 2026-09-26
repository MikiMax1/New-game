# Project SOLMAR

An original open-world game in the spirit of GTA VI, set in **Port Solmar**, a fictional Miami-inspired city on the Gulf coast. The map comes first, realism second, gameplay third. See [DEVELOPMENT_PLAN.md](DEVELOPMENT_PLAN.md).

## Unity HDRP version (the main direction)

The game is moving to **Unity 6 with HDRP** as a desktop game. The golden-hour street is ported
first; the rest of the game follows. Everything is still generated in code, with no imported
models or images. To open it, see [unity/README.md](unity/README.md).

The browser version (Three.js and TypeScript) described below is the prototype. It stays until
the Unity version covers the same ground.

## Run it

**Just want to play?** See [HOW-TO-PLAY.md](HOW-TO-PLAY.md): install Node.js, then double-click `Start Game.bat`.

```bash
npm ci
npm run dev        # then open the printed URL
```

- `index.html`: the 3D city. Click to look around; `W A S D` fly, `E`/`Q` up/down, `Shift` fast, mouse wheel sets speed.
  `1`–`9` jump between photo spots, `[` `]` change the time of day (hold `T` to fast-forward), `O` cycles quality,
  `F3` shows performance stats, `F2` saves a screenshot.
- `map.html`: the generated 2D map (drag to pan, scroll to zoom).
- URL parameters: `?seed=2` (a different city), `?spot=downtown`, `?time=18.5`, `?quality=low|medium|high|ultra|extreme`,
  `?cam=x,y,z&look=x,y,z`.
- `dev/core.html`: the new engine core's test district (see below). Same controls, plus `L` frame-rate cap and `Y`
  dynamic resolution. Extra URL parameters: `?backend=webgl` (force WebGL 2), `?scale=0.67` (3D render scale,
  0.25–2), `?taa=0`, `?ao=0`, `?bloom=0`, `?fps=144`, `?dynres=1`.
- `dev/sky.html`: the physical sky on its own, with measured sky luminance values.

## What exists so far

- **The map (M1):** a 4 × 4 km city generated from a seed plus a hand-authored layout. It has a downtown on a river, a
  barrier-island beach, a port island, bay islands, curvy suburbs with cul-de-sacs, an industrial north and a swamp.
  There are about 127 km of roads, 400+ blocks and about 4,000 street-facing lots.
- **3D city (M2):** terrain, depth-shaded water with surf, roads with lane paint and crosswalks, curbs, sidewalks,
  seawalls, bridges and elevated highways.
- **Landmarks:** port gantry cranes, a lighthouse, a pier with a Ferris wheel, a stadium, an arena, a mall, a hospital
  and a marina.
- **Street life:** placement for about 18,000 street lights, signals, signs, palms and trees, plus about 5,000 parked
  cars (procedural car models, streamed near the camera). Warm street-light pools at night.

## Engine core (in progress)

Part 1 of the plan: the engine the rebuilt city will run on, in `src/engine/`. The city in `index.html` still uses the
older WebGL renderer until the world moves over.

- **Renderer:** three.js `WebGPURenderer`, on WebGPU where the browser has it and WebGL 2 otherwise.
- **Physical light:** the sun and moon in lux, lamps in candela, the sky and glowing surfaces in nits. A camera
  exposure (EV100) with eye adaptation is metered on the GPU, so noon, dusk and night each get the right brightness
  and night still looks like night.
- **Frame:** a depth pre-pass (normals, roughness, motion vectors), ambient occlusion, the lit scene with clustered
  lighting for hundreds of lamps (WebGPU), temporal anti-aliasing and upscaling from 67–100% resolution, bloom and
  AgX tone mapping.
- **Sky:** a physically based atmosphere (Rayleigh, Mie and ozone, multiple scattering) for Port Solmar's latitude and
  date, with the sun, moon, twilight and city glow, lighting the scene through an environment map.
- **Loop:** no frame cap by default (your monitor's refresh rate), an optional cap, simulation at a fixed 120 Hz,
  optional dynamic resolution, and an `F3` panel with a frame-time graph, 1% lows, CPU and GPU times.

## Photoreal showcase

`showcase.html` is a downtown street at golden hour after rain, generated entirely in code: there
are no model, image or HDRI files. Code is in `src/graphics/`.

- **Textures:** 2048² seamless PBR maps (albedo, normal, AO/roughness/metalness, height) baked on
  the GPU at startup from periodic simplex, fBm and Worley noise: asphalt, pavement, architectural
  concrete, stucco, metal and glass.
- **Sky and light:** a Preetham atmosphere (three's `SkyMesh`) with a golden-hour sun and 4096²
  shadows; the sky and a street-level reflection probe are rendered into float cube maps and
  pre-filtered for image-based light.
- **Street:** a crowned road draining to the gutters, 15 cm kerbs, kerb ramps, puddles in the
  wheel-path ruts with rain ripples, worn markings, a zebra crossing, tar snakes and patches.
- **City:** Art Deco, MiMo, classic and glass-tower buildings with recessed windows and rooms behind
  the glass (interior mapping), plus street lamps, traffic signals, palms, hydrants, roadworks
  and more, all modelled from real dimensions.
- **Camera:** GTAO, screen-space reflections, temporal anti-aliasing, bokeh depth of field, bloom,
  chromatic aberration, a lens vignette, colour grade, film grain and ACES filmic tone mapping.
- **Screenshot:** `npm run capture-screenshot` renders it headless into
  `docs/screens/showcase/street.png`.
- **URL parameters:**
  - `?spot=hero|crossing|puddle|facades` picks a camera position;
  - `?sun=elevation,azimuth` moves the sun;
  - `?textures=0` renders flat colours instead of baked textures.

## Development

```bash
npm run typecheck && npm test && npx vite build
node tools/shoot.mjs "index.html?spot=skyline" out.png   # headless screenshot (software WebGL)
node tools/shoot.mjs "dev/core.html?time=21&spot=street" out.png   # engine core, headless WebGPU
```

Screenshots of each milestone are in `docs/screens/`.
