# touch grass

An endless anime-style grassland in the browser. Walk through it, crouch into it, watch gusts roll across the hills, listen to the wind, breathe.

Static website: Vite + TypeScript + three.js (WebGL2, custom GLSL). No backend, no assets to download; the sky, terrain, grass and the whole soundscape are procedural.

## The realm

The field is no longer only a field. Around the spawn lies one hand-planned world, inspired by the look of floating-castle fantasy anime:

- **Lumenhall**, the starting city: a ring wall with round towers and gatehouses, ring and radial cobbled streets, ~150 procedurally built houses (stone, plaster and half-timber, slate, teal and terracotta roofs, shutters, flower boxes, chimneys), a market around the plaza, a bell tower that tolls every couple of minutes, and the **gate of light** at its heart, with turning rune rings and a column of light at dusk.
- **Windmere** (windmills and a sheep pasture) and **Hearthbrook** (a horse pasture), farming villages on the roads.
- **Watcher’s Rise**: a broken colonnade and a cracked watchtower on a raised hill.
- **Shardfield**: a field of giant glowing crystals.
- **Last Watch**: a tower where the mountain road gives out under the **Skyreach Range**, the ring of snow peaks that closes the world.
- **The floating castle**: twenty-one stacked tiers, each a little landscape, held by pillars, shedding waterfalls into the void, lit window by window at night. Grassy islands drift closer in.
- Roads (King’s Road, the mountain road, village lanes) with lamps near the city and rune milestones further out; forests of fir, oak and birch; herds of sheep, horses, deer and boars that graze, wander, look up at you and bolt if you rush them.
- **Blossom Hollow** (a shrine among cherry trees, petals drifting), **the Pillar of Ascent** (a labyrinth tower over 550 m tall with a great door between braziers), **the Old Ring** (standing stones around a rune altar).
- Farmsteads along the country roads (house, barn, hay, carts, hens, a fenced yard), fields of wheat, greens and lavender in neat rows around them and the villages, scarecrows, signposts at every road end.
- Chimney smoke, campfires with sparks and a flickering glow, butterflies by day, cats in the city streets, hens in the yards.
- A compass strip with the landmarks and their distance, and a banner when you enter a new place.
- **Flight** (V): a launch throws you into the air; then you fly where you look, with a glide, banking turns, a wider view and louder wind as you speed up. Land with V again (you glide on until there is solid ground). G in the air starts the autopilot, a sightseeing tour that circles the city, villages, tower, islands and the floating castle while following the land; any input takes back control. Code: `src/player/Flight.ts`.
- **Fast travel** (Q, or the pin button): a list of every place with its distance; pick one (or press its number) and you open your eyes there.

- **Grown trees**: every tree in the realm is a parametric tree in the same technique as the great tree (tapered, kinked bark tubes with root flare, a crown of camera-facing leaf cards from a hand-painted atlas), grown by rules taken from the real species: pedunculate oak (short massive trunk, sinuous scaffold limbs, broad dome), Norway spruce (single leader, whorls of drooping branches turning up at the tips, needle fronds), silver birch (white bark with lenticels and a black fissured foot, ascending limbs, hanging twigs), Somei-yoshino cherry (low split into wide limbs, an umbrella of five-petalled blossom, petals carpeting the ground) and hazel-like shrubs. Several variants per species, full detail near the walker and a lighter version further out, dissolving into each other.
- **Sun shadows**: one shadow map follows the walker; houses, walls, trees, animals and rocks cast onto the grass, roads, walls and leaves (off on the low tier).
- **Floating islands**: torn-out pieces of land with a domed meadow of real grass blades, a deep body of bedded rock narrowing into stalactites, roots hanging from the lip, trees and ruins on top.
- **Houses**: thick tiled roofs with ridge caps, barge boards and fascias, recessed windows with frames, glazing bars and stone lintels, dressed corner stones, door surrounds and steps; rain streaks, worn plaster and lichen on the tiles.

