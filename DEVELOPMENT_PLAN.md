# Project SOLMAR: Development Plan (v2, built by Claude)

**An open-world crime game in the spirit of GTA VI, built by Claude in this repository.
The map comes first, realism second, gameplay third.**

---

## Progress (updated as work lands)

| Milestone | Status | Notes |
|---|---|---|
| M0 Foundation | ✅ Done | Vite + TS + Three.js, fly camera, F3 stats, quality presets, screenshot tool, CI |
| M1 Map blueprint | ✅ Done | Seeded 4 × 4 km city, planar road graph, blocks, ~4,000 lots, `map.html` |
| M2 Terrain, water, roads | ✅ Done | Paint, crosswalks, curbs, seawalls, bridges, elevated highways, far terrain |
| M3 Buildings | 🔄 In progress | Procedural facades per district (helper agent) |
| M4 Streaming and scale | 🟡 Partial | Distance culling per layer, near/far LOD buckets, streamed instancing |
| M5 Street dressing | 🟡 Partial | ~18k placements and ~5k parked cars done; prop models in progress (helper agent) |
| M6 Landmarks | 🟡 Partial | Cranes, lighthouse, pier and Ferris wheel, stadium, arena, mall, hospital, marina |
| R1 Light and sky | 🔄 In progress | Physical sky, sun/moon, cascaded shadows, post-processing (helper agent) |
| R4 Water | 🟡 Partial | Depth-shaded shallows, ripples, shoreline foam, beach surf |
| R6 Night | 🟡 Partial | Baked street-light pools; car lights |
| G4 Traffic | 🟡 Early | Lanes, signals, stop signs, following, turns |
| UI | 🟡 Partial | GTA-style radar, full map on M |

## 1. What changed from v1 and why

v1 was a plan for a 2,000-person studio. This version is a plan **I (Claude) can carry out myself**,
session by session, in this repository. So it is built around what I can actually do here:

| I can | I cannot |
|---|---|
| Write all of the code (engine setup, world generator, shaders, gameplay) | Run Unreal Engine or Unity: no GPU, no editor GUI, no Epic login in this container |
| Run the game in a headless browser with software WebGL2 (checked: SwiftShader, float render targets work) | Measure real frame rate on a real graphics card |
| Take screenshots and short videos from fixed camera spots to check my own work | Record motion capture, voice acting or photo-scanned assets |
| Commit, push and deploy the game to a web page you can play | Download from Poly Haven / ambientCG / OpenStreetMap right now (the network blocks them; see §9) |

**Consequences:**
- **Engine: Three.js (WebGL2) + TypeScript**, playable in any browser, with a path to WebGPU later.
  I can build, run and screenshot it end to end, so I am never coding blind.
- **Everything is procedural first.** Map, buildings, textures and props are generated from code
  and a seed. This fits the map-first goal and avoids depending on assets I can't download.
- **You are my eyes on real hardware.** You play the build, press F3 for the performance overlay,
  and tell me what looks wrong or runs slowly.

**Realistic quality ceiling:** a browser game with physically based lighting, atmosphere, water,
wet roads and a dense city can look like a good late-2010s console open world in its best shots.
It will not match GTA VI's characters, animation or density, which need a studio. This plan pushes
as far toward that as one coder with a browser engine can go, starting with the parts that give the
most realism per line of code: **the map, light, materials and atmosphere**.

---

## 2. Technology stack (all available on npm, which is reachable)

| Layer | Choice | Why |
|---|---|---|
| Language / build | TypeScript + Vite | Fast rebuilds, type safety across a large codebase |
| Renderer | Three.js (WebGL2), later `WebGPURenderer` | Mature, PBR, instancing, shadows, custom shaders |
| Post-processing | `postprocessing` (pmndrs) + N8AO | Bloom, SMAA/TAA, tone mapping, AO, color grading |
| Physics | Rapier (`@dimforge/rapier3d-compat`, WASM) | Character controller, raycast vehicles, collisions |
| Spatial queries | `three-mesh-bvh` | Fast raycasts on generated city geometry |
| Noise / geometry | `simplex-noise`, own code for polygons, splines, straight skeleton | Terrain, coastline, lots, roofs |
| Threads | Web Workers | World-chunk generation off the main thread |
| Audio (later) | Web Audio API | Procedural engine sounds, ambience |
| Testing | Vitest (logic) + Playwright (screenshots, smoke tests) | Lets me verify my own work in this container |
| Deploy | GitHub Actions → GitHub Pages | You play the latest build from a link |

