# Project SOLMAR: Development Plan v4

**A Miami-style open world in the spirit of GTA VI, rebuilt for maximum realism in the browser.
Order of work: the core engine first, then the world, then realism layer by layer, then gameplay.**

---

## 0. Honest target

| | |
|---|---|
| **Aim** | Street-level shots that hold up next to a heavily modded GTA V (photo-scanned materials, real-scale streets, soft realistic light, volumetric clouds, reflective cars and glass). |
| **Not possible** | An exact GTA VI match. It had about 2,000 artists, motion capture and a custom engine. |
| **Weakest areas** | People and animation, and very far views. We hide these with distance, haze and good composition. |
| **Needs from you** | Network access to the asset sites (§10), your GPU and RAM, and screenshots with F3 numbers after each step. |

Every step ends with a playable build, a 30-spot screenshot tour and the whole-map audit tests passing.

---

## PART 1: CORE (built first; everything else stands on it)

### Step 1. Engine core
| # | Work | Done when |
|---|---|---|
| 1.1 | **WebGPU renderer** (`three/webgpu`, TSL node shaders) with automatic WebGL2 fallback | Same test scene renders on both; F3 shows the backend |
| 1.2 | **HDR linear pipeline**: RGBA16F targets, physical light units (lux and nits), physical camera exposure (EV100) with eye adaptation | Noon, sunset and night have correct brightness without hand-tuning |
| 1.3 | **Frame graph**: depth pre-pass, G-buffer-lite (normals, roughness, velocity) for screen-space effects, forward+ lighting with clustered lights | 200+ dynamic lights at night without a frame-time spike |
| 1.4 | **Temporal core**: TAA with jittered projection and motion vectors, plus a temporal upscaler (render at 67–100%) | No jagged edges on wires, railings or palm leaves; stable while moving |
| 1.5 | **Quality system**: presets from Low to **Extreme**, auto-detected; no frame cap (up to your monitor's refresh rate, e.g. 240 fps); optional dynamic resolution; crash-safe start (already done in v2) | Holds 240 fps on 'High' on a strong PC |

**Status (engine core started):** `src/engine/`, test pages `dev/core.html` (a 600 m test district with 370+ lamps)
and `dev/sky.html`.
- 1.1 done: `WebGPURenderer` on WebGPU or WebGL 2 (`?backend=webgl`); F3 shows the backend and the GPU. The test
  district renders the same on both.
- 1.2 done: lux, candela and nits throughout; pre-exposed half-float buffers; EV100 metered on the GPU with eye
  adaptation and a key that darkens dim scenes (noon, dusk and night checked by screenshot); a physically based sky
  (Hillaire 2020 LUTs) with sun, moon, twilight and city glow, lighting the scene through an environment map.
- 1.3 done: depth pre-pass with normals, roughness and motion vectors; its depth is copied into the lit pass for
  early-z; GTAO on indirect light; clustered forward+ lighting on WebGPU (WebGL 2 shades the 16 nearest lamps);
  a lamp pool that maps any number of lamps onto a fixed set of lights (no shader recompiles as you move).
- 1.4 done: TAAU (three.js) at 67–100% render scale per preset, up to 200% with `?scale=`.
- 1.5 done: Low to Extreme; no frame cap; optional cap (`L`: 60/120/144/165/240); fixed 120 Hz simulation; dynamic
  resolution (`Y`, needs GPU timing); F3 frame-time graph with 1% lows, CPU and GPU time (18.3, 18.4 in part).
- Still to confirm on real hardware: the frame-time targets (your F3 numbers on the test district).

### Step 2. Streaming and memory core
| # | Work | Done when |
|---|---|---|
| 2.1 | World in **256 m tiles**, generated or loaded in workers | Nothing big is built on the main thread |
| 2.2 | **Four detail rings**: full detail < 250 m, simplified < 1 km, merged block meshes < 3 km, horizon impostors beyond | 120 km/h flight with no hitches |
| 2.3 | GPU uploads spread over frames; KTX2 (Basis) compressed textures; meshopt geometry | Start-up < 10 s; memory < 1.5 GB |
| 2.4 | **GPU-driven instancing and culling** for props, cars and vegetation (frustum and occlusion culling on the GPU) | 100k+ objects on the map, low draw calls |

### Step 3. Asset core
| # | Work | Done when |
|---|---|---|
| 3.1 | `tools/assets`: downloads CC0 assets (Poly Haven, ambientCG), converts to KTX2/GLB, writes a manifest | One command fetches and packs everything |
| 3.2 | **Material system**: one layered PBR shader (base, detail, macro variation, wear, wetness, decals) used by everything | Every surface uses it; no one-off shaders (fixes the long shader compile freeze) |
| 3.3 | **Model LOD pipeline**: auto-generated LOD1–LOD3 and impostors for every model | Every model has ≥ 3 LODs |

### Step 4. Test and review core
| # | Work |
|---|---|
| 4.1 | **Whole-map audit tests**: nothing floating, sunk, overlapping or intersecting; parked cars only in stalls or parking lanes; trees only in pits, yards and medians; nothing under decks or inside landmarks; no road patches over water; smooth shorelines |
| 4.2 | **Screenshot tour**: 30 fixed spots × 4 times of day, rendered to a contact sheet after every change |
| 4.3 | **Performance budget report**: draw calls, triangles, memory and shader count per tour spot, failing CI when exceeded |

---

## PART 2: THE WORLD (after the core)

### Step 5. The map
| # | Work |
|---|---|
| 5.1 | Real street layouts from **OpenStreetMap** (Brickell, South Beach, Little Havana, Coral Gables, Wynwood, the port, the Everglades edge), stitched into a ~6 × 6 km fictional Port Solmar with a bay, causeways and a highway loop; all names changed |
| 5.2 | Terrain: nearly flat Florida ground with drainage, raised roads, canals and seawalls, dunes, mangroves; smooth heightfield, vector shorelines, no stair-steps |
| 5.3 | Roads from real widths and lane counts: proper intersection surfaces, turn lanes, medians, curbs, gutters, drains, crosswalks, ramps with banking, real bridges |
| 5.4 | Lots from real footprints and land use: yards, driveways, pools, fences, hedges, parking lots with stalls, plazas, beach with boardwalk and lifeguard towers |
| 5.5 | Variety rules: neighbours never share style, colour and height; district palettes and eras; landmarks every few blocks |

---

## PART 3: HYPER-REALISTIC GRAPHICS

### Step 6. Lighting (the biggest single realism factor)
| # | Technique | Result |
|---|---|---|
| 6.1 | **Physically based sun and sky light** from real sun position (latitude 25.8° N, date, time) | Correct light colour and angle at every hour |
| 6.2 | **Image-based lighting from the live sky**: environment cube re-rendered as the sky changes, prefiltered for roughness | Shade is blue-ish from the sky, sunlit parts are warm, like real photos |
| 6.3 | **Global illumination**: screen-space GI (SSGI) near the camera, plus a baked irradiance probe grid per tile for bounce light from ground and walls | No flat grey shadows; light bounces off sunlit pavement onto walls |
| 6.4 | **Shadows**: 4 cascades with PCSS soft penumbrae, contact shadows (screen-space) for small details, cloud shadows moving across the city | Crisp at the foot of objects, soft far away, like real sunlight |
| 6.5 | **Ambient occlusion**: GTAO with bent normals | Grounded objects, dark corners and gaps |
| 6.6 | **Reflections**: screen-space reflections with a probe fallback; planar reflection for the sea and bay; box-projected probes per block | Glass towers, car paint, puddles and water reflect the real scene |
| 6.7 | **Night lighting**: every street light, car light, sign and window is a real light source near the camera (clustered), with light shafts in haze | GTA-style night streets with pools of light and wet glare |
| 6.8 | **Exposure and colour**: physical camera, eye adaptation, filmic tone mapping (AgX), a colour grade matched to the GTA VI trailer look (warm highlights, teal shade, saturated sunsets) | Looks like a camera photo, not a game render |

### Step 7. Clouds and atmosphere
| # | Technique | Result |
|---|---|---|
| 7.1 | **Volumetric clouds**, raymarched through 3D noise (Perlin-Worley shape + Worley erosion), weather map for coverage and type | Real billowing cumulus with soft, cauliflower edges; no flat or faceted shapes |
| 7.2 | Physically based cloud lighting: Beer-Powder law, dual-lobe phase, multiple-scattering approximation, sky ambient from the atmosphere | Bright white sunlit tops, grey bases, silver linings near the sun |
| 7.3 | Cloud types: cumulus, towering cumulonimbus, stratus, cirrus layer, sunset colouring | A different sky every day |
| 7.4 | Temporal reprojection at quarter resolution, so clouds cost ~1–2 ms | Smooth, noise-free clouds that move with the wind |
| 7.5 | Cloud shadows on the ground and god rays through gaps | Moving patches of shade over the city |
| 7.6 | **Atmosphere**: physical Rayleigh and Mie scattering (have it), aerial perspective, humid haze, height fog, volumetric fog near the ground at dawn | Distance fades like a real humid Miami day |
| 7.7 | **Weather**: clear, humid, overcast, rain and thunderstorm with smooth transitions; rain streaks, splashes, lightning, wet roads that dry | Storms roll in over the bay |

### Step 8. Materials and surfaces
| # | Work |
|---|---|
| 8.1 | Photo-scanned PBR sets (2K–4K) for asphalt, concrete, stucco, brick, tile, sand, grass, soil, bark, metal, glass |
| 8.2 | **Anti-tiling**: stochastic texture sampling plus large-scale macro variation, so no pattern repeats |
| 8.3 | **Decals**: cracks, patches, oil, tyre marks, manholes, drains, road paint wear, graffiti, dirt at wall bases, rain streaks |
| 8.4 | **Wetness**: puddles that fill and dry, darkened and glossy surfaces, ripples in rain |
| 8.5 | Parallax occlusion mapping for bricks, tiles and pavers near the camera |
| 8.6 | Water: FFT ocean waves, depth colour, foam from wave height and the shore, caustics in shallow water, wakes behind boats |

---

## PART 4: HYPER-REALISTIC 3D MODELS

The rule for every model: **real dimensions, smooth silhouettes, bevelled edges (no razor-sharp
boxes), photo-scanned or physically based materials, wear and dirt, and 3+ LODs.**

### Step 9. Buildings
| # | Work |
|---|---|
| 9.1 | **Modular facade kit** (~300 pieces) modelled with bevels and real depth: framed windows with sills and lintels, doors, balconies, railings, shutters, cornices, pilasters, storefronts, awnings, A/C units, fire escapes, signs, neon |
| 9.2 | **Interiors behind glass** (parallax interior mapping): offices, apartments, shops, lit at night by time of day |
| 9.3 | Roofs: clay tile with ridges and overhangs, flat roofs with parapets, HVAC, water tanks, antennas, solar panels, pool decks |
| 9.4 | Styles by district: glass and concrete towers, Art Deco hotels, Mediterranean Revival houses, Cuban shop fronts, warehouses, strip malls, mid-century motels |
| 9.5 | **~40 hand-built hero landmarks**: stadium, arena, tallest towers, beach hotels, hospital, port cranes, bridges, lighthouse, pier and Ferris wheel |
| 9.6 | Weathering: sun-bleached paint, stains, cracks, moss in shade; foundations that follow the ground |

### Step 10. Vehicles
| # | Work |
|---|---|
| 10.1 | ~20 original models (sedans, coupes, sports cars, SUVs, pickups, vans, taxi, police, buses, trucks, boats, motorbikes), built from smooth subdivided surfaces: curved panels, panel gaps, wheel arches |
| 10.2 | Full detail: headlights with lens, reflector and LEDs; tail lights; grilles; mirrors; handles; wipers; plates; exhausts; **full interiors** |
| 10.3 | Wheels: tyre sidewall and tread, multi-spoke rims, brake discs and calipers; spin, steer and suspension travel |
| 10.4 | Car paint shader: base plus metallic flake plus clear coat, with reflections of the street; tinted glass; chrome; rubber; dirt and dust layers |
| 10.5 | LOD0 ≈ 50–80k triangles (close-up), LOD1 ≈ 10k, LOD2 ≈ 2k, impostor far away |

### Step 11. Vegetation and props
| # | Work |
|---|---|
| 11.1 | Palms (royal, coconut, sabal), live oaks with Spanish moss, sea grapes, mangroves, hedges, flowering shrubs, lawns with 3D grass near the camera |
| 11.2 | Wind animation per species; translucent leaves lit from behind by the sun |
| 11.3 | Street props: lights, signals, signs, benches, bins, bus stops, hydrants, parking meters, newspaper boxes, power lines with sag, all detailed and weathered |
| 11.4 | Correct placement rules (tree pits, medians, yards), all checked by the audit |

### Step 12. People
| # | Work |
|---|---|
| 12.1 | Realistic human models with varied clothing (CC0 or generated), skin shading with subsurface scattering |
| 12.2 | Mixamo animation clips (needs your Adobe login): walking, waiting, sitting, talking, phone use |
| 12.3 | Crowds on sidewalks, crossings and the beach, by time of day |

---

## PART 5: LIFE AND GAMEPLAY (after the world looks right)

| Step | Work |
|---|---|
| 13 | **Traffic**: Intelligent Driver Model, lane changes, turn lanes, junction reservations, signals with amber, yielding, highway merges, no overlaps or jams, animated wheels and lights |
| 14 | **Player on foot**: third-person camera, walk, run, jump, swim |
| 15 | **Driving**: Rapier vehicle physics, surface grip, damage, chase and hood cameras |
| 16 | **Audio**: engines by RPM, city ambience per district, rain, radio |
| 17 | **Game**: police and wanted levels, missions, phone, GPS map, save and load |

---

## PART 6: HIGH-END PCs AND HIGH REFRESH RATES

### Step 18. Frame rate: no cap
| # | Work |
|---|---|
| 18.1 | **No frame limiter in the game.** Frames are paced by the browser at your monitor's refresh rate, so a 240 Hz screen gets up to 240 fps |
| 18.2 | **Truly uncapped mode** (above the refresh rate): the launcher gets an optional "Start Game (Uncapped).bat" that opens Chrome or Edge with `--disable-gpu-vsync --disable-frame-rate-limit` in a separate profile, so fps is limited only by the GPU |
| 18.3 | Frame-time graph and fps counter in F3 (1% lows, GPU and CPU time), plus an optional fps cap setting (60 / 120 / 144 / 165 / 240 / off) |
| 18.4 | **Low-latency pipeline**: simulation decoupled from rendering (fixed 120 Hz physics with interpolation), no main-thread stalls, all generation in workers, shader warm-up behind the loading screen |
| 18.5 | Resolution scale up to 200% (supersampling) and native 4K for strong GPUs |

### Step 19. "Extreme" preset (strong PCs only)
| # | Feature |
|---|---|
| 19.1 | Full-resolution volumetric clouds with more raymarch steps and a second cirrus layer |
| 19.2 | Screen-space GI at full resolution plus more irradiance probes; multi-bounce light |
| 19.3 | Full-resolution screen-space reflections with rough-reflection blur; planar water reflections at full resolution |
| 19.4 | 4096² shadow cascades to 2 km, PCSS soft shadows, contact shadows everywhere, shadows from every street light near the camera |
| 19.5 | 4K textures within 50 m, parallax-occlusion mapping on all ground and walls |
| 19.6 | Detail rings doubled: full detail to 500 m, dense grass and shrubs to 150 m, traffic and pedestrian density doubled |
| 19.7 | Volumetric fog lit by every light (headlights and street lights cut through haze and rain) |
| 19.8 | Cinematic depth of field, per-object motion blur, film grain, lens flares from bright sources (all optional) |

---

## PART 7: EXTRA REALISM DETAILS (the things that make a picture read as "real")

| Area | Detail |
|---|---|
| Light | Sun disc bloom and glare through haze; specular highlights that follow the real sun; light leaking through palm leaves; warm bounce light under balconies; cool blue shade after sunset (the "blue hour") |
| Sky | Real sunrise and sunset colours for Miami's latitude; stars, Milky Way and moon phases at night; aircraft contrails; distant thunderstorms on the horizon |
| Air | Heat shimmer above hot asphalt at noon; sea spray haze along the beach; humidity that softens distant towers |
| Ground | Oil stains at parking spots and stop lines; tyre skid marks; faded crosswalks; cracks with weeds; sand blown onto beach roads; leaves and litter along gutters |
| Buildings | Slightly different window reflections per pane (real glass is never perfectly flat); open and closed blinds; A/C drips and stains; lit lobbies at night; rooftop pools |
| Water | Waves breaking on the beach with foam trails; wet sand that shines; boat wakes; reflections of city lights at night |
| Vegetation | Palm fronds that rustle and bend in gusts; fallen fronds and coconuts; dry and green grass patches; sprinklers in suburban yards |
| Cars | Reflections moving across the paint as they drive; dust on lower panels; rain beading on glass; headlight beams visible in rain and fog; heat haze behind exhausts |
| Motion | Birds flying over the beach; flags, awnings and palm shadows moving in the wind; clouds drifting and changing shape |
| Sound (step 16) | Distance-based echo between towers, waves at the beach, distant sirens and planes |

---

## 9. Known bugs from playtesting (fixed by the rebuild, locked by audit tests)

Parked cars in travel lanes · palms in the middle of sidewalks · bushes through elevated highways ·
palms and a building inside the stadium · rainbow walls · a house half-buried in a slope · a floating
slab on a lawn · dark round and grey road patches over the water · jagged shorelines · an endless
pink hotel wall on the beach · empty parking lots with checkerboard textures · repetitive suburbs ·
flat sky and terrain · slow, browser-freezing load.

## 10. What I need from you

1. **Network access**: in this environment's settings, set Network access to Custom and allow
   `polyhaven.com`, `dl.polyhaven.org`, `api.polyhaven.com`, `ambientcg.com`,
   `acg-download.struffelproductions.com`, `overpass-api.de`, `download.geofabrik.de`
   (or choose Full). Then start a new session.
2. Your GPU, RAM and browser.
3. Later: Mixamo clips for people.

## 11. Risks

| Risk | Mitigation |
|---|---|
| Browser GPU and memory limits | Streaming rings, compressed textures, GPU culling, dynamic resolution |
| WebGPU not available on some PCs | WebGL2 fallback with fewer effects |
| I can't see real fps | Your F3 numbers; strict budgets in CI |
| OSM licence (ODbL) | Attribution in the credits; geometry transformed and renamed |
| Huge scope | Each step ships a playable build; the core comes first so later work doesn't need redoing |