- **Mountains up close**: bedded, jointed rock with lichen; dry alpine turf with sun-bleached blades; snow with wind ripples, blue shade and glints; no grass on rock or under snow.
- **Walking with weight**: climbing slows past ~20°, crawls near 40°, stops past 45° where you slide back down; step off a drop and you fall.

Everything is still procedural and asset-free. Code: `src/world/realm/` (`World.ts` the layout, `Realm.ts` the baked plan map, `city.ts`/`sites.ts` the generators, `kit.ts` the building kit, `Structures.ts` the shared shader, `Forest.ts`, `Island.ts`, `Fauna.ts`, `Skyward.ts`), `src/world/flora/Arbor.ts` (tree growth, leaf atlas, bark and leaf shaders), `src/core/Shadows.ts`, `src/ui/Zones.ts`, `src/audio/Bells.ts`. The plan map (height change, paved, solid, paving kind) is sampled by the terrain, grass, flowers, walking and animals exactly like the pond feature map.

## Finding things: the lens and the field journal

The realm is full of things to find, and a camera to keep them with.

- **Rare flowers** (`src/world/life/RareFlora.ts`, `floraKit.ts`): twelve species, each a real little mesh built for close-ups (bent, cupped, twisted petals, lathed bells and trumpets, stamens) with its own shader patterns: felted edelweiss, chequered fritillary bells, freckled martagon turbans, waxy ghost pipes, silk pasque cups, translucent blue poppies. They grow where the real ones would: fritillaries on the pool shores, pasque flowers among the standing stones, the blue poppy on Watcher’s Rise, lady’s slippers and martagon lilies at the wood edges, ghost pipe in the darkest wood, gentians and edelweiss up the mountain road, the skybell by the summit cairn. Three the realm grew on its own: the **Moonpetal** under the cherries (closed by day, opens and glows at dusk), the glassy **Starbloom** among the crystals, the four-leaf clover near where you wake. Until collected, golden motes rise from them and the grass bows away around them.
- **Creatures** (`src/world/realm/Fauna.ts`, `src/world/life/Critters.ts`): besides the herds, brown hares that bound across the fields, red foxes on the field margins (golden hour, dusk, dawn), hedgehogs in every farmyard after dark, alpine ibex under the range, grey herons fishing at the bigger pools, a tawny owl on the broken watchtower at night, the **Pale Hart** in the deepest eastern wood on misty mornings, red kites circling high on the thermals, emperor dragonflies over the pools, frogs on the shores (they croak at dusk), swallows and four kinds of butterfly. Many make themselves heard when you come near (`src/audio/Sfx.ts`).
- **Hidden places** (`src/world/realm/hidden.ts`): a fairy ring of glowing mushrooms in a forest glade, the Moonwell in a southern hollow, a lone swing on a knoll facing the city, a sword in a stone on a bare hill, a hermit’s hut with its smoke rising out of the northern woods, the summit cairn with prayer flags, and a shrine on the largest floating island that only flying reaches. None is on the compass; once found, each joins the travel list.
- **Discovery**: come near something new and a card names it (“You found a new rare flower: Edelweiss”).
- **Collecting** (`src/discovery/Discovery.ts`, `src/ui/LensUI.ts`): raise the lens (Z or right mouse). Looking down, it finds a flower and you kneel to it; looking out, it stays a telephoto (scroll to zoom, 4–60°). A reticle sits in the middle: frame the subject in it at a good distance, big enough in the frame, hold still, and the focus ring fills; when it locks, the shutter fires and the photo goes into the journal. Brackets snap around the subject and say what is wrong (too far, too close, too small, something in the way, not its hour). A depth probe at the centre of the frame stops grass or a wall in front from counting; the focus pulls onto the subject and the lens parts the grass along the line of sight. Click, Space or Enter shoots any time (free shots go to the album).
- **The field journal** (J; `src/ui/JournalUI.ts`, `src/discovery/Journal.ts`): flowers, creatures and places, each with the photo that collected it, the time of day, place, focal length, distance and date; unknown entries show the rumour that leads to them. An album keeps every photo (save or delete them; pick any photo of a subject as its journal picture). Progress is kept in localStorage, photos in IndexedDB.

