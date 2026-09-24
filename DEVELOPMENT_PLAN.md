# Project SOLMAR: Development Plan

**An ultra-realistic open-world crime game in the spirit of GTA VI**

> Working title: **SOLMAR**. Genre: third- and first-person open-world action crime drama.
> Target platforms: PC, PlayStation 5 / PS5 Pro, Xbox Series X|S.
> Engine: Unreal Engine 5 (latest stable 5.x at project start, locked per milestone).

---

## 0. Scale and legal ground rules

A game at GTA VI's level is one of the largest creative projects in any medium. Titles in this class
take **5–10 years**, **1,000–3,000+ developers across several studios**, and budgets from **hundreds of
millions to over $1 billion**. This plan is written as the full AAA plan, and you can build it in
stages:

| Track | Team | Time | What ships |
|---|---|---|---|
| **A. Solo / indie slice** | 1–5 | 1–2 yrs | One ~1 km² hyper-real district, driving, on-foot, police, one story mission |
| **B. AA open world** | 30–120 | 3–5 yrs | ~15–25 km² city, 20–30 hr campaign, reduced crowd/interior density |
| **C. Full AAA ("GTA VI class")** | 800–2,500+ | 6–8 yrs | 80–120 km² state, 50+ hr campaign, online mode after launch |

The phases in §12 are the same for all three tracks; only the amount of content changes. **Track A is
where you start no matter which track you are aiming for.** It proves the tech and becomes the pitch
build for funding.

**Legal ground rules**
- Everything is **original IP**. No Rockstar names, logos, characters, map layouts, UI, music or code.
  "In the spirit of" means genre and quality bar, never copying.
- Parody brands need legal review. Real cars, guns, songs and brands need licenses, or original designs.
- Photogrammetry and GIS data must use commercially licensed or self-captured sources.

---

## 1. Vision and design pillars

**One-line pitch:** a living, sun-bleached, neon-soaked Gulf Coast state where every street, NPC and
headline reacts to you, told through a two-person crime story about loyalty in the age of going viral.

### Pillars (every feature must serve at least one)
1. **Believable world, not just a pretty one.** NPCs have schedules, memories and opinions. The city runs
   whether or not you are watching.
2. **Physical truth.** Light, materials, water, vehicles, bodies and destruction behave the way they do
   in reality. If a real camera would not capture it, we do not render it.
3. **Density over size.** Every block is enterable, readable or reactive. A smaller dense map beats a
   huge empty one.
4. **Cinematic but playable.** Film-grade performance capture and staging that never takes control
   away without reason.
5. **Consequence.** Crimes, witnesses, social media, heat, reputation and economy all feed back into
   the world.

### Setting: the State of San Solano (fictional)
| Region | Real-world inspiration | Character |
|---|---|---|
| **Port Solmar** (main city) | Miami | Art-deco beachfront, glass towers, Little Havana-style barrios, port, nightlife |
| **Cypress Reach** | Everglades | Swamps, airboats, gator farms, meth trailers, storms |
| **Coral Keys** | Florida Keys | Island chain linked by long bridges, smuggling, boats, reefs |
| **Palmetto Flats** | Central/rural Florida | Citrus groves, trailer parks, speedway, strip-mall towns |
| **Harbor Point** | Tampa / Gulf coast | Industrial port, refineries, second city |
| **Mount Lorn** | Fictional highlands | Only elevation on the map: forests, lakes, cabins, off-road |

### Story (outline)
- **Two playable protagonists** (original): a couple who move from small-time scams to large-scale
  heists. You can switch between them in free roam, and they share some missions.
- **Three acts, ~60–80 main missions, 150+ side activities**, with branching choices that decide
  who survives and which ending you get.
- **Themes:** influencer culture, the housing crisis, the drug economy, corrupt institutions, loyalty.
- **Satire layer:** in-game social feed, TV, talk radio and ads that comment on the player's actions
  and on current culture.

---

## 2. Technology strategy

### 2.1 Engine: Unreal Engine 5 (modified)
Building a proprietary engine like RAGE would take 3–5 years before any game work starts. UE5 provides
most of the needed foundation, and we extend it where open-world scale requires it.

