# Project SOLMAR: Roadmap to a complete game (Unity 6 HDRP)

**Goal:** a realistic, fully playable open-world crime game set in a Miami-style city, in the
spirit of GTA VI. You walk, drive, fight and do missions in a living city with traffic, people,
police, day and night, and weather.

## Honest scope

GTA VI was made by roughly 2,000 people over about ten years, so an exact match isn't realistic.
What is realistic is a **compact, polished open world**: about 3 × 3 km with downtown, a beach
strip, neighbourhoods, a port and a highway. It has drivable cars, traffic, pedestrians, police,
a phone and map, and a short story with side activities. It should look as close to real life as
HDRP allows.

| Claude can build in code | Needs art from outside (you choose, I integrate) |
|---|---|
| The whole city layout: roads, blocks, intersections, sidewalks, medians, beach, water, bridges | **Realistic people**: body models and animations. Free: Mixamo (needs your Adobe login). Paid: Asset Store character packs or Reallusion |
| Buildings and interiors behind windows, street furniture, road markings | **Hero cars at GTA level**: procedural cars look good parked or at a distance. Close-up realism needs bought models (about $20–60 a car on the Asset Store) |
| Game systems: driving physics, traffic AI, pedestrians, police, missions, HUD, map, save/load, menus | **Photo-scanned textures**: free CC0 from Poly Haven and ambientCG. Needs those sites allowed in this environment's network settings, or you download them |
| Lighting, sky, weather, water, performance, quality presets | **Voice acting and music**: optional; text and synth sound work until then |
| Procedural palms, trees, hedges and grass (good at street distance) | Close-up vegetation: SpeedTree or an Asset Store palm pack, optional |

**How I work:** small steps, each one playable. After each step you playtest and send screenshots
and F3 numbers. Updates reach RealisticGame by themselves (Solmar > Auto Update). I do the work
myself and only use sub-agents for big, separable jobs, to save your usage.

---

## Done so far

- One downtown street at golden hour, with wet asphalt, puddles, decals and kerbs.
- Buildings (Art Deco, MiMo, classic, glass towers) with rooms behind the windows.
- Street lamps, signals, hydrants, a bus shelter, benches, bollards, news boxes, parked cars, palms.
- Physical sky, volumetric clouds and fog, soft shadows, reflections, synthesised city sound.
- Fly and walk cameras, time of day, screenshots, Low to Extreme presets, no fps cap, the F3 overlay.
- Auto-update into your Unity project, and a guard against broken meshes.

**What's wrong now (from your playtest):** it's one straight road that ends in nothing, and the
palms stand in concrete. Phases 1 and 2 fix both.

---

## Phase 1: Streets that look right (small, starts now)

| # | Work |
|---|---|
| 1.1 | **Palms in soil, not concrete.** A landscaped median with grass, shrubs and royal palms; grass swales between the kerb and the sidewalk on residential streets; raised stone planters with ground cover downtown. No palm in bare paving |
| 1.2 | Close the street ends: a T-junction with cross streets and buildings, so there's no void |
| 1.3 | Scene tidy-up: hide the editor grid and gizmos in the Game view, a default camera at eye level, and a small help overlay (`H`) listing the keys |

## Phase 2: A real city layout

| # | Work |
|---|---|
| 2.1 | **Road network generator**: a graph of streets (grid downtown, curving roads in the suburbs, avenues with medians) that builds every road, intersection, crosswalk, kerb ramp, lane marking and signal from the graph |
| 2.2 | **Blocks and lots**: split the space between roads into blocks, then lots; buildings fill lots by district (towers, Art Deco hotels, shops, houses with yards, pools and fences, warehouses, parking lots) |
| 2.3 | **Streaming**: the city in 200 m tiles built off the main thread and loaded around the player, with levels of detail (full < 250 m, simple < 1 km, merged blocks beyond) |
| 2.4 | **First district, 1 × 1 km downtown**: playable end to end |
| 2.5 | **Coast**: beach, dunes, boardwalk and lifeguard towers; ocean and bay with HDRP Water (waves, foam, caustics) |
| 2.6 | **More districts**: South Beach-style Art Deco strip, Little Havana-style shops, suburbs, port with cranes and containers, Wynwood-style murals; causeway bridges and an elevated highway loop. Target 3 × 3 km |
| 2.7 | Optional: real street layouts from **OpenStreetMap** (renamed), needs `overpass-api.de` allowed |