## The game: quests, sigils and a door that never opened

On top of the walking and the lens there is now a game to play (`src/game/`, `src/world/game/`, `src/world/life/Mythic.ts`).

- **A story.** A glowing **Waystone** stands a few steps from where you wake, and a small companion light leans toward it. Read it (E) and the main quest opens: five **sigils** keep the door of the Pillar of Ascent shut. Each sleeps where its riddle says: among the ruins of Watcher’s Rise, between the crystals of Shardfield, inside the Old Ring (it answers only on misty mornings), under the cherries of Blossom Hollow (only after sunset), and on the floating island of the Sky Shrine, which only flying reaches. Wake all five, the five sockets on the great door light up, the slab sinks into its threshold, and stepping through lifts you to the crown of the tower, where **Aurelion, the Sky Serpent** has been asleep. It circles the Pillar from then on, and you fly half again as fast.
- **Quests** (J, first tab): four story chapters and sixteen side quests (gather the lights, befriend animals, the farm, pond and night albums, the legends, all twelve flowers, the nine great places, the seven hidden places, the hermit’s diary, the chests, the wind trial, the blade). Click one to track it: the tracker top-left shows the current step, the compass gets a gold mark with the distance, and the companion light floats toward it.
- **Experience and ranks.** Everything earns experience (finding, photographing, lights, sigils, pages, chests, quests): ten ranks from Wanderer to Legend of the Fields, with a fanfare at each. It is derived from the journal, so what you had already collected counts.
- **E: touch things.** Read stones, take diary pages off their posts, open chests, stroke tame animals (walk slowly and sheep, cows, horses, hens, cats and the village sheepdog let you come close; the dog trots over and follows you), sit on the Lone Swing, make a wish at the Moonwell (it marks a sleeping sigil, a chest or a light on your compass and map), try the blade in the stone (it yields only to someone who has seen all nine great places; carrying it, lights drift to you from further away).
- **Lights to gather.** ~130 drifting lights along the roads, around every landmark, across the fields and in the sky (over the islands, in a stair up the Pillar, around the castle). Walk or fly through them; each one in a row rings a note higher.
- **Chests and the hermit’s diary.** Twelve chests under lanterns in out-of-the-way corners, each with a relic; eight pages of a diary pinned to posts, which tell what the door is for. Both are kept in the journal’s Lore tab with the sigils’ verses.
- **The wind trial.** Twelve rings hang in the air from the starting meadow around Windmere’s island to the Old Ring and back. Fly through the first to start the clock; gold under 50 s.
- **The map** (Tab): an inked parchment drawn from the real terrain, woods, pools and roads. It lies under cloud until you walk or fly over it; places, sigils and opened chests appear as you find them.
- **Space** jumps.

### New creatures (37 in the journal now)

Highland cattle by the farmsteads, a sheepdog in each village and at the hermit’s hut, red squirrels where the trees stand close, badgers at the wood edges at dusk, a wolf pack in the northern woods after sunset (you hear the howl from far off), brown bears, ravens on the blade’s stone and the Old Ring’s altar, golden eagles over the summit, mute swans and mallards on the pools, pipistrelles tumbling around the towers at dusk, **lantern jellies** drifting over the crystals and the Moonwell at night, **kodama** in the old glades in thin light (they tilt their heads with a rattle and vanish if you step too close), the nine-tailed **Kitsune** of Blossom Hollow after sunset, and the **Cloud Whale**, a village-sized whale with a meadow on its back that crosses the sky whenever the sun is low and sings.

### Anatomy of the animals