| Need | UE5 foundation | Our extension |
|---|---|---|
| Huge streaming world | World Partition, Level Instances, HLOD, Data Layers | Custom streaming predictor for 250 km/h driving and aircraft; interior cell system |
| Film-quality geometry | Nanite (incl. foliage and skinned meshes) | Nanite-aware destruction and damage decals |
| Global illumination | Lumen (hardware RT) | Tuned city GI cache; night-time light budget system |
| Many lights (neon, traffic, windows) | MegaLights / clustered lighting | Procedural window-lighting system (millions of emissive windows) |
| Shadows | Virtual Shadow Maps | Cached far-shadow system for skyline |
| Materials | Substrate (layered physical materials) | Wetness, dirt, sun-bleaching and wear as world-state parameters |
| Crowds and traffic | Mass Entity, ZoneGraph, StateTree, Smart Objects | Full traffic and crowd simulation (§5) |
| Characters | MetaHuman, Groom (strand hair), ML Deformer | NPC variation generator; cloth and sweat and wetness |
| Animation | Motion Matching, Control Rig, Full-Body IK | Active-ragdoll / physics-based reaction system (§4.2) |
| Physics | Chaos (rigid, cloth, destruction, vehicles) | Custom tire model and soft-body vehicle damage |
| Water | Water plugin, Niagara Fluids | Ocean spectrum waves, buoyancy, wakes, shore foam, flooding |
| Procedural content | PCG Framework + Houdini Engine | City-block, road and vegetation generators |
| Audio | MetaSounds | Plus Wwise for dialogue, radio and interactive music |

**Languages:** C++ for engine and systems, Blueprints/StateTree for design scripting, Python for tools.

### 2.2 Platform targets
| Mode | Resolution | FPS | Notes |
|---|---|---|---|
| PS5 / XSX Quality | 4K output (TSR from ~1440p) | 30 | Full RT GI and reflections |
| PS5 / XSX Performance | 1440p output | 60 | Software Lumen, reduced crowd LOD |
| PS5 Pro | 4K (PSSR) | 30 / 60 | RT reflections in 60 mode |
| Xbox Series S | 1080p–1440p | 30 | Lower density tiers |
| PC | Up to 8K, DLSS / FSR / XeSS, frame gen | Uncapped | Path-tracing "Photo Mode Plus" option |

### 2.3 Frame budget (PS5 Quality, 33.3 ms)
| GPU pass | ms | CPU thread | ms |
|---|---|---|---|
| Nanite geometry and base pass | 7.0 | Game thread (gameplay, scripting) | 8 |
| Lumen GI and reflections | 8.0 | Mass AI (crowds and traffic, parallel) | 6 |
| Virtual shadow maps | 4.0 | Animation (worker threads) | 6 |
| Sky, clouds, fog, volumetrics | 2.5 | Physics / Chaos | 5 |
| Water | 2.0 | Streaming and decompression | 2 |
| Characters, hair, skin | 2.0 | Audio (own thread) | 3 |
| Particles and translucency | 2.5 | Render thread | 12 |
| Post-processing and upscaling | 3.0 | | |
| **Headroom** | **2.3** | | |

**Memory:** about 12.5 GB usable on PS5. Streaming budget: textures 4 GB, geometry 2.5 GB, animation
1 GB, audio 0.7 GB, simulation 1.5 GB, everything else 2.8 GB. The SSD streaming target is a
sustained 1.5–2.5 GB/s with Oodle Kraken/Texture compression.

### 2.4 Infrastructure
- **Source control:** Perforce Helix Core for assets and code; Git mirrors for tools.
- **Builds and CI:** Unreal Horde with distributed compile, cook farm and shader farm. Nightly
  playable builds on every platform.
- **Automated testing:** Gauntlet, functional tests, and autonomous bot playthroughs (§11).
- **Telemetry:** in-house performance and crash telemetry, heatmaps, and a streaming-hitch tracker.
- **Collaboration:** Jira/Linear, Confluence, ShotGrid for cinematics and art tracking.

---

## 3. World creation pipeline

