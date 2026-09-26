# Project SOLMAR in Unity 6 HDRP: Plan

The browser plan (`../DEVELOPMENT_PLAN.md`, v4) rewritten for Unity 6 HDRP. Many things the browser
version had to build by hand, HDRP already includes: the physical sky, volumetric clouds and fog,
SSR, SSGI, GTAO, PCSS shadows, decals, TAA/DLSS, and exposure. The work here is to configure those
features well, generate the world, and keep each step small enough to finish and check in one sitting.

**Rules for every model and surface:** real dimensions, bevelled edges, PBR materials with wear and
dirt, and LODs. Everything stays procedural (no imported assets) unless a step says otherwise.

**Every step ends with** a compile check with 0 errors and 0 warnings, the screenshots from
**Solmar > Capture Spot Screenshots**, and a note of what to copy into the local RealisticGame project.

---

## Done

| Area | What exists (`Assets/Solmar/`) |
|---|---|
| Street scene | A procedural downtown street at golden hour after rain, with a crowned road, kerbs, decals, puddles and a wet clear coat |
| Buildings | Art Deco, MiMo, classic and glass towers, with interior rooms behind the windows and lit shopfronts |
| Props | Street lamps, signals, hydrants, bins, pay stations, signs, drains, manholes, roadworks, palms in tree pits |
| Lighting | Physically Based Sky, volumetric clouds and fog, a 120 klx sun, 4096² PCSS, a reflection probe; **Solmar > Configure HDRP Asset** turns these on |
| Camera | Physical camera, auto exposure, ACES, SSR, GTAO, bloom, DoF, grain |
| Controls | Fly and walk (`F`), time of day (`[` `]` `T`), `F2` screenshots |
| Sound | Synthesised city ambience |
| Parked cars | Sedan, hatchback, SUV, pickup and taxi in both parking lanes (A1, first pass: needs a look in the Editor) |
| Street details | Bus shelter, bus stop sign, benches, bollards, newspaper boxes, bike rack (A2, first pack) |
| Presets and F3 | Low to Extreme presets (`F5`), no frame cap by default with an optional cap (`F6`), F3 overlay with fps, 1% low, CPU/GPU ms, draw calls and a frame-time graph (B1 and B2 in part; upscaling still to do) |

## Next, in order (small steps)

### A. Finish the street
| # | Work | Done when |
|---|---|---|
| A1 | **Parked cars**: 3–4 procedural body types (sedan, SUV, taxi, pickup) with bevelled panels, glass, wheels, lights; car-paint material (HDRP StackLit or Lit with clear coat and flakes); placed only in parking lanes | Cars on both kerbs with no overlaps; reflections read on the paint |
| A2 | **Street details**, one small pack at a time: bus stop, benches, newspaper boxes, parking meters, bollards, then overhead wires with sag, then gutter litter and leaves as decals | Each pack is its own commit |
| A3 | **Street audit**: an editor test that fails on floating, sunk or overlapping objects, and on cars outside parking lanes | Runs from the Test Runner |

### B. Core for a bigger world
| # | Work |
|---|---|
| B1 | **Quality presets** Low to **Extreme** as HDRP quality levels plus Volume profiles; no frame cap (`vSyncCount = 0`, `targetFrameRate = -1`), with an optional cap (60/120/144/165/240); DLSS/FSR upscaling and dynamic resolution |
| B2 | **F3 overlay**: fps, 1% lows, CPU and GPU ms (FrameTimingManager), draw calls, triangles and memory |
| B3 | **Tiles and streaming**: the world in 256 m tiles generated off the main thread (Jobs and Burst), with HLOD rings (full detail < 250 m, simplified < 1 km, merged blocks < 3 km, impostors beyond) |
| B4 | **GPU instancing** for props, cars and vegetation (GPU Resident Drawer and GPU occlusion culling in Unity 6) |

### C. The map
| # | Work |
|---|---|
| C1 | Import real street layouts from **OpenStreetMap** (Brickell, South Beach, Little Havana, Coral Gables, Wynwood, the port) with an editor tool, into a ~6 × 6 km fictional Port Solmar; all names changed and ODbL attribution added. Needs network access to `overpass-api.de` |
| C2 | Terrain: flat Florida ground, canals, seawalls, dunes, mangroves (Unity Terrain or a generated heightfield mesh) |
| C3 | Roads from real widths and lane counts: intersections, medians, crosswalks, ramps, bridges |
| C4 | Lots: yards, driveways, pools, fences, parking lots, plazas, the beach and boardwalk |
| C5 | Variety rules per district, and landmarks every few blocks |

### D. Lighting and atmosphere (HDRP features, tuned)
| # | Work |
|---|---|
| D1 | Sun from real solar position (have it in `TimeOfDay`), plus a moon, stars and night sky |
| D2 | SSGI or ray-traced GI on Extreme; Adaptive Probe Volumes baked per tile for bounce light |
| D3 | Night: every street light, window, sign and car light as a real light near the camera, with volumetric light in the haze |
| D4 | Volumetric cloud presets (cumulus, cumulonimbus, stratus, cirrus) that change through the day, and cloud shadows |
| D5 | Weather: clear, humid, overcast, rain, thunderstorm; wet roads that dry; rain VFX and lightning |
| D6 | Colour: a grade matched to the GTA VI trailer look (warm highlights, teal shade, saturated sunsets) |

### E. Materials and water
| # | Work |
|---|---|
| E1 | Anti-tiling (stochastic sampling and macro variation) in the procedural texture sets |
| E2 | More decals: cracks, patches, oil, tyre marks, paint wear, graffiti, dirt at wall bases |
| E3 | Puddles that fill in rain and dry afterwards |
| E4 | **HDRP Water System** for the bay and the ocean, with foam, caustics and boat wakes |

### F. Models
| # | Work |
|---|---|
| F1 | Buildings: a modular facade kit (sills, balconies, cornices, awnings, A/C units, fire escapes, neon), roofs, district styles, ~40 landmarks, weathering |
| F2 | Vehicles: ~20 types with full detail and interiors; wheels that spin, steer and compress; 3 LODs |
| F3 | Vegetation: more palm species, live oaks, hedges, grass near the camera; wind; leaves lit from behind |
| F4 | People: models with varied clothing and animation (Mixamo clips need your Adobe login) |

### G. Life and gameplay
| # | Work |
|---|---|
| G1 | Traffic with lanes, signals and junctions |
| G2 | Third-person player: walk, run, jump, swim |
| G3 | Driving with Unity's WheelCollider physics, and chase and hood cameras |
| G4 | Audio: engines by RPM, ambience by district, rain, radio |
| G5 | Police and wanted levels, missions, phone, GPS map, save and load |

### H. Extreme preset (strong PCs)
Full-resolution volumetric clouds and SSGI (or ray tracing), 4096² shadows to 2 km, contact shadows
everywhere, detail rings doubled, volumetric light from every light, and optional DoF, motion blur and lens flares.

---

## What I need from Max
1. After each step, the screenshots from **Solmar > Capture Spot Screenshots** and your F3 numbers.
2. For step C1: network access to `overpass-api.de` (or Full) in this environment's settings.
3. Your GPU and RAM, to set the preset targets.
