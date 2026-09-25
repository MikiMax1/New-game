# Project SOLMAR: Development Plan v3 (the rebuild)

**Goal: a Miami-style open world in the spirit of GTA VI that looks as close to photorealistic
as a web game can, with a map that feels like a real, varied city.**

v2 got a whole city generated and running: roads, 4,000 buildings, props, traffic, sky. But playtesting
showed it looks procedural, repetitive and low-detail, with many placement bugs. v3 rebuilds the
game around **real data, real photo-scanned assets and a modern renderer**. It keeps only the parts
that already work: the loading and worker pipeline, the atmosphere maths, the tests and the tools.

---

## 0. Straight answers first

| Question | Answer |
|---|---|
| Can it look exactly like GTA VI? | No. GTA VI was made by ~2,000 people over ~10 years with hand-made art, motion capture and a custom engine. It will not look identical. |
| How close can it get? | Close to a well-modded GTA V at street level in good light: photo-scanned materials, real-scale streets, dense detail near the camera, good sky and reflections. Far views and people are the weakest part. |
| What limits it most? | 1) **Assets:** photo textures and scanned models need network access to asset sites (§9). 2) **The browser:** memory and GPU time budgets. 3) **I can't see real frame rates here**; you report them. |
| Why rebuild instead of patching? | The v2 look comes from procedural boxes and flat colours. Patching bugs one by one won't change that. The map, materials, buildings and cars all need a new foundation. |

---

## 1. The five big changes in v3

1. **A real map instead of a random grid.** The street layout, coastline, canals, parks and building
   footprints come from **OpenStreetMap data of real Miami neighbourhoods**, with names changed and
   areas rearranged into our fictional "Port Solmar". Real cities are never repetitive: every block,
   curve and lot differs. (Needs network access to OSM, §9.)
2. **Photo-scanned materials everywhere.** Asphalt, concrete, stucco, sand, grass, bark, metal and
   glass come from CC0 photo-scan libraries (Poly Haven, ambientCG) at 2K–4K. They are blended with
   decals, dirt and wetness so nothing tiles visibly.
3. **A modular building kit instead of generated boxes.** A kit of ~300 detailed facade modules
   (windows, doors, balconies, cornices, storefronts, awnings, A/C units, roof parts) is assembled
   by style rules onto real footprints. Plus ~40 hand-authored hero buildings for landmarks.
4. **A new renderer: Three.js WebGPU** (supported by Chrome and Edge on Windows). It gives better shadows,
   GPU-driven instancing, screen-space reflections and global illumination, volumetric clouds and
   fog, TAA and upscaling. The WebGL2 path stays as a fallback on "low".
5. **Streaming.** Only the area around the player is loaded at full detail; the rest streams in as
   you move. Loading becomes a few seconds, not a browser-freezing minute.

---

## 2. Phase A: foundations (renderer, streaming, tools)

| # | Work | Done when |
|---|---|---|
| A1 | Move to `three/webgpu` + TSL shaders; WebGL2 fallback | Same scene renders on both; F3 shows the backend |
| A2 | Tile streaming: 256 m tiles, 3 detail rings (near < 300 m full detail, mid < 1.2 km simplified, far = impostors/horizon mesh), built in workers, uploaded over several frames | Flying at 120 km/h never freezes; start-up < 10 s; memory < 1.5 GB |
| A3 | Asset pipeline: `tools/assets/` downloads CC0 textures and models, converts them to KTX2 (Basis) and GLB (meshopt), and writes a manifest; runtime loader with LOD and cache | One command fetches and packs all assets; the game loads them by ID |
| A4 | Visual test tour: 30 fixed camera spots (street and aerial, day, dusk, night, rain), captured and compared after every change | `npm run tour` produces a contact sheet |
| A5 | World audit tests: automated checks over the **whole map**: nothing floating, sunk, overlapping, blocking roads or sidewalks; parked cars only in parking spots; trees only in tree pits and lawns; nothing inside landmarks or under decks | `npm test` fails on any violation |

## 3. Phase B: the map (realistic, varied, believable)

| # | Work | Details |
|---|---|---|
| B1 | Map source | Pick 5–7 real Miami areas (Downtown/Brickell, South Beach, Little Havana, Coral Gables, Wynwood, a port, Everglades edge) from OpenStreetMap; cut, rotate and stitch them into one ~6 × 6 km island-and-mainland layout with a bay, causeways and a highway loop. Rename all streets and places. |
| B2 | Terrain | Real-scale Florida terrain: nearly flat, with subtle drainage, raised roads, canals with seawalls, mangrove edges, dunes behind the beach. Height from a smooth field (no stair-steps), shoreline from vector contours, 1 m detail near the player. |
| B3 | Roads | Build road surfaces from OSM widths and lane counts. Proper intersections (no discs or overlaps), turn lanes, medians, curbs, gutters and drains, crosswalks, bike lanes, highway ramps with correct banking and grades, bridges with real decks, joints and railings. |
| B4 | Lots and land use | Use the real building footprints and land use: lawns, driveways, pools, fences and hedges in suburbs; parking lots with stall lines, islands and lights; plazas downtown; beach with boardwalk, dunes, lifeguard towers and umbrellas. |
| B5 | Variety rules | No two neighbouring buildings share a style, colour and height; districts have their own palettes and eras; landmarks every few blocks; street furniture and trees follow real spacing rules. |
| B6 | Water | Ocean, bay and canals with correct depth colours, shoreline foam following the real coast, marinas with docks and boats. |

## 4. Phase C: realism of every surface and object