### 3.1 Map spec (Track C)
- **~100 km² total**, including ~55–65 km² of land, plus shallow ocean, reefs and the Keys.
- **Port Solmar:** ~18 km² of dense urban area with **~700+ enterable interiors** (shops, bars,
  apartments, offices, clubs, the mall, the hospital, the police station, the airport terminal).
- **Real-scale roads:** highways and bridges built to real engineering curvature and grade.

### 3.2 Pipeline
```
Reference trips (photos, video, audio, LIDAR)
        │
GIS / OSM-style data (licensed) → road network, zoning, building footprints
        │
Houdini + PCG generators → blockout city (roads, lots, buildings, vegetation, props)
        │
Kit-bash modular building sets (Nanite) + hero landmarks (hand-modelled)
        │
Photogrammetry library (self-scanned + licensed) → materials and props
        │
Hand dressing pass (every street gets a "story": wear, trash, graffiti, signage)
        │
Lighting pass (time of day × weather × interiors) → HLOD bake → validation
```

### 3.3 Hyper-realism checklist for the world
- **Surfaces:** layered materials with dust, grime, rust, sun-bleach, tire marks and oil stains.
- **Wetness:** real-time puddle accumulation, drying, and wet reflections on every surface.
- **Vegetation:** wind-reactive palms and mangroves, player and vehicle interaction, seasonal variety.
- **Signage:** thousands of unique parody brands, shop fronts and billboards, with a rotating ad system.
- **Clutter density:** trash, bikes, cones, shopping carts, construction zones that change over the story.
- **Audio zones:** every block has its own ambient layering (A/C units, music leaking from bars, birds,
  highway hum).

### 3.4 Time of day, weather and climate
- Physically based sky and atmosphere, volumetric clouds, and real sun and moon positions for the latitude.
- **Weather states:** clear, humid haze, afternoon thunderstorm, tropical storm, **hurricane event**
  (scripted plus systemic flooding), fog, heat shimmer.
- Weather affects driving grip, NPC behavior (umbrellas, running for cover, fewer pedestrians),
  audio and lighting.

---

## 4. Characters and animation

### 4.1 Characters
- **Protagonists and key cast:** full-body and 4D facial scans of real actors, strand-based hair,
  wrinkle maps, sweat/wetness/blood layers, and physically based skin (multi-lobe SSS).
- **NPC population:** at least **2,000 unique base NPCs** built from a MetaHuman-based generator
  (body type, age, ethnicity, clothing, accessories). Target: no duplicate pedestrian visible
  on-screen at once.
- **Wardrobe:** 1,500+ clothing items with cloth simulation for loose garments.
- **LOD strategy:** full rig and groom near the camera → cards hair → Mass-driven vertex-animation
  crowds far away.

### 4.2 Animation (the realism multiplier)
- **Motion matching** for locomotion, driven by a **large mocap library (target 60+ hours)**:
  walking styles by age, mood, weight, drunk, injured, carrying objects, and weather variants.
- **Full-body IK** for foot planting on stairs and slopes, hand placement on cars, walls and cover.
- **Physics-based reactions (active ragdoll):** balance-keeping stumbles, bracing falls, grabbing
  rails, being hit by cars, and bullet impact reactions that blend with animation. This is the key
  to the "real bodies" feel.
- **Contextual interactions:** 3,000+ Smart Object animations (sitting, leaning, smoking, phone use,
  ATM, vending machines, fishing, working).
- **Facial:** MetaHuman Animator plus head-mounted camera capture for all story scenes; procedural
  facial animation (blinks, micro-expressions, lip-sync from audio) for ambient NPCs.

### 4.3 Performance capture
- An in-house mocap stage (or long-term vendor contract) with 60+ camera volume, head-mounted cameras,
  and virtual camera for directors.
- **Estimated scope:** ~40 hours of cinematics, ~200,000 lines of dialogue (story plus ambient
  plus radio).

---

## 5. Simulation: the living city

### 5.1 Pedestrians (Mass Entity + StateTree)
- **Density:** up to **300–500 simulated pedestrians** near the player (full AI within ~150 m) and
  thousands more as lightweight Mass agents.