Every animal is modelled as an animal, not stacked out of boxes (`src/world/life/creature.ts` the kit, `species.ts` the 21 land species and the swan, mallard and golden eagle):

- **Skins over spines**: bodies, necks, legs, tails, ears and horns are smooth skins lofted along a spline through a few elliptical sections, with a paler underside (belly, throat, inner ear) blended round the section.
- **Jointed legs**: hoofed legs have shoulder, forearm, knee, cannon, fetlock and a hoof (cloven where it should be); behind, a haunch, stifle and a hock set back. Pawed legs end in a paw with four toes, and claws on wolf, bear and badger. The lower leg folds at the knee while the foot travels forward.
- **Faces**: glossy eyes with pupil and catchlight that blink, wet noses, lower jaws that chew while grazing (the sheepdog pants when it is pleased), ears that flick and lie back at a run, whiskers on cat and hare.
- **Coats**: fleece curls on the sheep, mane and forelock on the horse, the long shag and fringe of the highland cattle, a bristle crest on the boar, a ruff on the wolf, a throat mane on the hart, ridged horns on the ibex, branching antlers, the badger's eye stripes, the kitsune's nine tails and shrine bib. Some horses are piebald, some cats tabby, some deer keep their spots.
- **Fur shader**: clumps and hair grain that stay on the animal as it moves, soft wrapped light, a halo where the sun skims the coat, darker bellies and feet in the grass; wool, feathers (overlapping rows), horn (growth rings), hoof, beak, skin and eye each have their own surface.
- **Alive**: necks bend along their length to reach the grass, heads turn to follow you while they watch, tails swing in a wave from the root (the dog wags when stroked), flanks breathe, hens beat their wings when they run.
- **Two models each**: the detailed one within about 40 m (further when you zoom the lens), a lighter stand-in beyond, nothing at all once too small to see.

In development `/?zoo` lines one of each up beside the waking place, raised clear of the grass (`?zoo=walk`, `run`, `graze`, `look`, `happy` to pose them).

Code: `src/game/Game.ts` (save, experience, quest rules), `lore.ts` (riddles, diary, relics, ranks), `Adventure.ts` (glue: what E does, the trial, the fog of war), `src/world/game/Wisps.ts` and `Mysteries.ts` (the lights and everything you can touch), `src/world/life/Mythic.ts` (whale, serpent, kodama, jellies, bats, eagles, waterfowl), new species in `src/world/realm/Fauna.ts`, `src/ui/GameHUD.ts`, `MapUI.ts`, `QuestLog.ts`. The game state lives in `localStorage` under `touchgrass.game.v1`.

Flying got its feel too (`src/player/FlightFX.ts`): speed lines streaming past, radial blur and colour fringes at the edges as you speed up (`FX.speed` in `src/post/Post.ts`), a FOV kick and a rush of air when you put on speed, grass and petals thrown up at take-off and landing, and the grass flattening in rings under you when you skim low.

## Run

```bash
npm install
npm run dev        # http://localhost:5173
npm run build      # typecheck + static build into dist/
npm run preview    # serve dist/
```

Force a detail level with `?q=low|medium|high`. Default is auto: picked from the GPU, then stepped down if the frame rate stays under 40 fps.

## Deploy

Live at **https://touchgrass.davideghiotto.it**, served from the homelab mini PC:

```bash
deploy/deploy.sh   # build, rsync dist/ to homelab:~/touchgrass/site, (re)start nginx, check local + public
```

- `deploy/compose.yml`: one `nginx:1.30.6-alpine` container (`touchgrass-web`), read-only, bound to `127.0.0.1:8796`, on Docker's default `bridge` (the box has no free address pools for a per-stack network). The site is a read-only bind mount of `~/touchgrass/site`, so a release is just new files plus an nginx reload; no image build.
- `deploy/nginx.conf`: gzip, `immutable` caching for Vite's hashed `/assets/`, `no-cache` for HTML, security headers, `/healthz`.
- Published by the homelab's cloudflared tunnel: ingress `touchgrass.davideghiotto.it -> http://localhost:8796` and a proxied CNAME to the tunnel. Cloudflare terminates TLS. Not a Dokploy app, not behind Access.
- `rsync --delay-updates` swaps the new build in at the end, so nobody loads half a release.