**Performance targets** (you verify on your PC):
- **60 fps at 1080p** on a mid-range GPU (GTX 1660 / RTX 3060 class) on the "High" preset.
- Budgets per frame: ≤ 1,500 draw calls, ≤ 5 M visible triangles, ≤ 1.5 GB GPU memory.
- Streaming: generating one chunk takes ≤ 30 ms in a worker, and never stutters the main thread.
- Presets: Low (integrated GPUs), Medium, High, Ultra (for screenshots).

---

## 3. How we work together (one milestone ≈ one to a few sessions)

1. You say **"do milestone X"** (or give feedback).
2. I implement it, run the unit tests, and render **photo spots**: fixed camera positions and times
   of day, saved to `docs/screens/<milestone>/` so every change has a before and after.
3. I push to this branch; the GitHub Action deploys the playable build.
4. You play it, press **F3** for the fps / draw-call overlay, and report what you see.
5. I fix and move on. Each milestone has **acceptance checks**, so "done" is never vague.

---

## 4. PHASE 1: THE MAP (top priority)

### 4.1 Map spec

**Map v1: 4 km × 4 km (16 km²)**, the city of **Port Solmar** on the Gulf coast of the fictional
State of San Solano (a Miami-inspired, original setting). About 60% is land and 40% is bay, ocean
and islands. Map v2 (Phase 4) grows it to 8 × 8 km.

| District | Size | Inspiration | Look |
|---|---|---|---|
| **Downtown** | ~1.5 km² | Brickell | Glass and concrete towers of 20–60 floors, plazas, elevated rail |
| **Solmar Beach** | ~1.5 km² (barrier island) | Miami Beach / Ocean Drive | Pastel Art Deco hotels, beach, boardwalk, palms |
| **Little Solano** | ~2 km² | Little Havana | 1–3 floor stucco shops, murals, dense grid, wires overhead |
| **Palm Heights** | ~3 km² | Coral Gables / suburbs | Mediterranean houses, tile roofs, pools, cul-de-sacs |
| **Harbor District** | ~1.5 km² | Port of Miami | Container yard, cranes, warehouses, rail spur |
| **Northside** | ~1.5 km² | Hialeah / industrial | Strip malls, car lots, parking lots, warehouses, trailer park |
| **Cypress Edge** | ~1 km² | Everglades edge | Swamp, boardwalks, airboat dock, shacks |
| **Bay and islands** | rest | Biscayne Bay | Causeway bridges, marina, small island mansions |

**Landmarks** (hand-authored): the causeway bridge to the beach, a pier with a Ferris wheel,
a stadium, a lighthouse, port cranes, the downtown skyline's tallest tower, the elevated highway
interchange.

### 4.2 How the world is generated

The world is **deterministic from a seed plus hand-authored layers**. The same seed always gives the
same city, and hand edits in `world/authored/*.json` override the generator. Each stage has its
own debug view.

```
1. Macro layout (authored JSON)  coastline polygon, district seeds, highway control points, landmarks
2. Terrain                        2 m heightfield shaped by the macro layout + noise; flat coastal
                                  plain, dunes, one low ridge for views; swamp near sea level
3. Water                          ocean, bay, canals, lakes, with depth for colour and wave damping
4. Road network (graph)           highway splines → arterials (district-rotated grids) → local streets
                                  → alleys / cul-de-sacs; intersections solved; bridges over water;
                                  terrain flattened under roads
5. Blocks and lots                faces of the road graph → sidewalks → lots split to real sizes
6. Buildings                      grammar per district: footprint → floors → facade modules → roof
7. Street dressing                lights, signals, signs, hydrants, benches, bins, bus stops,
                                  parked cars, wires, palms, road markings, crosswalks
8. Vegetation                     palms, oaks, mangroves, grass, bushes, placed by density maps
9. Names                          district, street and business names (original parody brands)
```

### 4.3 Real-world numbers the map must respect (realism starts here)

| Item | Rule |
|---|---|
| Lane width | 3.3–3.7 m; highway lanes 3.7 m with 3 m shoulders |
| Sidewalks | 2 m (suburbs) to 5 m (downtown); curbs 15 cm high |
| Blocks | Downtown 80–120 m, Little Solano 60–100 m, suburbs 150–250 m long |
| Road crown and gutters | 2% camber; drains at gutters |
| Highway curves | Radius ≥ 250 m; ramps ≥ 60 m; bridges slope ≤ 5% |
| Floor height | 3.0–3.5 m residential, 4–5 m ground-floor retail |
| Building setbacks | 0 m (downtown, Little Solano) to 6–8 m with driveways (suburbs) |
| Heights | Log-normal distribution per district, tallest near the downtown core |
| Parking | Every strip mall and tower has a matching lot or garage |
| Street lights | Every 25–35 m, alternating sides on arterials |