- **Daily schedules:** home → commute → work → lunch → leisure → home, driven by NPC archetype.
- **Needs and moods:** hunger, fatigue, fear and irritation affect choices and animation style.
- **Perception and memory:** NPCs see and hear events, remember faces and cars for a time, gossip to
  nearby NPCs, and call the police.
- **Social reactions:** filming you on phones (which posts to the in-game feed), fleeing, fighting
  back, helping victims, rubbernecking at crashes.
- **Ambient scenarios:** 500+ systemic micro-events (arguments, street performers, muggings,
  breakdowns, proposals, police stops) that play out without the player.

### 5.2 Traffic
- ZoneGraph lane network with real traffic rules: signals, turn lanes, merging, yielding, emergency
  vehicle pull-over.
- **Driver personalities:** cautious, aggressive, drunk, elderly, road-rage, and distracted
  (phone use).
- Buses on routes, taxis, delivery trucks that actually deliver, garbage trucks, parking and unparking.
- Traffic jams emerge from accidents and roadworks and **persist** until cleared.

### 5.3 Law enforcement and heat
- **Witness-based system:** crimes only count if seen, heard or filmed. Descriptions of the player
  (clothes, vehicle, plates) spread through the radio network and can go stale.
- **Escalation:** local police → state troopers → SWAT → helicopters → federal agents → coast guard.
- **Tactical AI:** perimeter setup, roadblocks, PIT maneuvers, spike strips, flanking, suppression,
  negotiation and surrender options.
- **Consequences:** arrest and bail, court, jail-time montage, and **persistent notoriety**
  per district.

### 5.4 Economy and ownership
- Dynamic prices, property and business ownership (bars, car washes, nightclubs), laundering,
  stock market affected by mission outcomes, and a crypto parody.
- Player phone with apps: map, messaging, social feed, banking, rideshare, dating, property, camera.

### 5.5 Wildlife
- Alligators, birds, pelicans, dolphins, sharks, deer, stray dogs and cats, insects (at night and in
  swamps). All with simple ecology and threat behaviors.

---

## 6. Core gameplay systems

| System | Realism target | Key features |
|---|---|---|
| **On-foot movement** | Weighty, motion-matched | Sprint, climb, vault, swim, dive, ladder, crouch, prone, carry bodies and objects |
| **Driving** | "Sim-cade": realistic weight, forgiving controls | Pacejka-based tires, suspension, weight transfer, gears, manual option, surface grip (wet, sand, mud, gravel) |
| **Vehicle damage** | Soft-body deformation | Crumple zones, broken glass, detachable parts, tire blowouts, engine damage affecting handling, fire |
| **Vehicle roster** | 250+ original vehicles | Cars, bikes, trucks, boats, airboats, jet skis, helicopters, planes, bicycles |
| **Gunplay** | Grounded ballistics | Recoil patterns, penetration by material, attachments, reloading and ammo types, wounded states |
| **Melee** | Physics-driven | Grapples, environmental takedowns, stamina |
| **Stealth** | Perception-based | Light, sound, disguise, line-of-sight, body hiding |
| **Heists** | Planning + execution | Scouting, crew choice, approach choice, gear, getaway routes, systemic failure states |
| **Character state** | Survival-lite | Health, stamina, injuries, hunger (optional), hygiene and style affecting NPC reactions |
| **Camera** | Cinematic | Third person, first person with full body, cinematic chase cam, in-game phone camera, Photo Mode |
| **Activities** | 40+ types | Fishing, hunting, street races, bowling, golf, tennis, nightclubs, gym, jet-ski races, gambling (region-rated), side jobs |

---

## 7. Audio

- **Wwise** for dialogue, music and mixing; **MetaSounds** for procedural vehicle engines and ambience.
- Recorded **real vehicle engines** (granular synthesis per RPM and load), with 3D occlusion and
  obstruction from geometry, plus reverb zones from ray-traced acoustics probes.
- **Radio:** 15+ stations mixing licensed tracks and original music, DJs, talk shows and ads
  (reactive to story events).
- **Ambient dialogue:** a context system that chooses lines based on location, weather, time,
  the player's appearance and recent events.
- **Dynamic score** for missions and chases, with stems that react to intensity.

---

## 8. UI/UX and accessibility

