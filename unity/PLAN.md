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

- **Wave 1 done (26 Sep):** 2 × 2 km city map (M1), new driving (A1), weather with dry roads (W1),
  realistic code-built people (P1), 8 car models (V1), traffic (L1).
- **Wave 2 so far:** pedestrians (L2), player moves and melee (P2), car damage (A3), minimap,
  full map and GPS (H1, H2), engine, tyre, horn and footstep sound (S1).
- **Wave 3 so far:** police and wanted level (G1), pause menu, settings and saves (G8).
- Earlier: street scene, buildings with rooms, lamps, signals, palms in beds, sky, clouds, fog,
  night lighting on the street, F3/F5/F6/H overlays, auto-update.

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

---

# The full feature list: everything a GTA VI-level game has

Everything below is the target. The waves above pick from it in order; the tag after each
area (W2, W3…) is the wave it starts in. Items are code-built, as always.

## 1. The world (W1–W4)

- **Map**: 4 × 4 km island city and mainland: downtown towers, Art Deco beach strip, Little
  Havana-style streets, Wynwood-style arts district, wealthy island mansions, suburbs, trailer
  park, industrial port, airport, swamp/Everglades-style wetlands with airboats, farmland, a
  motorway ring, causeways and a drawbridge that opens for boats.
- **Water**: ocean with swell, surf breaking on the beach, foam and caustics, marina, canals,
  bay, rivers, underwater seabed with rocks, weed and wrecks; the tide.
- **Beaches**: sand with footprints, umbrellas, towels, volleyball nets, jet-ski rental, pier.
- **Landmarks**: stadium, arena, convention centre, hotel towers, lighthouse, Ferris wheel, a
  theme-park-style pier, a university campus, a hospital, police and fire stations, a prison.
- **Interiors you can enter**: convenience stores, clothes shops, gun shops, barber, tattoo
  parlour, car dealers, mod garages, bars, clubs, strip mall, diner, safehouses, police
  station, hospital, the airport terminal, mission-only interiors (banks, mansions, warehouses).
- **Detail**: graffiti, murals, billboards and shop signs with made-up brands, litter, trash
  bags, overflowing bins, puddles, oil stains, skid marks, cracks, potholes, manhole steam,
  street vendors, food trucks, construction sites with cranes and barriers.
- **Vegetation**: palms that sway in wind, banyan trees, mangroves, hedges, lawns, flowers,
  grass that bends when walked through.
- **Streaming and LOD** so the whole map has no loading screens: tiles, impostors far away,
  occlusion culling, GPU instancing for props and plants.

## 2. Time, weather and light (W1–W2)

- Full day/night cycle (1 game minute = 2 real seconds by default), sunrise and sunset colour,
  moon and stars, light pollution glow over the city at night.
- Weather: clear, humid haze, fog at dawn, overcast, showers, thunderstorms with lightning
  strikes, tropical storm and hurricane events with flooding, wind that bends palms and blows
  litter; wet surfaces, puddles, rain on windscreens and wipers, drying in the sun.
- Seasons feel: hotter summer haze, winter clearer skies, holiday decorations.
- Night: every lamp, window, neon sign, billboard and headlight lights up; nightlife districts.

## 3. The player character (W2–W3)

- Walk, jog, sprint (stamina), crouch, sneak, jump, climb walls and ladders, vault fences,
  swim on and under water, dive, fall and ragdoll, get up, stumble when bumped.
- Smooth third-person and optional first-person camera; camera shake, head bob options.
- Contextual interactions with a prompt (E): open doors, sit on benches and chairs, lean on
  walls, use ATMs, vending machines, payphones, pick things up, knock on doors, pet dogs.
- Health, armour, regeneration below half health, injuries (limp), hospital respawn.
- Skills that improve with use: stamina, strength, shooting, driving, flying, stealth, lung
  capacity.