Elsewhere: `dist/` is plain static files with relative paths, so any static host works too (Netlify, Vercel, Cloudflare Pages, GitHub Pages).

## Trailer

`/?trailer` plays a ~2:40 scripted, Steam-style trailer in the engine itself: eyes opening in the grass, macro on flowers, the field, swallows against a sunset, a gust, fireflies at night, dawn by a pond, a glowing flower that pulls you in, a fairy pool whose rune stones pulse to an ancient tune, a vortex, a shooting star and the title. Picture and score run off the audio clock, so cuts land on the music.

| Param | Effect |
| --- | --- |
| `record` | records canvas + mix with `MediaRecorder` and downloads an `.mp4`/`.webm` at the end |
| `size=1920x1080` | fixed render size (use with `record`) |
| `t=80` | start from a given second |
| `hold` | freeze the clock at `t` (framing checks) |

Space pauses, F toggles fullscreen. Code: `src/trailer/` (`timeline.ts` marks, `Director.ts` camera/light/props, `Score.ts` music and sound design, `props.ts` fireflies, hero blade, glowing flower, rune stones, meteor, title). Post-processing hooks (eyelids, blur, flashes, vortex, title, manual focus) are the `FX` object in `src/post/Post.ts`.

## Controls

| Key | Action |
| --- | --- |
| WASD / arrows | walk |
| mouse | look (click the field to capture the cursor, Esc to free it) |
| Shift | hurry; keep holding to break into a long stride |
| C (toggle) / Ctrl (hold) | sink into the grass |
| Space | jump |
| E | touch: read, take, open, stroke, sit, wish |
| Tab | map |
| Z / hold right mouse | lens: look down and it finds a flower; scroll to zoom; frame something and hold still to collect it |
| click / Space / Enter (lens up) | take a photo |
| J | field journal: quests, flowers, creatures, places, lore, album |
| B | breathing guide (4 in, 2 hold, 6 out) |
| G | wander hands-free |
| T | next time of day |
| V | fly: take off (thrown ~55 m up), V again to land |
| in flight | W/S along your gaze (look down to dive, up to climb), A/D sideways, Space up, C/Ctrl down, Shift faster, G autopilot, Z lens (click to shoot) |
| Q | travel: pick a place and go there |
| H | settings panel |
| N | music on/off |
| M | mute |
| F | fullscreen |

Phones: left thumb walks (floating joystick), right thumb looks; with the lens up a shutter button appears on the right.

## How it works