- Minimal, diegetic HUD (phone, car dashboard, GPS on the in-car screen) with an optional full HUD.
- **Accessibility at launch:** subtitle sizing and backgrounds, colorblind modes, full remapping,
  aim assist tiers, driving assists, motion-sickness options, audio cues for visual info, and
  difficulty sliders per system.
- 13+ languages of subtitles and UI; 5 dubbed languages.

---

## 9. Online mode (post-launch, separate production)

- Launch the **single-player game first**. Online ships 6–12 months later as its own product lane.
- Dedicated servers, 32–64 players per session, persistent player properties and businesses, heists,
  races, roleplay-friendly servers, and a creator mode.
- Anti-cheat, moderation, cosmetic-only monetization with no pay-to-win, and ratings compliance.

---

## 10. Team structure (Track C at peak)

| Department | Headcount | Notes |
|---|---|---|
| Leadership and production | 60 | Game director, creative director, producers |
| Engine and core tech | 150 | Rendering, streaming, physics, platform, tools |
| Gameplay engineering | 180 | Systems, AI, vehicles, weapons, UI |
| Game and level design | 200 | Missions, systems, open world, economy |
| Environment art | 450 | World, props, vegetation, interiors, lighting |
| Character art | 150 | Scans, MetaHumans, wardrobe, grooming |
| Animation | 200 | Mocap cleanup, gameplay animation, facial |
| VFX / tech art | 120 | Niagara, shaders, tools |
| Cinematics | 80 | Directing, layout, camera, editing |
| Audio | 90 | Design, dialogue, music, radio |
| Writing and narrative | 30 | Story, missions, radio, ambient VO |
| QA (internal + outsourced) | 400–800 | Functional, compliance, performance, localization |
| Outsourcing partners | 300–800 | Props, vehicles, NPC variants, localization |

---

## 11. Quality, testing and performance

- **Automated bot playthroughs:** AI agents drive every road, walk every sidewalk, and run every
  mission nightly to catch collision holes, streaming hitches, stuck NPCs and crashes.
- **Performance gates:** no build is promoted if any "golden path" capture misses its frame budget.
- **Soak tests:** 24–72 hours of continuous play per platform for memory leaks.
- **Streaming hitch tracker:** every frame over 50 ms is logged with a location and call stack.
- **Playtests:** weekly internal, monthly external focus tests from the vertical slice onward.
- **Certification:** TRC/XR compliance tested from Alpha.

---

## 12. Roadmap and milestones (Track C, ~7 years)

### Phase 0: Concept (months 0–6) · team 20–40
- Pitch, pillars, setting research trips, story outline, art bible, audio direction.
- Tech spikes: World Partition streaming at driving speed, Mass crowds at target density, vehicle
  physics prototype, active-ragdoll prototype.
- **Exit:** greenlight pitch build (2 km² graybox with driving, walking and 200 NPCs).

### Phase 1: Pre-production / tech foundation (months 6–24) · team 100–300
- Engine fork, build farm, streaming system, interior cell system, save system.
- Core loop prototypes: shooting, driving, police, crowds, phone.
- Content pipelines: PCG city generator, scanning pipeline, NPC generator, mocap pipeline.
- **Exit:** **Vertical slice**: one 2–3 km² fully final district of Port Solmar at shipping quality,
  day/night cycle and storm, one complete story mission, one systemic police chase, 60 fps performance
  mode on PS5.

### Phase 2: Production (months 24–66) · team 800–2,500
- World build-out by region: Port Solmar (months 24–48), then Harbor Point, Coral Keys, Cypress Reach,
  Palmetto Flats and Mount Lorn in parallel strike teams.
- Mission production in story order; cinematic capture blocks every quarter.
- Vehicles, weapons, NPC variety, interiors and activities scaled to final counts.
- **Milestones:** First Playable Full Map (month 42) · Content Complete Story (month 58).

### Phase 3: Alpha (months 66–72)
- Feature complete. All missions playable start to finish. Map fully traversable.
- Begin localization, ratings submission prep, and marketing capture.

### Phase 4: Beta (months 72–80)
- Content lock. Bug fixing, performance optimization, and polish passes only.
- Platform certification submissions.