### 4.4 Map milestones

| # | Milestone | What you get | Acceptance checks |
|---|---|---|---|
| **M0** | Foundation | Vite + TS + Three.js project, free-fly camera, F3 overlay, quality presets, screenshot harness, GitHub Pages deploy | Page loads in headless Chromium; `npm test` passes; screenshot saved |
| **M1** | Map blueprint (2D) | Seed-driven generator for coastline, terrain, districts and full road graph, drawn as a **2D map viewer** (also the future in-game map) | Map image reviewed together; road graph has no dead ends except cul-de-sacs; unit tests for graph validity |
| **M2** | Terrain, water and roads in 3D | Chunked terrain with LOD, flat water planes, 3D road meshes with lanes, curbs, sidewalks, intersections, bridges, highway ramps | Drive-height flythrough with no gaps or z-fighting; photo spots at 6 locations |
| **M3** | Blocks, lots and buildings | Procedural buildings in 6 styles (tower, Art Deco, stucco shop, Mediterranean house, warehouse, strip mall), roofs with A/C units and water tanks, garages and lots | Skyline shot reads as "Miami-like"; no building on a road; ≥ 3,000 buildings |
| **M4** | Streaming and scale | 256 m chunk grid, worker generation, instancing, far-building impostors / merged LOD, whole 16 km² traversable at speed | No frame over 50 ms from streaming in a 120 km/h flythrough (you confirm on your PC); budgets in §2 met |
| **M5** | Street dressing | Everything in stage 7 above, plus road markings, crosswalks, traffic lights at every signalized intersection | A street-level photo spot has no "empty" sidewalk; each district looks distinct at street level |
| **M6** | Landmarks and polish | All landmarks, marina, port cranes, stadium, pier; hand-authored overrides; street names on the 2D map | You pick 3 spots and say they feel like a real place |

---

## 5. PHASE 2: REALISM (second priority)

Ordered by realism gained per unit of work. Each has fixed photo spots at dawn, noon, sunset and
night so progress is visible.

| # | Milestone | Techniques |
|---|---|---|
| **R1** | Light and sky | Physically based sky (Rayleigh / Mie scattering), sun and moon position from latitude and time, cascaded shadow maps, sky-derived environment lighting (PMREM), N8AO ambient occlusion, AgX tone mapping, physical exposure with eye adaptation |
| **R2** | Materials | GPU-generated PBR texture sets (asphalt, concrete, stucco, brick, glass, metal, sand, grass, tile), triplanar mapping, texture arrays; wear layers: dirt at ground level, streaks under windows, sun-bleaching, oil stains on roads; decals: cracks, patches, manholes, graffiti |
| **R3** | Atmosphere and camera | Aerial perspective and height fog, humid haze, volumetric-looking clouds, bloom, TAA / SMAA, color grading LUTs, subtle lens effects (vignette, chromatic aberration off by default), motion blur option |
| **R4** | Water and coast | Gerstner-wave ocean with depth colour, screen-space and planar reflections, shore foam, wet sand band, wave damping in the bay, caustics in shallow water, boat wakes later |
| **R5** | Vegetation | Procedural palms (several species), live oaks with moss, mangroves, lawns and grass cards, all with wind animation and distance LOD |
| **R6** | Night and neon | Lit windows (per-window randomness and occupancy by time), streetlight pools, neon signs, car light trails, light-emissive skyline, lights that switch on at dusk |
| **R7** | Weather | Clear, humid, overcast, rain and thunderstorm; wet roads with reflections, puddles that form and dry, rain streaks, lightning, sky and fog changes; a storm transition in ≤ 2 in-game minutes |
| **R8** | Reflections and GI polish | Screen-space reflections, reflection probes per block, simple light-probe GI for building interiors seen through windows (fake interior "parallax" rooms) |

**Realism acceptance test (for Phase 2 as a whole):** in a blind test of screenshots from the photo
spots, people should rate most of them "could be a real photo at a glance." We use
your judgment and anyone you ask.

---