| # | Area | What changes |
|---|---|---|
| C1 | Materials | Photo-scanned PBR sets with detail normals, macro variation and anti-tiling; wear decals (cracks, patches, oil, tyre marks, manholes, drains, graffiti); wet surfaces with puddles. |
| C2 | Buildings | Modular kit on real footprints: framed windows with interiors (parallax rooms), balconies, railings, shutters, storefronts with lit displays, signs and neon, roof clutter (HVAC, tanks, antennas, parapets), foundations that follow the ground, weathering and rain streaks. Tile roofs with ridges and overhangs on houses. |
| C3 | Hero buildings | ~40 hand-authored landmarks: stadium, arena, towers, Art Deco hotels, hospital, port cranes, bridges, lighthouse, pier and wheel, malls. |
| C4 | Vegetation | Several palm species, live oaks, sea grapes, mangroves, hedges, flowering shrubs, lawns with grass cards near the camera; wind animation; correct placement (tree pits, medians, yards, parks). |
| C5 | Vehicles | ~20 original car models built from smooth surfaces: panel lines, lights with lenses, grilles, mirrors, interiors, detailed wheels, clear-coat paint, glass with reflections, dirt; 3 LODs. Buses, trucks, police, taxis, boats. |
| C6 | Street life | Pedestrians (Mixamo-rigged, needs your Adobe login for clips) walking, waiting at crossings, sitting; birds; flags and awnings moving in the wind. |

## 5. Phase D: light, sky and camera (what makes it look "real")

| # | Area | What changes |
|---|---|---|
| D1 | Sky | Physically based sky (already have), plus **volumetric 3D clouds** (cumulus, cirrus, storm) with proper light scattering and shadows on the city; HDR sky photos as an option. |
| D2 | Global illumination | Screen-space GI and a coarse light probe grid so shade is coloured by the sky and bounce light, not flat grey. |
| D3 | Shadows | Cascaded + contact shadows; soft penumbrae; shadows from clouds. |
| D4 | Reflections | Screen-space reflections, reflection probes per block, planar reflections for water; car paint and glass that reflect the street. |
| D5 | Atmosphere | Humid haze and aerial perspective, height fog, sun glare, heat shimmer; god rays. |
| D6 | Night | Street lights as real light sources near the camera, lit windows by time of day, neon, car headlights and tail lights, wet reflections. |
| D7 | Weather | Clear, humid, overcast, rain and thunderstorm with wet roads and puddles. |
| D8 | Camera and post | TAA + upscaling (sharp, no jaggies), filmic tone mapping, colour grading close to the GTA VI trailer look, subtle lens effects, motion blur option. |

## 6. Phase E: traffic and gameplay

| # | Work |
|---|---|
| E1 | Traffic: Intelligent Driver Model, lane changes, turn lanes, junction reservations, signals with amber, yielding, highway merges, no overlaps or jams; wheels, steering, brake lights and indicators animate. |
| E2 | On-foot player with a third-person camera. |
| E3 | Driving with vehicle physics (Rapier). |
| E4 | Police, wanted level, missions, phone, map with GPS, save/load. |
| E5 | Audio: engines, city ambience, radio. |

---

## 7. Known bugs from playtesting (all fixed by the rebuild, all covered by audit tests)

Parked cars in travel lanes · palms in the middle of sidewalks · bushes through elevated highways ·
palms and a building inside the stadium · rainbow walls · a house half-buried in a slope · a stray
floating slab on a lawn · dark round road patches and grey shapes sticking out over the water ·
jagged, stair-stepped shorelines · an endless pink hotel "wall" on the beach · empty parking lots
with checkerboard textures · repetitive suburbs of identical houses · flat, low-detail sky and
terrain · a long, browser-freezing load (partly fixed already).

---

## 8. Order of work

1. **Phase A** (foundations): WebGPU renderer, streaming, asset pipeline, tour and audit tools.
2. **Phase B** (map) and **C1** (materials) together, since they are what you see most.
3. **C2–C4** (buildings, hero buildings, vegetation) and **D** (light, sky, camera).
4. **C5** (cars) and **E1** (traffic).
5. **C6** (people) and the rest of **E** (gameplay).

After each step: push, you pull and play, you send screenshots and your F3 numbers, I fix what
you find.

---

## 9. What I need from you (these decide how realistic it can get)

1. **Allow these domains** in this environment's network settings (Claude Code web → environment
   settings → Network access → custom allowed domains):
   - `polyhaven.com`, `dl.polyhaven.org`, `api.polyhaven.com`: CC0 photo-scanned textures, models and HDR skies
   - `ambientcg.com`, `acg-download.struffelproductions.com`: CC0 photo-scanned materials
   - `overpass-api.de`, `download.geofabrik.de`: OpenStreetMap map data for the real street layout

   Without these I can only generate textures and layouts procedurally, which is what looks fake today.
2. **Your PC specs** (graphics card, RAM) and browser, so I can set the right quality targets.
3. **Later:** Mixamo animation clips for pedestrians (needs your Adobe login).

---

## 10. Honest risks

| Risk | Mitigation |
|---|---|
| Browser memory and GPU limits | Streaming rings, KTX2 textures, meshopt, strict budgets per tile, quality presets |
| OSM data licence (ODbL) | Attribution in credits; geometry is transformed and renamed |
| I can't measure real fps here | F3 numbers from you; conservative budgets |
| People and animation look weakest | Keep them at a distance until good clips exist |
| Big rebuild takes many sessions | Each phase ships a playable, better build; nothing is left half-done on the branch |