### Phase 5: Launch and live (month 80+)
- Day-one patch, crash telemetry response team, PC port (same day or +6–12 months).
- Online mode launch window and ongoing story DLC.

### Track A (solo / indie) timeline, which is where to actually start
| Months | Goal |
|---|---|
| 1–2 | Learn UE5 C++ and Blueprints; set up repo, Git LFS or Perforce; build the third-person character with Motion Matching sample |
| 3–4 | Driving: Chaos Vehicle with tuned tires, camera, damage; enter/exit car animations |
| 5–7 | 1 km² district with PCG + Fab/Megascans assets, World Partition, Lumen, day/night |
| 8–10 | Mass crowds and traffic on ZoneGraph; basic reactions (flee, call police) |
| 11–13 | Weapons, health, police wanted system with pursuit AI |
| 14–16 | One polished story mission with MetaHuman characters and cinematic |
| 17–18 | Performance pass, packaging, trailer. This becomes the pitch for Track B funding |

---

## 13. Budget estimate (Track C, order of magnitude)

| Item | Estimate |
|---|---|
| Staff (avg ~1,500 people × 7 yrs × fully loaded cost) | $700M – $1.1B |
| Outsourcing (art, QA, localization) | $100M – $200M |
| Performance capture, actors, voice | $30M – $60M |
| Music licensing | $20M – $40M |
| Hardware, software licenses, cloud and build farms | $30M – $60M |
| Engine royalties / custom license | Negotiated |
| **Development total** | **~$0.9B – $1.5B** |
| Marketing (often equal to development) | $300M – $800M |

Track B: roughly $30M–$120M. Track A: mostly your time plus $0–$20K for assets, tools and hardware.

---

## 14. Top risks and mitigations

| Risk | Impact | Mitigation |
|---|---|---|
| Streaming hitches at high speed | Breaks immersion | Predictive streaming, speed-capped LOD budgets, and the hitch tracker from day one |
| CPU cost of crowds and traffic | Frame-rate loss | Mass LOD tiers, strict AI budgets, time-sliced simulation |
| Scope creep | Delays and crunch | Pillar test for every feature, feature-freeze gates, and cutting early |
| Crunch and burnout | Quality loss and attrition | Realistic milestones, protected hours, staffing buffers |
| Leaks | Marketing damage | Access control, watermarked builds, security training |
| Engine upgrades mid-project | Instability | Lock the engine version per milestone and merge upstream in planned windows |
| Legal (brand parody, music) | Launch blockers | Early legal review, and a licensing team from pre-production |
| Ratings and regional law | Market loss | Content regionalization flags built into systems |

---

## 15. Definition of "hyper-realistic": acceptance tests

A feature is only "done" when it passes these tests:
1. **Photo test:** a screenshot at a random place and time is mistaken for a photo by ≥50% of a blind
   test panel.
2. **Crowd test:** in a 10-minute observation from a café, observers cannot spot a clone, a pop-in or
   a nonsense behavior.
3. **Crash test:** a 100 km/h collision produces believable deformation, glass, injury reactions,
   witness behavior and a police response.
4. **Stranger test:** 10 random NPCs followed for one in-game day each show a coherent routine.
5. **Rain test:** a storm visibly changes lighting, surfaces, driving, crowds and audio in under
   2 minutes of in-game time.

---

## 16. Next concrete steps (the first 30 days)

1. Install **Unreal Engine 5** (latest stable) and Visual Studio / Rider, and set up Git LFS or Perforce
   for this repo.
2. Create the UE5 C++ project `Solmar` in this repository, with folders `Source/`, `Content/`,
   `Config/` and `Docs/`.
3. Load the **Game Animation Sample** (motion matching) and the **City Sample** to study Mass
   crowds and traffic.
4. Build a **500 m × 500 m** graybox with PCG: one boulevard, one beach, one alley.
5. Get a car driving with a chase camera and tuned wet/dry grip.
6. Write the **Game Design Document v0.1** (pillars, core loop, setting bible) in `Docs/`.
7. Record a 60-second capture of the graybox. This is milestone "M0 – Hello Solmar".