## Phase 3: The player

| # | Work |
|---|---|
| 3.1 | Third-person character controller: walk, run, sprint, jump, climb low walls, swim; an orbit camera with collision |
| 3.2 | A placeholder character first, then a realistic one with animations. **Needs you**: Mixamo clips or a character pack |
| 3.3 | Health, stamina, ragdoll on falls and hits |

## Phase 4: Driving

| # | Work |
|---|---|
| 4.1 | Car physics on WheelColliders: engine and gear curves, grip by surface, handbrake, drifts; chase, bonnet and interior cameras |
| 4.2 | Get in and out of any car (steal parked ones), with door and seat animations once the character is in |
| 4.3 | Damage: dents, broken glass and lights, smoke, fire |
| 4.4 | Vehicle set: 10–15 procedural types (sedans, SUVs, sports cars, taxi, police, bus, trucks, bikes, boats). Optional: swap in bought hero models |
| 4.5 | Car radio stations (synthesised music at first) |

## Phase 5: A living city

| # | Work |
|---|---|
| 5.1 | **Traffic AI** on the road graph: lanes, signals, turns, yielding, lane changes, no pile-ups; reacts to the player |
| 5.2 | **Pedestrians**: walk the sidewalks and crossings, wait at lights, sit on benches, flee from danger, crowd density by district and hour |
| 5.3 | Night: every street light, window, sign and headlight is a light source; neon districts |
| 5.4 | Weather: clear, humid, overcast, rain and thunderstorms; wet roads that dry; rain on cars |
| 5.5 | City sound: engines by RPM, horns, sirens, crowds, waves, rain, by district and time |

## Phase 6: Gameplay

| # | Work |
|---|---|
| 6.1 | **HUD**: minimap with GPS route, health, money, wanted stars |
| 6.2 | **Police and wanted level**: crimes raise heat; patrols, chases, roadblocks, helicopters; escape by breaking line of sight |
| 6.3 | Weapons and combat: aim, cover, hit reactions (weapon models procedural at first) |
| 6.4 | **Phone**: contacts, missions, map, camera |
| 6.5 | **Missions framework**: scripted objectives, checkpoints, cutscene cameras, fail and retry |
| 6.6 | Story: 10–15 missions over a short arc, plus side activities (street races, taxi jobs, deliveries, stunt jumps) |
| 6.7 | Money, shops (clothes, cars, safehouse), save and load, pause menu, settings (graphics, controls, audio), gamepad support |

## Phase 7: The "insane touchups" (continuous, and a big pass at the end)

| # | Work |
|---|---|
| 7.1 | Photo-scanned textures with anti-tiling; dirt, cracks, oil, litter and tyre marks as decals |
| 7.2 | Ray-traced reflections, GI and shadows on Extreme (RTX GPUs); DLSS or FSR upscaling |
| 7.3 | Cinematic colour grade matched to the GTA VI trailer look; lens effects; photo mode |
| 7.4 | Close-up detail: parallax bricks and pavers, interiors you can enter in key buildings, detailed car interiors |
| 7.5 | Performance: target 60+ fps at 1440p on High on a mid-range RTX card, and uncapped on Extreme for strong PCs; automatic tests for floating or overlapping objects |

---

## First concrete steps

1. **1.1 Palms in soil**: median, swales and planters on the current street.
2. **1.2 Close the street ends** with cross streets.
3. **2.1 Road network generator**, then 2.2 blocks, giving a first grid of about 4 × 4 blocks you can walk and fly around.

Each step: compile check, push, auto-update into your Unity, you playtest.

## What I need from you

1. Screenshots and F3 numbers after each step.
2. By Phase 3: your choice of character source (Mixamo, which is free, or a paid pack).
3. Optional, any time: allow `polyhaven.com`, `dl.polyhaven.org`, `ambientcg.com` (textures) and `overpass-api.de` (real maps) in this environment's network settings.