## 6. PHASE 3: GAMEPLAY (after map and realism)

| # | Milestone | Scope |
|---|---|---|
| **G1** | On-foot player | Rapier character controller, third-person camera, walk / run / sprint / jump / swim; procedural animation (IK legs, body lean) until real animation clips are available (§9) |
| **G2** | Driving | Rapier raycast vehicles: weight transfer, tire grip per surface (wet, sand, grass), handbrake, gears; chase cam and hood cam; get in / out; 10 procedural car models |
| **G3** | Vehicle damage | Mesh deformation, broken glass, detached bumpers and doors, smoke, fire |
| **G4** | Traffic | Lane-following cars on the road graph, traffic lights, yielding, parking, driver personalities, accidents that block roads |
| **G5** | Pedestrians | Instanced crowds on sidewalks and crosswalks with schedules by time of day; flee, watch, film on phone, call police |
| **G6** | Combat and police | Weapons with recoil and hit reactions; witness-based wanted levels; police cars, roadblocks, helicopters; escape and search zones |
| **G7** | Audio | Procedural engine sound by RPM and load, city ambience per district, rain, radio stations (original music later) |
| **G8** | Story and missions | Mission scripting system, two protagonists, first 5 missions, phone UI, save / load, in-game map with GPS routing on the road graph |

---

## 7. PHASE 4: EXPAND

- **Map v2 (8 × 8 km):** Coral Keys (island chain with long bridges), Palmetto Flats (rural,
  citrus groves, speedway), full Cypress Reach swamp, airport.
- Interiors: enterable shops, bars and apartments generated per lot.
- Boats, helicopters and planes.
- More missions, side activities and properties.

---

## 8. Repository layout

```
/
├─ DEVELOPMENT_PLAN.md
├─ index.html, package.json, vite.config.ts, tsconfig.json
├─ src/
│  ├─ core/          # loop, input, settings/presets, debug overlay (F3)
│  ├─ world/
│  │  ├─ authored/   # hand-authored JSON: coastline, districts, highways, landmarks
│  │  ├─ gen/        # terrain, water, roads, lots, buildings, dressing, vegetation, names
│  │  ├─ stream/     # chunk grid, workers, LOD, impostors
│  │  └─ map2d/      # 2D map viewer / in-game map
│  ├─ render/        # sky, materials, post-processing, water, weather, night lighting
│  ├─ physics/       # Rapier setup, character, vehicles
│  ├─ gameplay/      # player, traffic, pedestrians, police, missions (Phase 3)
│  └─ audio/
├─ tests/            # Vitest unit tests (generator invariants, graph validity)
├─ tools/            # Playwright photo-spot renderer, perf reports
├─ docs/screens/     # screenshots per milestone (before / after)
└─ .github/workflows/deploy.yml
```

---

## 9. What would make the game look much better (your choices)

1. **Allow asset websites in this environment's network settings.** Right now `polyhaven.com`,
   `dl.polyhaven.org` and `ambientcg.com` are blocked. Adding them to the allowed domains
   (environment settings → Network access) unlocks free CC0 photo-scanned textures and HDR skies.
   That is the single biggest realism boost available.
2. **Animation clips.** For realistic human movement in G1 / G5, download free Mixamo animations
   (it needs your Adobe login) and add them to the repo. Otherwise I use procedural animation.
3. **Real-hardware feedback.** Your fps numbers, screenshots and "this looks fake" notes guide every
   realism pass.
4. **GitHub Pages.** Turn on Pages with "GitHub Actions" as the source (repo Settings → Pages) so the
   deploy workflow from M0 can publish the playable link.

---

## 10. Risks (honest version)

| Risk | Mitigation |
|---|---|
| Browser performance limits density | Instancing, impostors, merged meshes, quality presets, strict budgets checked every milestone |
| Headless screenshots use a CPU renderer, so I can't see real fps | Draw-call / triangle / memory counters as proxies, plus your F3 reports |
| Procedural cities can look repetitive | District-specific grammars, wear and dirt variation, hand-authored landmarks and overrides |
| Characters and animation are the weakest part | Keep the camera and focus on the world first; add Mixamo clips if you provide them |
| Each session has limited time | Small milestones with clear acceptance checks; everything is committed and pushed every session |

---

## 11. Next step

Say **"start M0"** and I will set up the project, the F3 overlay, the screenshot harness and the
deploy workflow. **M1 (the 2D map blueprint)** follows right after it, so you can review the map
layout before anything is built in 3D.
