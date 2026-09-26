# Project SOLMAR: Roadmap to a complete game (Unity 6 HDRP)

**Goal:** a realistic, fully playable open-world crime game set in a Miami-style city, in the
spirit of GTA VI. You walk, drive, fight and do missions in a living city with traffic, people,
police, day and night, and weather.

**Rule (Max's choice): everything is made in code by Claude.** No bought or downloaded models,
textures, animations or sounds. People and cars are built from procedural meshes and animated in
code; textures are baked by compute shaders; sound is synthesised.

**How the work runs:** helpers (sub-agents) build separate pieces in parallel, each in its own
files. Each piece is compile-checked, pushed, and reaches Max's Unity by itself (Solmar > Auto
Update, every two minutes). Max playtests and sends screenshots, clips and F3 numbers, and the
next wave fixes what's wrong.

---

## Done so far

- Street scene at golden hour; buildings with rooms behind the windows; palms in planted beds.
- Street lamps, signals, bus shelter, benches, parked cars; night lighting for the street.
- Sky, volumetric clouds and fog, soft shadows, reflections, synthesised city sound.
- First road-network generator and a 4 × 4-block district.
- A third-person player (first cut), a drivable car (first cut).
- F3 performance overlay, F5 quality presets, F6 fps cap, H help, auto-update.

## What Max's playtest found (26 Sep)

| Problem | Fixed by |
|---|---|
| The car slides out and turns too sharply, and it's slow | A1 |
| The map is a straight line, not a city | M1–M4 |
| The player looks like a mannequin with its arms stuck up | P1–P2 |
| No people on the streets | L2 |
| No traffic | L1 |
| Cars still look fake | V1 |
| The road is soaking wet when it hasn't rained | W1 |

---

## Wave 1 (running now)

| # | Piece | What it gives you |
|---|---|---|
| **M1** | **A real city map** | A 2 × 2 km city, not a straight line: a downtown grid with a diagonal avenue, curving residential streets, a coastal boulevard along the beach, a waterfront, parks and plazas, blocks of different sizes and shapes, and dead-end-free streets. It becomes the default scene you play in |
| **A1** | **Driving that feels right** | Real acceleration (0–100 km/h in about 6 s, top speed about 200 km/h), gears, speed-sensitive steering, grip that lets go progressively instead of spinning out, stability control you can switch off, anti-roll, downforce, and a chase camera that settles |
| **W1** | **Weather and dry roads** | Dry asphalt by default; rain showers and thunderstorms that wet the road, fill puddles and slowly dry out; rain and splashes; weather cycles on its own (`K` cycles it by hand) |
| **P1** | **A realistic person** | A properly proportioned code-built body with a real head, hands, clothes and hair; arms hang naturally; smooth walk, run, idle and jump animation with foot placement; different looks (body type, skin, clothes) for everyone |
| **V1** | **Better-looking cars** | Car bodies from real proportions with smooth curved panels, proper glass, lights, grilles, rims and interiors; several models (sedan, SUV, sports car, taxi, pickup, van) |
| **L1** | **Traffic** | Cars that drive the road network in lanes, stop at red lights, turn at junctions, keep their distance, and brake for you |

## Wave 2 (next)

| # | Piece |
|---|---|
| **L2** | **Pedestrians**: people on every pavement, walking, waiting at crossings, sitting, chatting, using phones; they dodge you, flee from danger and react to crashes |
| **L3** | Night lighting across the whole map (lamps, windows, neon signs, headlights, tail lights) |
| **P2** | Player moves: sprint with stamina, climb low walls and fences, vault, fall and ragdoll, swim, punch and kick |
| **A2** | Get into any car: open the door, pull the driver out, hot-wire parked cars; car doors and seats |
| **A3** | Damage: dents, broken glass and lights, smoke, fire and explosions; flat tyres |
| **H1** | **HUD**: minimap with roads and GPS route, health and armour, money, wanted stars, weapon |
| **H2** | Full-screen map with waypoints (click to set a route) |
| **S1** | Sound: engines by RPM and gear, tyre squeal, crashes, footsteps by surface, rain and thunder |

## Wave 3: Gameplay

| # | Piece |
|---|---|
| **G1** | **Police and wanted level**: crimes raise heat; patrols, sirens, chases, roadblocks, a helicopter with a spotlight; escape by breaking line of sight; busted and wasted |
| **G2** | Weapons and combat: pistols, SMGs, rifles, shotguns; aim, cover, recoil, hit reactions, ammo, weapon wheel |
| **G3** | **Missions**: objectives, markers, checkpoints, cutscene cameras, fail and retry |
| **G4** | Story: 12–15 missions over a short arc with two playable characters |
| **G5** | Side activities: street races, taxi jobs, deliveries, stunt jumps, collectibles, a boat race |
| **G6** | Money: wallet, bank, shops (clothes, weapons, cars), buying a safehouse and garage |
| **G7** | Phone: contacts, texts, missions, map, camera and a social feed |
| **G8** | Save and load, pause menu, settings (graphics, controls, audio), key rebinding, gamepad |
| **G9** | Character stats that improve with use: driving, shooting, stamina |

## Wave 4: A bigger, richer world

| # | Piece |
|---|---|
| **M2** | Districts with their own look: glass-tower downtown, Art Deco beach strip, Little Havana-style shops, Wynwood-style murals, suburbs with houses, pools and fences, an industrial port with cranes and containers |
| **M3** | Coast and water: beach, dunes, boardwalk, lifeguard towers, marina and boats; ocean and bay with HDRP Water (waves, foam, caustics) |
| **M4** | Highways and bridges: an elevated highway loop, on-ramps, causeway bridges to islands; grows to about 4 × 4 km |
| **M5** | Streaming and levels of detail, so the whole map runs smoothly: tiles loaded around the player, simpler buildings far away |
| **M6** | Enterable interiors: shops, a bar, a garage, the safehouse, a police station |
| **M7** | Landmarks: a stadium, a hotel tower, a pier with a Ferris wheel, an airport strip |
| **L4** | More vehicles: buses, trucks, police cars, ambulances, fire trucks, motorbikes, bicycles, boats, a helicopter |
| **L5** | Radio stations with synthesised music and DJ jingles |
| **L6** | Animals: birds, seagulls, pelicans, dogs on leads |
| **L7** | City life by time of day: rush hours, nightlife crowds, empty streets at dawn; events like street parties |

## Wave 5: The "insane touchups" (continuous, and a big pass at the end)

| # | Piece |
|---|---|
| **T1** | Richer textures with anti-tiling; dirt, cracks, oil stains, litter and tyre marks |
| **T2** | Ray-traced reflections, GI and shadows on Extreme; DLSS or FSR upscaling |
| **T3** | A cinematic colour grade like the GTA VI trailer; lens effects; photo mode |
| **T4** | Close-up detail: parallax bricks and pavers, detailed car interiors, faces with expressions |
| **T5** | Physics: breakable props (bins, hydrants that spray, signs, fences), debris, water splashes |
| **T6** | Performance: 60+ fps at 1440p on High on a mid-range RTX card; automatic checks for floating or overlapping objects |
| **T7** | Menus and presentation: title screen, loading screen, credits |

---

## What I need from you

1. After each update: play it, then send screenshots or a short clip and what feels wrong.
2. F3 numbers if anything stutters.
3. For automatic updates: a GitHub token once (Solmar > Set GitHub Token...), or make the repo public.