- **Noise** (`src/core/noise.ts`): one tileable 4-channel half-float texture drives terrain, wind, clouds and clumping. The CPU keeps an identical copy, so camera height, spawn search and audio sample exactly what the GPU draws.
- **Grass** (`src/world/Grass.ts`): two instanced layers (dense near patch, sparse wide far patch). Each patch wraps around the camera in the vertex shader, so blades stay fixed in the world with no chunk streaming and a single draw call per layer. Blades bend as constant-length circular arcs driven by rest lean, sway, travelling gust fronts, flutter and the trail map. The fragment shader does the anime look: root-to-tip gradient, two-band soft light, backlit tips, a bright sheen where gusts push blades over, cloud shadows and haze.
- **Trail** (`src/world/TrailMap.ts`): a player-centred ping-pong render target of push vectors. The body stamps into it; it decays with a ~6 s half-life so paths heal.
- **Terrain** (`src/world/Terrain.ts`): a camera-following grid, warped so vertices crowd near the player, shaded to read as a dense field in the distance (including visible gust waves).
- **Sky & clouds** (`src/world/Sky.ts`, `Clouds.ts`, `CloudNoise.ts`): gradient dome, sun, stars and distant mountain silhouettes, composited with three cloud levels rendered at reduced resolution with temporal reprojection:
  - *low*: raymarched volumetric cumulus/stratocumulus (1.3–3.7 km). A tileable 3D Perlin-Worley texture (built on the GPU at startup) shapes them; a two-layer weather map decides where clouds form and how tall they tower, and drifts at two rates so the pattern keeps reshuffling. The noise also scrolls vertically through the layer, so clouds grow, merge and dissolve instead of just sliding. Lighting: sun light march, dual-lobe Henyey-Greenstein (silver linings), powder effect, cheap multiple scattering, aerial perspective into the horizon haze, and an anime ↔ realistic ramp.
  - *mid*: altocumulus patches at 5.6 km, *high*: cirrus streaks at 9.5 km, each on its own sheared wind.
  - Ground cloud shadows and water reflections sample the same weather + noise fields, so they match the sky. Panel: cover, towering, speed (time-lapse), evolution, mid/high amounts, style.
- **Fairy pools** (`src/world/Features.ts`, `Water.ts`, `Rocks.ts`, `Aquatic.ts`): per 200 m world cell, a pond settles in the lowest spot, sometimes with a few smaller ponds in nearby hollows (only where the rim holds the water). Still water only, no streams. Everything is baked into a 1024² half-float map around the player (height carve, shore mask, water level, water mask) that the terrain, grass, flowers, water shader, walking (you can wade, not swim) and audio all read. Water is turquoise-to-teal by real depth, see-through in the shallows, nearly mirror-still with three slow ripple layers that roughen with the wind, reflects sky and clouds, sparkles and foams at the shores. Shores carry mossy granite boulders, reeds and cattails, lily pads with water lilies, iris-like flowers, and fireflies over the water at dusk.
- **Birds** (`src/world/Birds.ts`): three boids flocks of 3D barn swallows (lofted body, cambered two-joint wings with a lagging, folding hand, forked tail, countershaded navy/cream/rust) orbiting the player at varying distance (sometimes straight overhead), flapping in bursts and banking into turns. They roost when night falls; chirps pan toward a passing flock.
- **Macro lens** (`src/post/Post.ts`, `Flowers.ts`): a CPU replica of the flower placement finds the nearest bloom ahead, the view eases onto it, a ring stamp in the trail map parts the grass around it, and a depth-of-field pass with GPU autofocus (1×1 ping-pong target, no readback) blurs everything else into bokeh.
- **Time of day** (`src/world/TimeOfDay.ts`): Noon, Golden hour, Dusk, Misty dawn; every colour, the sun, fog and night factor cross-fade.
- **Audio** (`src/audio/AudioEngine.ts`): Web Audio only. Wind is shaped brown/pink noise whose level follows the gust at your position; the hiss of grass is panned left and right from gusts sampled either side of you, so you hear a wave travel past. Moving through grass spawns filtered noise grains, footsteps follow the head-bob stride, birds by day, crickets at dusk, water drops by the pools, and a soft pad swells with the breathing guide.
- **Music** (`src/audio/Music.ts`): an endless generative ambient score. Felt piano (stretched partials, hammer noise, darkening decay), detuned pads, a low drone and distant FM bells go through a long generated reverb with tape wobble. Each time of day has its own key, tempo, scale and chord progression; the melody is a slow random walk around a recurring motif. The breathing pad retunes to the current chord.
- **Quality** (`src/core/quality.ts`): blade counts, LOD, pixel ratio, post-processing (bloom, grade, vignette) per tier.

## Tuning

Everything in the settings panel lives in `src/core/params.ts`. Grass types (Meadow, Susuki, Lawn, Wild, Windswept) are in `GRASS_TYPES`; sky presets in `TIME_PRESETS`.