- **Two playable protagonists** with switching, each with their own safehouse and wardrobe.
- Customisation: clothes, shoes, hats, glasses, jewellery, haircuts, beards, tattoos; outfits
  saved; clothes get wet in rain and dirty from fights.

## 4. Vehicles (W1–W4)

- 40+ code-built vehicles in classes: compacts, sedans, SUVs, coupés, muscle, sports,
  supercars, classics, pickups, vans, trucks and semis with trailers, buses, taxis, emergency
  vehicles, motorbikes, scooters, bicycles, ATVs, golf carts, boats (speedboats, jet skis,
  yachts, airboats), planes and helicopters.
- Handling per class; surface grip (asphalt, wet, sand, grass, mud); tyre wear and blowouts;
  nitrous on some cars; wheelies on bikes; boat physics on waves; flight model for aircraft.
- Get in any car: open doors, pull the driver out, smash a window, hot-wire, carjack at
  lights; passengers; sit in the back of a taxi and skip the ride.
- Damage: dents that deform the mesh, detached bumpers and doors, broken glass and lights,
  smoking and burning engines, explosions, flooded engines, flat tyres; repairs at garages.
- Customisation at mod shops: paint (colours, metallic, matte, pearl), wraps, rims, tyres,
  tint, lowering, body kits, spoilers, exhausts, engine, brakes, turbo, horns, neon.
- Fuel (optional), car wash, insurance and a phone call to get a lost car back, impound lot.
- Interiors with working dashboards, turn signals, wipers, headlights, hazard lights, horn.
- Cameras: chase near/far, bonnet, bumper, first-person cockpit, cinematic.
- Radio in every car.

## 5. A living city (W1–W4)

- **Traffic** that obeys lights, lanes, speed limits and right of way; turn signals; honking;
  road rage; accidents between AI; buses at stops; taxis picking up fares; emergency vehicles
  with sirens that traffic pulls over for; parking and leaving parking spaces; rush hours.
- **Pedestrians** with schedules: commuting, shopping, jogging, walking dogs, skateboarding,
  sunbathing, swimming, fishing, busking, arguing, phoning, taking selfies, filming the player,
  sitting in cafés, waiting at bus stops; crowds by district and hour; tourists on the beach.
- **Reactions**: people flee gunfire, call the police, fight back, record you on their phones,
  comment on your clothes or car, get angry when bumped, help after a crash.
- **Ambient events**: muggings, car thefts, street races, arrests, fires, fights, parties,
  proposals, drug deals, broken-down cars, random encounters with side characters.
- **Animals**: pelicans, seagulls, pigeons, herons, dogs, cats, iguanas, alligators in the
  wetlands, dolphins and fish at sea.

## 6. Law and crime (W3)

- Wanted level from 1 to 5 stars; witnesses must report a crime; search zones on the map;
  breaking line of sight; hiding in bushes or garages; changing car; paying off heat.
- Police: patrol cars, bikes, SWAT, helicopters with spotlights, boats, roadblocks, spike
  strips, PIT manoeuvres, K-9 units; arrest (busted) with a surrender option; bribes.
- Crimes: speeding and running lights (at high stars only), carjacking, assault, shooting,
  robbing stores, trespassing.

## 7. Combat and weapons (W3)

- Melee: punches, kicks, combos, blocking, takedowns; bats, knives, machetes.
- Firearms: pistols, SMGs, shotguns, assault rifles, snipers, LMGs, launchers, throwables
  (grenades, molotovs, sticky bombs); attachments (scopes, suppressors, grips, magazines).
- Aim assist and free aim, cover system, blind fire, weapon wheel, recoil and spread, bullet
  penetration and ricochets, hit reactions per body part, bleeding, ragdolls, ammo shops.
- Destructible props: glass, bottles, signs, hydrants that spray water, fences, barrels.

## 8. Missions and activities (W3–W4)

- A story with a beginning, middle and end: 50+ missions across two protagonists, heists with
  planning (choose crew, approach and getaway), cutscenes with in-engine cameras.
- Mission system: objectives, markers, checkpoints, fail and retry, gold medals, replays.
- Side activities: street races, drag races, stunt jumps, taxi, delivery, tow truck,
  paramedic, firefighter, vigilante, bounty hunting, boat races, fishing, golf, tennis,
  darts, bowling, arcade games, gym, triathlon, parachuting, hunting in the wetlands, dating.
- Collectibles and random strangers with their own short stories.
- Businesses to buy and run (car wash, nightclub, bar, taxi firm) with weekly income.

## 9. Money, property and shops (W3)

- Wallet and bank, ATMs, stock market with made-up companies that missions affect.
- Buy houses, apartments, garages, boats slips and hangars; decorate the safehouse.
- Shops: clothes, guns, cars (dealership and online), boats, food and drinks that heal.

## 10. Phone and apps (W3)

- Contacts and calls, texts, email, a social-media feed that reacts to what you do, a camera
  (selfies), GPS/map, a bank app, a car-delivery app, the stock market, a music app, quick
  jobs, and an in-game internet with parody sites.

## 11. Sound (W2 onward, all synthesised)

- Engines by RPM, load and gear per car, turbo whistle, backfires, gearbox whine, tyre squeal
  by surface, suspension thumps, crashes and glass breaking, doors and indicators, horns,
  sirens with Doppler, motorbikes and boats and aircraft.
- Footsteps by surface and shoe, clothes rustle, breathing when tired, splashes and swimming.
- Weapons: shots with distance-based tails and echoes in streets, reloads, shell casings,
  impacts per material, explosions.
- City ambience by district and time: traffic hum, distant sirens, crowds, construction,
  birds in the morning, insects at night, waves on the beach, wind, rain on surfaces and car
  roofs, thunder.
- **Radio stations**: 8–10 stations with procedurally composed music in different genres,
  DJ jingles and adverts (synthesised), news that mentions your actions.
- Voice barks for pedestrians and police (synthesised speech-like sounds with subtitles).
- UI sounds, phone ringtones, mission-pass music stingers; 3D audio with reverb zones
  (tunnels, interiors, underpasses).

## 12. Camera, presentation and UI (W2–W5)

- HUD: minimap with GPS route, health/armour, money, wanted stars, weapon and ammo,
  notifications, subtitles.
- Full map and legend, waypoints, GPS voice, fast travel by taxi.
- Menus: title screen, pause, settings (graphics, display, controls, key rebinding, audio,
  gameplay, HUD, accessibility), stats, brief (mission log), gallery.
- Cinematic camera in cars, slow-motion on big crashes (optional), death and busted screens.
- **Photo mode**: free camera, depth of field, filters, time and weather control.
- Loading screen art made in code, credits.

## 13. Graphics "insane touchups" (continuous, big pass in W5)

- Ray-traced reflections, shadows and GI on Extreme; DLSS/FSR upscaling; motion blur, depth
  of field, lens flares, chromatic aberration options, film grain.
- Detailed procedural materials with anti-tiling, parallax, dirt and wear masks, wet layers.
- Cloth and hair movement, facial animation, skin detail, sweat and wet looks.
- Water interactions: wakes, splashes, ripples, drips; smoke and fire with volumetrics.
- Colour grade matched to the GTA VI trailer; HDR output.

## 14. Controls, accessibility and settings (W3)

- Keyboard and mouse, full gamepad support with vibration, remappable keys, invert and
  sensitivity options, aim assist levels, subtitles and sizes, colour-blind modes, HUD scale,
  camera shake off, hold-to-toggle options.

## 15. Saving and technical (W3–W5)

- Autosave and manual saves at safehouses, several slots, cloud-style save files.
- Performance targets and automatic checks (floating objects, overlapping meshes, NaNs),
  crash-free play sessions, frame-time budget per system, stress test scenes.
