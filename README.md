<p align="center"><img src="static/icons/logo.svg" alt="Dream – a dreaming, glowing mandala" width="128" height="128"></p>

<h1 align="center">Dream</h1>

<p align="center"><b>Live AI visuals for VJs, artists and installations</b><br>
<i>English · Deutsch: <a href="README.de.md">README.de.md</a></i></p>

<p align="center"><a href="#at-a-glance">Quick start</a> · <a href="#starting">Start</a> · <a href="#using-dream">Use</a> · <a href="#phone-remote">Phones</a> · <a href="#dreamy-eyes--a-phone-as-dreaming-eyes-installation">Dreamy Eyes</a> · <a href="#movement">Movement</a> · <a href="#cloud-gpu">Cloud GPU</a> · <a href="#when-something-gets-stuck">Help</a> · <a href="#licences">Licences</a></p>

Dream is an endless, ever-changing stream of pictures: a fast image model (SD-Turbo or SDXL-Turbo) turns each picture
into the next. It runs on a Mac with Apple Silicon, in the browser, only on `127.0.0.1` (the phone remote and a
second output device join over the home Wi-Fi when you allow it). It computes either **locally** on the Mac's GPU or
on a **cloud GPU** you rent by the hour (Scaleway in Paris or RunPod in Europe). It reacts to music, to a camera, to
movement (hands, fire, LEDs), to MIDI controllers and body sensors, and can be driven by an autopilot.

The whole interface is available in English and German (switch **DE | EN** at the top right).

<p align="center"><img src="docs/images/stage-en.webp" alt="A dream on the stage – SD-Turbo turns each picture into the next" width="420"></p>

## Contents

**Get started**

- [At a glance](#at-a-glance)
- [Starting](#starting)
  - [Updating](#updating)
- [Folder and own settings](#folder-and-own-settings)

**Play**

- [Using Dream](#using-dream)
  - [Autopilot](#autopilot)
  - [Pictures and clips on request](#pictures-and-clips-on-request)
- [Playlists and autostart](#playlists-and-autostart)
- [Output on a projector or second monitor (16:9)](#output-on-a-projector-or-second-monitor-169)
- [As a source in Resolume (Syphon)](#as-a-source-in-resolume-syphon)

**Phones and tablets**

- [Phone remote](#phone-remote)
  - [Dream Remote (guests) and Dream Control (you)](#dream-remote-guests-and-dream-control-you)
  - [Dream Control over https and as an app](#dream-control-over-https-and-as-an-app)
  - [On a tablet (Android)](#on-a-tablet-android)
  - [Live camera and motion of the Control device](#live-camera-and-motion-of-the-control-device)
  - [If the phone does not connect](#if-the-phone-does-not-connect)
- [Dreamy Eyes – a phone as dreaming eyes (installation)](#dreamy-eyes--a-phone-as-dreaming-eyes-installation)
- [Dream windows – old phones and tablets as windows to the dream](#dream-windows--old-phones-and-tablets-as-windows-to-the-dream)

**Movement and controllers**

- [Movement](#movement)
  - [Dreaming light trails (input “Light trails”)](#dreaming-light-trails-input-light-trails)
  - [Keep outlines (ControlNet)](#keep-outlines-controlnet)
  - [Pose shapes the figure (ControlNet)](#pose-shapes-the-figure-controlnet)
- [MIDI controller](#midi-controller)
- [Sensor input (movement in the dark: phone on the arm, later a wristband)](#sensor-input-movement-in-the-dark-phone-on-the-arm-later-a-wristband)

**Cloud GPU**

- [Cloud GPU](#cloud-gpu)
  - [Scaleway: set up once](#scaleway-set-up-once)
  - [RunPod: set up once](#runpod-set-up-once)

**Help and more**

- [When something gets stuck](#when-something-gets-stuck)
- [Disk space and removal](#disk-space-and-removal)
- [Tests](#tests)
- [Translations](#translations)
- [Licences](#licences)

---

## At a glance

| What | Command / address |
|---|---|
| Start (this Mac only) | `./dream.sh` |
| Start with the phone remote | `./dream.sh --lan` |
| Panel and stage | http://127.0.0.1:7860 (open it yourself, or `./dream.sh --open`) |
| Picture output for a projector (does not compute) | http://127.0.0.1:7860/output, button “⧉ Open output” or `dream.sh --beamer` |
| Stage only, without controls | http://127.0.0.1:7860/?stage=1 (or `dream.sh --stage`), then **F** |
| Connect a phone | on the stage press **Q** → scan the QR code (see below) |
| All options | `./dream.sh --help` |
| Stop | Ctrl+C in the terminal |
| Check a cloud GPU | `./dream-cloud status` |

<sub>[↑ Contents](#contents)</sub>

## Starting

**What you need:**

| | Needed | What for |
|---|---|---|
| Mac with Apple Silicon (M1 or newer), 16 GB memory or more | yes | computing locally (SD-Turbo; SDXL-Turbo wants more memory or the cloud) |
| [uv](https://docs.astral.sh/uv/) (`brew install uv`) | yes | `dream.sh` installs the Python packages by itself |
| about 3 GB free disk (SDXL-Turbo: about 7 GB more) | yes | the models, downloaded on first use |
| Chrome (or another current browser) | yes | panel and stage; Chrome for `--beamer` and the installable apps |
| [Ollama](https://ollama.com) with `llama3.2:3b` | optional | prompt ideas and generated playlists |
| `ffmpeg` (`brew install ffmpeg`) | optional | saving clips as video |
| [Scaleway CLI](https://www.scaleway.com/en/cli/) or a RunPod account | optional | a cloud GPU instead of the Mac's |

```bash
./dream.sh
```

Dream opens **no** browser window by itself; after about 15 seconds the terminal says “Dream is ready” with the
addresses. Then open http://127.0.0.1:7860 in the browser (or use `./dream.sh --open`). **Dream computes only while
the panel or the stage is open in a browser** – the output window alone does not compute. Stop with Ctrl+C. The first
local picture downloads SD-Turbo (about 2.6 GB, once) – the stage says so with a badge, the terminal shows the progress;
the first picture after each start takes a few seconds.

If Dream runs in the background (without a terminal), stop it with `pkill -f "uvicorn server:app"`.

<sub>[↑ Contents](#contents)</sub>

### Updating

After new features (or when something described here is missing):

```bash
cd <Dream folder> && git switch main && git pull
```

Then stop Dream with Ctrl+C and start it again – a running Dream keeps the old version otherwise. New Python packages
are installed by `dream.sh` on start.

To try a ticket before it is accepted: `git switch <branch>` (named in the ticket), back with `git switch main`.

## Folder and own settings

All commands here run in the **Dream folder** (where this repository lies): `cd <Dream folder>`, then `./dream.sh`.
Movement detection is built into Dream; the separate program flowtrack is not needed any more.

**Settings of this Mac** (paths, ports, camera) belong in `~/.config/dream/dream.env` – not in the repository.
`dream.sh` reads the file on every start, one line per setting:

```bash
DREAM_PORT=7860
```

**Other folders** (a second installation on the same Mac, a test run): three settings move Dream's own folders – in
`dream.env` or in the environment; without them everything stays where it is:

| Setting | Default | Holds |
|---|---|---|
| `DREAM_STATE_DIR` | `~/.local/state/dream` | settings (`state.json`), the remote keys, the certificates, uploads, style pictures |
| `DREAM_CONFIG_DIR` | `~/.config/dream` | `dream.env` itself, own playlists, MIDI, sensor and movement mappings |
| `DREAM_SAVE_DIR` | `~/Pictures/Dream` | pictures and clips kept with 💾 |

`dream.sh`, `dream-cloud` and `install-autostart.sh` use the same folders; the autostart also takes `DREAM_PORT` from
`dream.env`.

<sub>[↑ Contents](#contents)</sub>

---

## Using Dream

<p align="center"><img src="docs/images/panel-en.webp" alt="The panel on the Mac: the controls on the left, the stage and its load on the right" width="900"></p>

The panel is a wide column on the left, the preview sits next to it on the right (key H hides the panel, then the
preview fills the screen). Drag the edge to change the width; it is remembered. The areas (Input & prompt · Dream ·
Scenes & playlists · Movement · Direct interaction · Music · Output · Computing) are open cards in columns side by
side. The layout fits the screen so that everything is visible without scrolling: the cards are spread over the
columns as evenly as possible in their order, the panel's type gets a little smaller if needed (down to 12 px), and
if that is not enough, the panel gets a little wider and the preview smaller (only on very small screens does the
panel scroll).

**Fixed layout:** the cards are placed only when the shape of the panel changes – at start, when the window size
changes, when you drag the edge and when the picture format changes. Otherwise every card stays in its column:
folding a card, new texts, the diagnostics or key H move nothing to another column (only the cards below it in the
same column move up), and the type no longer changes by itself. If a card gets longer later, the card area scrolls
instead of rearranging.
- **🔓/🔒 Lock the layout** (top right in the panel, remembered per device) – for the show: a folded card keeps its
  place as a dashed outline, so nothing moves up in its column either, and window size or picture format only adjust
  the preview, the cards stay. Only dragging the edge places them anew while locked. Unlocking catches up on what
  changed meanwhile.
- **DE | EN – language:** top right in the panel and on the phone. The whole interface (stage, phone, output, the
  messages of Dream and of the cloud GPU) is available in English and German; remembered per device, the first time
  by the browser's language. Switching reloads the page (briefly, the settings stay). Terminal messages
  (`dream.sh`, `dream-cloud`, autostart) follow the system language or `DREAM_LANG=de`.

**Below the preview** there are always **Pause, New, Fullscreen, Save**, the coloured **status chips** (pause, cloud
GPU running, movement without camera, playlist, music, Syphon) and the **load**, updated every second: AI pictures per
second, GPU time per picture, how much of the time the AI is busy, display fps, picture size and model, CPU of Dream
and of the whole Mac, memory of Dream, GPU memory and total memory (and movement values per second while movement is
on). Red means: at the limit. If there is room below the preview (mostly with 16:9), cards like Computing and Output
move there. The values are also available as JSON at http://127.0.0.1:7860/stats.

**📏 Measure** (below the load, #180) runs for 60 s with fixed settings (a fixed prompt and seed, 512 px, 2 steps, no
effects, outlines, pose or style; afterwards everything is as before) and shows where the time of a picture goes: waiting,
decoding the incoming picture, waiting for the GPU, prompt encoding, UNet, decoder, encoding, the flow field (#205: it
is estimated beside the next picture, so its time is not part of the picture's) and sending – mean, median
and the slowest 5 % in milliseconds – plus how smoothly every open page drew meanwhile (the stage, Dream Remote, Dreamy
Eyes: frames per second, frame time, share of slow frames; for the stage also what draws the picture, #204: the graphics
card with WebGL 2, or Canvas 2D without it, and #205: for how many of the AI's pictures a flow field came and what one
cost – that line also tells it for the cloud GPU, whose own parts the table does not show). The table also goes to the terminal and into
`~/.local/state/dream/measure/` as JSON, to compare a change before and after. While measuring, the parts are timed
together with the GPU, which makes the run itself a little slower than usual. Only Dream Control and the Mac can start it.

- **Compute on:** “Local (Mac)” or “Cloud GPU”. Switching works at any time, without a restart.
- **Model:** SD-Turbo (fast) or SDXL-Turbo (nicer; very slow locally, good in the cloud). You can switch in the middle
  of a show: the new model loads in the background (SD-Turbo seconds, SDXL-Turbo locally about 20–60 s, much longer
  the very first time with the download), the old one dreams on meanwhile, a chip says “⏳ … is loading”. The first
  picture of the new model grows out of the last one of the old, stage and projector blend over softly in 2.5 s.
  Then Dream frees the old model. If memory is not enough for both at once, Dream frees the old one first and holds
  the last picture meanwhile (the chip says so). If the new model does not load (not downloaded, no network), the old
  one runs on and the chip reports it. “Keep outlines” and “Pose shapes the figure” dream on meanwhile too; only
  switching one of them on for the first time while a model loads waits for that load.
- **Input & prompt** (one card, two levels): at the top **“Input – what does the AI paint from?”** as tabs: **Dream
  only** (no input picture, the AI dreams on from its last picture), **Camera**, **Picture**, **Video**, **Light trails**
  (from the movement detection). Each tab shows what belongs to it: in Picture or Video you choose your own file or
  let the AI make a picture or a clip; the gallery is there too. “✕” takes the picture or video out again, then it
  dreams on from the current picture. **Camera:** which of the Mac's cameras Dream takes (e.g. a 60 fps webcam or a
  phone via Continuity, Iriun or DroidCam), also selectable on the phone. Below it **“Prompt – what does the AI paint
  from it?”**: the one text field for the dream (at transformation 0: “AI off”, the prompt rests).
- **Soft switches (#211):** a new input and a new prompt blend in over about 3 s instead of jumping, with nothing to
  set. **Input** (by hand, autopilot, scene, MIDI or Dream Control; also another picture or video): the last picture
  the AI got from the old input lies over the new one and leaves within 3 s, counted from the new source's first
  picture. **Prompt** (typing, voice, Dream Control): the AI gets the old and the new prompt mixed, shifting to the
  new one; while you type, the old one stays until you pause. Playlist scenes keep their own fade time, the
  autopilot's jump back into the dream on a drop stays a hard cut. A switch during a running blend goes on from where
  it stands: for the input exactly, for the prompt the stronger of the two keeps its share and the weaker one makes
  room for the new prompt (the AI blends two prompts, not three). It costs the AI no time: the pictures are mixed in
  the browser, the prompts as for a scene change.
- **The AI gets:** right below the prompt it says what the AI really gets: your text, and after it every addition as
  a coloured chip – purple **Vary the prompt gently** (the two variants and how far it is from one to the other),
  green **Content reacts to energy** (calm ⇄ wild, how wild right now), blue **Autopilot: words for the music**, grey
  a running **prompt change** (a scene, or a change by hand). A ✕ in the chip switches that addition off at once (the same as the checkbox at its
  place; for the music words: “Add words for the music to the prompt” in the Autopilot card). When it says “exactly
  the prompt above, nothing added”, nobody mixes anything in. Style model and reference picture never change the
  prompt; “rephrase in English” only acts on speaking – its result already stands in the text field.
- **Now running:** below the preview it always says what the AI paints from and with – e.g. “Input: Picture from the
  gallery “lighthouse …” · AI paints: “raining cats and dogs” · transformation 0.40”, with “(Autopilot)” when the
  autopilot chose the input – next to a small picture of what goes into the AI. The same line is on the phone below
  the connection status.
- **Speak:** hold the button or key V. Whisper transcribes locally, a small local model (Ollama, `llama3.2:3b`)
  turns it into an English image prompt. That always stays on the Mac.
- **Music:** microphone or music file. The bass pulls the zoom, the mids shift the colours, the highs scatter sparks
  and turn the picture. Beats give short impulses – which ones depends on the **pattern**: Pulse (flash and stronger
  transformation), Jolt (spin jolt), Jump (new seed every second beat), Flow (soft, lots of colour). The **Pattern**
  selection in the Music card (also on the phone, or as MIDI button “next pattern”) sets it: **Automatic** (with
  “change pattern” every 16–32 bars and another one on drops; playlist scenes and the autopilot may set it too) or a
  fixed pattern that then stays – nothing else changes it. Quiet passages react calmly and softly, loud ones wildly
  and fast. After a **break** (the drums drop out) the **drop** turns the dream over: new seed, flash, new pattern and
  – with “Drop → next scene” – the playlist's next prompt. Below the level meter: pattern, bar, approximate tempo and
  loudness. With the microphone Dream switches off the browser's speech filters (noise suppression, echo
  cancellation, auto gain – they dampen the kick drum) and checks that the browser really does: it then says
  “Microphone unfiltered”, or warns if the browser still filters (then better use Chrome).
- **Beat detection (made for music from the room):** Dream listens for the beat itself, also through a microphone in
  a loud room with echo and talking. It looks for the moments where the sound gets louder (above all the kick drum),
  finds the tempo in the last 8 seconds (60–180 BPM; double, half or triplet time is folded into 80–160 BPM, so a
  half-time section keeps the tempo), and then **predicts** the beats: they come on time instead of a moment late, and
  keep ticking through a short break (“beat held”, the picture rests meanwhile) until the drums are back. It also
  guesses **the one** (first beat of the bar: kick, new bass notes, snare on 2 and 4 against it) and the **phrases**
  (4, 8 or 16 bars, from changes in the sound and a crash on the one); a **drop** after a break is the one and starts a
  phrase. Below the level meter the four dots show the beat in the bar (the big one is the one; pale: beat held
  through a break), and next to them how sure Dream is: “Beat 90 % sure · the one 60 % · phrase 8 bars (80 %)”.
  The beat counter and the autopilot's phrases follow the bars it found.
- **Snap changes to the beat** (Music card, also for Dream Control on the phone): **Bar** (the default) lets a scene
  change (“Next scene”, the autopilot's scenes), “roll effects anew” and the like wait for the next one; **Beat** for
  the next beat, **Phrase** for the start of the next phrase, **Off** acts at once. A press just after the one (up to
  a quarter second) still counts for that one; without a beat it acts at once, and nothing ever waits longer than one
  bar or phrase. A drop flashes at once and changes the scene at the latest on the next beat.
- **Tap tempo – fallback and correction:** when the beat detection struggles or picks the wrong tempo (drum & bass
  often reads as half time, 87 instead of 174 BPM), press **“👆 Tap”** in the Music card (or key **T**, on the phone
  under Music, or learn it as a MIDI button) on the beat, **starting on the one**. From 2 taps tempo and beat stand
  (the median of the last up to 8 intervals) and the first tap of the series is the one. The beat then stays in that
  tempo – also without music – and everything follows it: music reaction, autopilot, effects, the snapping. The music
  only pulls the beat's phase gently; missed beats do not disturb. To adjust: just tap again (a pause of 2 s starts a
  new series). **✕** ends tap tempo, then only the music's beats count again.
- **Limits of the beat detection:** it needs a beat – music without drums gives a low confidence (then tap). The one
  and the phrases are guesses: with four-on-the-floor kicks and no bass line the one stays uncertain (the confidence
  says so), and phrases need a few clear changes in the music before they are known (before that they count from the
  one). Drum & bass and very fast or slow music may land on half or double time. Changes of the playlist's own timer,
  phone or MIDI “next” are not snapped (only those from the stage Mac's panel and its autopilot).
- **What the sliders show (#216):** the fill of a slider tells how much it shapes the picture right now – cool violet
  at its default, through orange to red the further it is from it (weighted: transformation, zoom pull and rotation
  count most), and it gets thicker with it. The three strongest shimmer softly, and every card carries a narrow strip
  on its left edge in the same colours, wider the stronger – also while the card is folded – so one look tells where
  a rotation or a restless picture comes from. A slider whose switch is off (effect strength without an effect,
  music reaction without music) stays cool. Screen readers hear “strongly changed”.
  **Zero in the middle:** zoom pull and rotation have their zero inside the range: a mark stands there, the fill
  starts from it, a dragged thumb snaps to it lightly, and a small **0** button beside the slider (shown while it is
  not at 0) sets it to zero. **Double click or double tap** on a slider: zero for these two, the default for every
  other slider. The same in Dream Control on the phone.
- **Moving signs and the picture's character (#217):** beside the name of the most important sliders a small sign moves
  in the real tempo of what the slider does – no words to read. **Rotation:** a mark runs around its circle as fast as
  the picture turns (backwards when it turns the other way). **Zoom pull:** rings grow as fast as the picture is pulled
  in (they shrink when it is pushed away). **Colour drift:** a colour wheel circles with the colours. **Smoothing:** a
  dot draws a trail, as long as the afterglow. **Transformation:** a form grows into its frame as fast as the picture
  becomes a new one. **Music reaction:** bars bounce on the beat, as high as the reaction. The tempo follows the AI
  pictures per second of the stage and the beat of the music (until they are known: 4 pictures a second, 120 BPM). At 0
  – and while the switch is off, e.g. music reaction without music – a sign stands still and pale; the stronger the
  setting, the brighter the sign.
  **The shape** – below the preview beside “Now running”, in Dream Control beside the live preview (on a phone at the
  head of the sliders' card) – shows the character of the picture on four axes: **change** at the top (transformation,
  drift), **motion** on the right (zoom pull, rotation), **colour** at the bottom (colour drift), **music** on the left
  (music reaction, only with music on). Each axis is as long as its strongest slider and is marked with that sign, not
  with a word; the shape follows the sliders at once. Its corners take the colour of their slider (the same cool →
  orange → red), everything else is neutral. Signs that are not on screen pause (panel hidden with H, card folded,
  scrolled away); with “Reduce motion” in the system every sign stands still and shows only the strength. The signs
  cost the AI nothing. Screen readers skip the signs and hear the shape as “Character of the picture: change … %”.
- **↺ Reset** (title bar of the panel and of Dream Control, not for guests): back to a calm, beautiful dream without a
  break. Everything that shapes the picture glides to its default in about 4 seconds – transformation 0.45, dream
  share 35 %, zoom pull 0.008, rotation 0.2°, colour drift 2°, drift 50 %, smoothing 30 %, motion between the pictures
  100 %, music and movement reaction 1×, directness, outline and pose strength, effect strength –, the effects fade
  out and the autopilot goes off. The **style** goes too – no style model, no style reference picture, both strengths
  at their defaults – in one step at the start, not gliding, so the model is rebuilt only once; and the music
  **pattern** goes back to “Automatic”. **What stays:** prompt, model, quality, resolution, format, input and cameras,
  MIDI and sensor assignments, playlist, outputs, cloud, master brightness, the keys, and every other switch (touch
  options, pulse on the beat, snap to the beat, outlines and pose on or off …). For 10 seconds the button reads
  **“Reset · ↶ Undo”** (a bar runs out underneath): one tap and everything glides back to exactly what it was (style
  and pattern come back in one step as well). No question is asked. A slider you move yourself during the glide is
  yours at once.
- **Sliders:** transformation, dream share, zoom pull, rotation, colour drift, quality (1 to 3 steps), resolution,
  seed. **“acts …” below transformation:** shows what the transformation is made of right now, e.g. “acts 0.52 =
  slider 0.03 · music +0.21 · movement +0.13 · minimum 0.15” – so you see at once who turns it up (the AI needs at
  least 0.15, below that it does not make a whole step). Empty while the slider acts alone.

  **Real styles (Dream card, SDXL-Turbo only):** both change the AI's look, **never the prompt**.
  - **Style model:** Watercolour, Crayon, Pixel art, Paper cut, Sticker or Illustration, with strength up to 200 %
    (above 100 % the style is pushed harder than it was trained – Pixel art needs about 200 %). They are small add-on
    models (LoRAs, 10–320 MB each, free licences: Apache 2.0, MIT, CreativeML OpenRAIL-M), downloaded on first choice
    and then built into the model: a style switch takes 1–3 s (the picture holds meanwhile), changing the strength
    about 1 s, pictures per second stay the same.
  - **Style reference picture:** “🖼️ Picture …” or drag a picture onto the row – the AI takes over its colours,
    strokes and textures, not its content (IP-Adapter in “style only” mode). Strength next to it, ✕ removes it. The
    technique for it (about 3 GB) comes in the background with the first reference picture – in the cloud as on the
    Mac.
  - The higher the transformation, the clearer the style (well visible from about 0.7). With SD-Turbo both rows are
    greyed out: there are hardly any such style models for SD-Turbo and no reference adapter.
  - In scenes: `| style=crayon style_amt=1.5 style_ref=6dade65bd6cc style_ref_amt=0.8` (`off` for none; style names:
    watercolour, crayon, pixel, papercut, sticker, illustration). The picture id shows when you point at the small
    preview; the pictures lie in `~/.local/state/dream/refs`.

  **Transformation 0 = AI off:** the input picture (camera, picture, video, light trails) goes through unchanged and
  sharp, without delay, at about 30 pictures per second; the GPU rests. **Camera pure:** then none of Dream's own
  picture effects acts either – no dream share, no swirl from movement or music, no colour drift or rotation, no
  painting, touching or light circle, no smoothing, no music pulse. Only the effects you chose in the **Effects** card
  stay on top. It goes to the projector, Wi-Fi output and Syphon as usual. From about 0.15 the AI paints again (below
  that it does not even make a whole computing step).
- **Motion between the pictures** (Dream card, #194): the AI makes a few pictures a second; in between, each picture
  goes on moving the way the dream moves – zoomed and turned around the same point, as the next input will be – at the
  full frame rate, and the next picture takes over exactly where the motion has got to. It is one continuous motion
  (#215): Dream knows for every picture how far the dream had moved when its input was built, and shows it moved by
  what has happened since – so a picture that comes late, or one of several on their way at once (camera, video,
  light trails), joins the motion instead of starting it anew, and the smoothed picture and the picture before keep
  their place while the new one blends in. Nothing on the stage moves back, at any number of pictures per second,
  locally and with the cloud GPU alike; if the pictures stop, the motion eases out instead of running away. 100 %
  (default) = the full motion, 0 = off (the picture stands until the next one). With an input (camera, picture, video)
  only the dream's share moves on; at transformation 0 nothing moves. The output window moves along; Syphon gets the
  pictures themselves (without this motion).
- **Shapes travel between the pictures** (Dream card, #205): what the AI itself changes from one picture to the next
  – a tentacle that has grown, a face that has turned – used to fade: for a moment the shape was there twice. Now the
  renderer estimates with every new picture where the shapes of the one before have gone (a coarse flow field: optical
  flow on a grey picture 128 pixels wide, in a process of its own beside the next picture, on the Mac or on the cloud
  GPU; it travels with the picture as 48 × 27 small vectors, under 3 kB). The stage pulls the old picture forward along
  that way and the new one back, and blends the two, so the shapes travel – within the one continuous motion above
  (the field counts from where the camera shows the two pictures, so it adds what the AI changed and nothing moves
  back), at the full frame rate. Where the field explains nothing (the old picture, moved, does not agree with the new one there),
  its vectors shrink to nothing and that part simply cross-fades; a picture that has too little to do with the one
  before (a new seed, a new scene, a drop, another model, a fresh start) gets no field at all and cross-fades as a
  whole. 100 % (default) = the shapes go the whole way, less = part of it, 0 = off (nothing is estimated, the pictures
  cross-fade). The output window and the Wi-Fi output morph the same way; the Syphon source morphs along the same
  field at 30 pictures per second (without the stage's motion and effects, as before). It needs the graphics card's
  drawing (WebGL 2); the Canvas 2D drawing cross-fades. The cross-fade itself is now a true blend of the two pictures
  – it no longer gets darker in the middle. **📏 Measure** shows what a field costs and for how many pictures there
  was one. Limits: the morph starts when the next picture is there (the delay of one picture stays); the field is
  coarse, so fine detail still fades rather than travels; shapes that travel further than a quarter of the picture
  between two pictures are not followed.
- **Smoothing – against flicker** (Dream card, also on the phone and as a MIDI target): the AI paints every picture
  anew, so fine details jump a little from picture to picture – that looks like flicker. Smoothing blends each new AI
  picture softly into what is shown at the full frame rate (a moving average): small jumps vanish, big changes still
  come, only softer. 0 = off, 30 % (default) takes about half the flicker, 60 % a good four fifths, 100 % almost all
  (then it gets sluggish). Projector window and Wi-Fi output smooth the same way, the effects sit on the smoothed
  picture; the AI itself still gets the real pictures, Syphon the unsmoothed picture. With the graphics card's drawing
  the smoothed picture is kept as floating-point numbers (#205), so even the strongest smoothing arrives at the new
  picture – before, a faint shadow of the old one could stay for good (up to 48 of 255 brightness levels at 100 %).
  The Canvas 2D drawing mixes in larger, rarer steps instead (at most 4 levels are left).
- **Drift – the dream stays alive:** without new input (prompt only) the picture-to-picture loop would freeze after a
  while. Drift lets the noise wander softly from seed to seed, moves the picture a little by itself (breathing,
  swaying, wandering) and gives a push when the picture hardly changes for a few seconds. “Vary the prompt gently”
  blends the prompt slowly between variants (light, colour, material). Slider 0 = off, default 50 %. Also on the phone.
- **Keys:** H panel off/on, F fullscreen, Space pause, hold V = speak, S save picture, T tap tempo, Q phone QR,
  D movement diagnostics, E Dreamy Eyes' trance.

Speed locally (M2 Max, 512 px): about 4 to 5 pictures per second with 1 step, about 2 with 2 steps.

**Tips:**
- The dream freezes or gets static → turn drift up (30–60 %) or lower the transformation to 0.5–0.65.
- Too restless → lower the transformation, raise the dream share, lower drift.
- 🎲 gives a new seed: the dream jumps somewhere else.
- If a second Dream or another GPU program runs at the same time, everything gets much slower.

<sub>[↑ Contents](#contents)</sub>

### Autopilot

The autopilot runs Dream by itself, varied, led by the music. Switch it on with **“🤖 Autopilot”** below the preview
(or on the phone in the Autopilot card). In the Autopilot card: **Liveliness** (calm … wild) – it has priority: it
sets how dynamic the picture is (slider swings, pace of changes, effects, speed before quality); the music detection
only comes on top. **Calm** means calm and flowing: no flicker, no flashes, no jolts or jumps (only the soft pattern
“Flow”), long blends, sliders glide slowly, changes only every 16 bars, at most gentle effects (waves, afterglow,
mirror, mandala). **Wild** means power: full slider swings, all effects at full strength, strong pulse and flash on
the beat, the hard patterns (Pulse, Jolt, Jump) changing faster, changes every 4 bars. **Make pictures & clips**,
**Include the camera**, **Include light trails** (only when movement is on): camera and light trails are only used
when ticked.

- **The music leads:** switch music on under “Music” (microphone or file). Phrases of 8 bars are its moments for
  changes; the loudness (measured against the music itself) sets the mood from calm to wild; a break calms, a drop
  turns things over (next scene, or back into the dream). Without music it has its own calm beat (every 12–26 s). It
  does not need calm phases: if the music stays equally loud, a slow wave of its own keeps the mood moving, and
  pictures/clips still come (at the latest a minute after their time). The beat detection also handles very loud,
  dense music reliably.
- **Dream:** transformation, dream share, zoom (sometimes out), rotation (changes direction), colour drift and drift
  glide softly to the mood – never jumps.
- **Music character:** from tempo, beat regularity, dynamics and the balance of bass to highs it roughly recognises
  how the music feels: **calm/flat** (no beat or slow), **driving** (steady beat from ~112 BPM), **broken** (the beat
  often falls out of the grid), **dark/bassy**, **bright/glittering**. The character changes only after it has lasted
  6 s and shows in the chip. It colours the sliders, adds fitting words to the prompt the AI gets (the visible prompt
  stays, e.g. “psychedelic tunnel, kaleidoscope, fractal patterns, neon” when driving) and chooses fitting playlists
  (driving: Psychedelic, Retro, City …; calm: Calm, Water, Nature …).
- **Effects:** from about a third of liveliness it lays effects over the picture, plus tunnel pulse and light flash –
  on the music's beats, without a beat on a pulse of its own (the wilder, the faster). The palette: kaleidoscope,
  mandala, mirror, endless tunnel, waves, feedback, afterglow, pixel, grid (dots or lines), RGB shift, glitch stripes,
  colour rotation and – rarely and briefly, only on drops – invert. It builds sets from them (calm: 1 effect, wild: 3)
  fitting the music character (driving e.g. tunnel, feedback, mandala; broken glitch, RGB shift, pixel; calm waves,
  afterglow, mirror), changes them on phrases, drops and a new character, blends over in ~1.5 s and does not repeat
  the last sets. Which set is running shows briefly in the chip. The strength follows the liveliness; a beat and
  driving (or broken) music add a little, calm music takes a little away. No strobe, no hard black frames. The
  effects run at the full frame rate (60 fps) however fast the AI computes (measured on a Mac with graphics chip: 60
  fps with three effects) and appear in the output window too (projector, Wi-Fi output), not in Syphon.
- **Drawn on the graphics card (#204, #210):** the stage and the output window draw the picture as one chain in
  WebGL 2 – the last two AI pictures with their motion, morphed into each other (#205) or cross-faded, the smoothing, the effects, the touch layers
  (light strokes, stirring, light circle), colour rotation, brightness and master. On a Mac this chain shares the
  graphics card with the AI, so it draws sparingly: at the resolution the picture really has (an AI picture of 512 px,
  or the effects' buffer – not every pixel of a Retina screen; the browser scales it up like any picture), only when
  something moves (a still picture is not drawn again, the smoothing rests once it has caught up with the newest
  picture), and the preview beside the panel at 30 instead of 60 frames per second while an output window is open. The page
  does not ask the browser for sizes and styles in every frame, and the movement detection's look at the shown picture
  (for “subtract the projection”) does not make the graphics card wait (#205).
  Measured on a Mac with an M2 Max (sd-turbo, 512 px, 1 step, transformation 0.5; the stage alone and the panel with
  an output window, each also at Retina resolution), the AI makes as many pictures with it as with Canvas 2D: the
  difference stays within the spread of the measurement (about 2 %); how to repeat it is under “Tests”. Nothing to
  set: without WebGL 2, or if the graphics card's drawing stops while Dream runs, the same pages draw with Canvas 2D
  by themselves (a badge below the preview says so; when it comes back, WebGL 2 takes over again). **📏 Measure**
  shows for the stage what draws: “graphics card (WebGL 2)” or “Canvas 2D (no WebGL 2)”. To compare the two, or if a
  graphics driver makes trouble, add `?render=canvas` to the address of the stage or the output window
  (http://127.0.0.1:7860/?render=canvas). Syphon, the preview of Dream Control and the dream windows get the AI
  pictures themselves; Dreamy Eyes and the dream windows draw on their own.
- **Effects by hand:** the same effects without the autopilot in the **Effects** card (below Dream): twelve tiles to
  switch on and off (one of each family at a time – kaleidoscope/mandala/mirror, pixel/grid, feedback/afterglow),
  **Effect strength** for all, **Pulse on the beat** (only on real beats of music or tap; off = the effects stand
  still), **🎲 Roll** (a fitting mix of 2–3 effects) and **All off**. While the autopilot runs, the card shows dashed
  what it chose; when you tap something yourself (also strength or pulse), you take over exactly that and it leaves
  the effects alone for 1 minute. The choice stays after a restart.
- **Liveliness wild** (from about two thirds): changes every 4 instead of 8 bars, sliders follow faster, short blends
  and **speed before quality**: 1 step and 384 px (about twice the AI pictures per second, coarser). Below wild it sets
  quality and resolution back. If you changed them yourself, it leaves them alone.
- **Driving music** (steady beat from ~100 BPM) colours further: more tunnel pull, faster rotation and colour drift,
  psychedelic words in the prompt, playlists like “Psychedelic”. A break does not switch the character to calm at once.
- **Scenes & playlists:** next scene every 2–4 phrases (the wilder, the more often) and on drops; every few minutes
  another playlist. If none is chosen, it chooses one.
- **Input:** mostly the prompt dream. Every few minutes (rather in calm moments) it makes a picture or a clip from the
  current scene or takes something from the gallery, lets it run for a phrase or two and then returns seamlessly into
  the dream (out of the picture, without a restart).
- **Your hand has priority:** what you change on the Mac, on the phone or by MIDI it leaves alone for 1 minute; an
  input, playlist or typed prompt you chose yourself for 2 minutes.
- **What it steers is tinted:** while the autopilot runs, everything it may change has a subtle blue tone behind it,
  and the card shows 🤖 in its title. Tinted are the dream sliders (transformation, dream share, zoom pull, rotation,
  colour drift, drift), input, prompt, playlist, the effects, the ticked interactions and, when wild, quality and
  resolution. What you hold yourself right now is neutral, dashed and marked with ✋ while it is yours. Liveliness,
  directness, master, MIDI and output it never touches.
- **Direct interaction with the autopilot:** it uses only the ticked interactions and doses them by liveliness: calm
  only painting and light, from medium also touching and content-reacts, wild also impulses. What it leaves out right
  now stands pale. Directness stays your own slider.
- **What it is doing** shows in the green chip below the preview, in the card and on the phone (e.g. “🤖 wild ·
  ♪ follows the beat · next scene”).
- The switch survives a restart (for installations). Pause stops the autopilot too.

### Pictures and clips on request

Instead of preparing your own pictures, let Dream make a picture or a short clip (card **“Input & prompt”**, tab
**Picture** or **Video**; on the phone the card “Make picture & clip”):

- It is made from the **dream's prompt**. To show something else, open “a text other than the prompt …” and type it
  there (leave empty = the dream's prompt).
- **✨ Picture:** the same model as the dream computes a single picture from the text: 4 steps, then a finishing pass
  at 1.5× size (square 768×768, 16:9 1344×768 at 512 px). That takes about 3–15 s locally (longer the very first time
  while the model loads). The picture becomes the input “Picture” at once, the dream paints on it.
- **✨ Clip:** first the picture, from it Dream computes 48 pictures in which the camera slowly zooms in and turns a
  little while the dream paints on (each picture stays close to the starting picture so nothing blurs). Played forward
  and backward that gives a seamless loop of about 8 s that runs as input “Video”. About 20–30 s locally. The button
  🎞 below a picture in the gallery makes a clip from exactly that picture.
- **Gallery:** the last 5 pictures and clips. Tapping feeds them in again; what is running is marked (“running”).
  **💾** saves for good to `~/Pictures/Dream/` (file name with date and prompt), ✓ means: already saved. The gallery
  itself is temporary: it is empty after Dream restarts.
- **🗑 Delete** (on the stage, phone and tablet) takes a picture or clip out of the gallery at once – also those the
  autopilot made; **“↶ Undo”** brings it back within a few seconds, then the file is gone. **🗑 Delete all** below the
  gallery asks once. If the deleted one is the input right now, Dream dreams on from the current picture. Copies saved
  with 💾 in `~/Pictures/Dream/` stay.

Good to know:
- It is computed where the dream computes (Mac or cloud GPU). The dream stutters a little meanwhile because both
  share the GPU.
- The stage or panel must be open, also when you tap “Make” on the phone.
- Clips need **ffmpeg** on the Mac (`brew install ffmpeg`); if it is missing, Dream says so in the card.
- It is not a real video model: the movement is a camera ride through the dream.

## Playlists and autostart

- **Playlists:** choose a playlist in the panel or on the phone – the scenes change automatically (interval,
  optionally random), “Next” jumps at once. Every scene change blends the prompt softly from the old to the new one.
  Built in: Psychedelic, Fire, Water, Cosmos, Calm, Nature, City, Myths, Deep sea, Crystal, Retro, Organic, Figures and
  Abstract (8 scenes each), **Mix** (28 scenes across all moods) and three **dream journeys** (see below). A drop in
  the music jumps on too with “Drop → next scene”.
- **✨ Surprise:** a playlist choice of its own – takes a random scene from all playlists on every change and adds one
  or two random styles (e.g. watercolour, ink, stained glass, neon, Bauhaus).
- **Dream journeys** (“Journey: Ocean”, “Journey: Fire”, “Journey: Cosmos”): a fixed order as an arc – calm start,
  peak, calm end – with long transitions (8–10 s). Each scene brings its own settings (transformation, drift, colour
  drift, music pattern, duration); random does not apply to journeys.
- **Editing:** “✎ Edit” (chosen playlist) or “＋ New” in the panel or on the phone. One scene per line, in English;
  optionally settings after “|”, e.g.
  `glowing glass forest at night | strength=0.6 drift=0.4 hue=6 pattern=Flow secs=40`
  (allowed: strength, drift, hue, zoom, rot, mix, fx = effects like `tunnel+waves` or `off`, fx_amt = effect strength
  0–1, style, style_amt, style_ref, style_ref_amt, pattern = Pulse/Jolt/Jump/Flow, secs = the scene's duration).
  Effect names: kaleido, mandala, mirror, tunnel, waves, feedback, trails, pixel, raster, rgb, glitch, hue. First line
  `# Journey` (optionally `# Journey fade=10`) makes it a dream journey. Saved in `~/.config/dream/playlists.json`
  (never in the repository); a built-in playlist gets your own version this way, “Delete” removes only that again.
  The German keywords of earlier versions (`aus`, `Fluss`, `# Reise`, German playlist names) keep working.
- **✨ AI playlist:** type a keyword (or speak it with 🎙 on the Mac, with the keyboard's microphone on the phone),
  “Make” – the local language model (Ollama, `llama3.2:3b`) writes 8 scenes, the playlist “AI: …” starts at once. AI
  playlists are **temporary**: they live only in memory, vanish when Dream restarts, and there are at most 5 at a time
  (the oldest goes). **“📌 Keep”** (or “Save” in the editor) makes the chosen one your own, lasting playlist. If Ollama
  is not running, Dream says so (start it with `ollama serve`, get the model once with `ollama pull llama3.2:3b`).
  Everything stays on the Mac.
- **Autostart:** `./install-autostart.sh --lan --x 1920` starts Dream after every login, keeps the display awake and
  opens the stage fullscreen in a Chrome window of its own on the projector (`--x` = the projector display's left edge
  in macOS). Remove: `install-autostart.sh --remove`.
- All settings survive a restart (`~/.local/state/dream/state.json`). Dream writes the file about a second after the
  last change (while a slider is dragged for long, every 5 seconds) and when it is stopped.

<sub>[↑ Contents](#contents)</sub>

## Output on a projector or second monitor (16:9)

- **Format:** in the panel or on the phone “Format” → **16:9 (projector)** or square. 16:9 computes e.g. 896×512 (at
  512 px) or 1344×768 (at 768 px, cloud). All inputs, zoom, drift, movement and Syphon use the format. 16:9 has about
  1.75× as many pixels: locally somewhat fewer pictures per second, the output blends over softly.
- **Output window:** button **“⧉ Open output”** in the panel (or http://127.0.0.1:7860/output) – shows only the
  picture, without controls and mouse pointer, and does **not** compute itself: it shows exactly what the stage on the
  Mac shows. Drag the window to the projector, **F** (or a click) for fullscreen, a double click ends it. The panel on
  the Mac must stay open for it.
- **Output over Wi-Fi (optional):** instead of an HDMI cable from the Mac, a **second device at the projector** can
  show the picture (old notebook, mini PC, Raspberry Pi, Android TV box or Fire TV stick with a browser – Apple TV
  does not work, it has no browser). Start Dream with `./dream.sh --lan`, tap **“📶 Output over Wi-Fi”** in the panel
  under “Output”: its QR code opens large with the link below it – scan it or type the link on the device (the link
  contains the access key, like the phone's QR code; “⧉ Copy link” puts it on the clipboard). Tap the picture once on the device or press F for fullscreen. Next
  to the button it says how many outputs are connected.
  - Data and delay are uncritical (about 1–2 MB/s, a fraction of a second; the blend smooths it).
  - On Wi-Fi drop-outs the picture holds briefly, the page says “Connection to Dream lost – reconnecting …” and goes
    on by itself. Safer for shows: a LAN cable or a router of your own at the projector.
  - “No access” means: the key no longer fits (e.g. a new guest code) – scan the QR code again.
  - The stage (panel) on the Mac must stay open, the Mac must not be locked or asleep.
  - Switch off screen saver and power saving on the receiving device, otherwise the projector goes black at some point.
- **Automatically at start:** `dream.sh --lan --beamer` opens the output window fullscreen (Chrome kiosk) on the
  second display. If the projector is not to the right of a 1920 px wide main display: `--beamer=X` with X = the
  projector's left edge in macOS (System Settings → Displays → Arrange). Without Google Chrome the window opens
  normally; then drag it over by hand. End the kiosk: Cmd+Q.
- **Alternative** without the panel on the Mac: `dream.sh --stage` (or `?stage=1`) on the projector and control it
  from the phone. Do not open both as a stage at the same time – every open stage computes itself, the GPU would run
  twice.

<sub>[↑ Contents](#contents)</sub>

## As a source in Resolume (Syphon)

Switch “Syphon output “Dream” for Resolume” (stage or phone). Then the source **“Python – Dream”** appears in Resolume
under **Sources → Syphon**. Dream sends it at 30 pictures per second and blends softly between the AI pictures – with
“Shapes travel between the pictures” on (#205) it morphs them along the flow field, like the stage –, so it
looks fluid even at 2–5 AI pictures per second. The stage must be open for it (it delivers the pictures). Without
Resolume just leave it off.

<sub>[↑ Contents](#contents)</sub>

---

## Phone remote

<p align="center"><img src="docs/images/control-en.webp" alt="Dream Control on a phone" width="260"></p>

```bash
./dream.sh --lan
```

Then Dream is also reachable in the home Wi-Fi – but only with a secret link. Press **Q** on the stage (or
“📱 Phone”): a QR code appears in a corner of the stage, scan it with the phone, done. The phone remembers the access. Everything you
change on the phone happens at once on the stage. To speak on the phone: the keyboard's dictation. Several phones at
once work too.

**The other QR codes open in a lightbox:** large on white – easy to scan from a distance and with old phones – with
their explanation below. This goes for Dream Control, the output over Wi-Fi, the certificate, Dreamy Eyes and the dream
windows, in the panel and in Dream Control alike. Close it with **Esc**, a click beside it or “Close”; the keys of the
stage rest meanwhile. A code is only loaded while its lightbox is open, so its key is never on the screen longer than
needed. The guests' code stays small in the corner of the stage (Q, “📱 Phone” or “QR on the stage” in Dream Control
show and hide it): the dream goes on behind it and the keys keep working.

<sub>[↑ Contents](#contents)</sub>

### Dream Remote (guests) and Dream Control (you)

There are two keys, so the audience may play along without being able to cost you money or switch anything off:
- **Dream Remote – the QR code on the stage – is for guests.** A guest steers the dream: prompt, next scene,
  new seed, sliders (transformation, zoom, drift …), styles, effects, music reaction, pattern and tap, making
  pictures and clips, using pictures from the gallery. A guest cannot: pause, “New”, the QR code on the stage, blackout
  or master brightness, the autopilot, the Mac's camera (inputs “Camera” and “Light trails”), removing the picture or
  video you set, the playlist (choice, interval, random), the whole movement card (movement steers the dream, painting,
  touching, directness, content, impulses at the hand, light in the dark, mirror, movement reaction, the pose), the music's automatic pattern change and
  “Drop → next scene”, uploading, MIDI, Syphon, model, quality, size, the cloud GPU, editing or keeping playlists,
  saving or deleting in the gallery. The remote shows a guest only what a
  guest may use, and the server refuses the rest anyway (“Only Dream Control may do this.”).
- **Dream Control is your own remote with every setting.** In the panel under “Output”: **🎛 Dream Control** shows its
  QR code – scan it with your own phone or tablet, never in front of the audience (the code is gone again when you
  close its lightbox). Only one device is Dream Control at a time: a second one starts as a guest with the button
  **“Take over Dream Control”**; the first then steers as a guest and may take it back the same way.
- **↻ New guest code** (panel, under “Output”) asks once, then makes a new guests' key: every guest phone and every
  output window opened with the old one loses access at once, the stage shows the new QR code. Dream Control keeps its
  access. Handy after an event, or when a link went round further than it should.

The keys lie in `~/.local/state/dream/remote-token` (guests) and `control-token` (Dream Control). Deleting one and
restarting Dream creates a new one. The output on a second device over Wi-Fi uses the guests' key.

**Safety nets (#175):** every number a device sends is checked (finite, inside the slider's range – nothing can break
the saved state, and a broken `state.json` heals at the start). Only Dream's own pages count: a web page of another
site open in a browser on the Mac can neither start the cloud GPU nor steer Dream (the Host must be this Mac, an
Origin must match it). A guest may only ask for what Dream Remote and the output window need – everything else needs
Dream Control – and not faster than about 20 messages a second. The key leaves the address bar right after the page
has opened (it stays in the cookie), and the log never shows it (nor the polling of `/stats`, `/cloud`, `/health`).

### Dream Control over https and as an app

With `--lan`, Dream also listens with **https** on port 7443 (`DREAM_HTTPS_PORT`; not 7861, that is the cloud GPU's tunnel). Guests keep
using plain http – their QR code needs no setup. Dream Control uses https: then Chrome can install it as an app of its
own (“Dream Control”, cloud mandala icon, fullscreen), the screen stays on through the browser's official Wake Lock,
and it works on phones with strict security settings (“Always use secure connections”).

https needs a certificate the device trusts. Dream makes its own small certificate authority on the Mac the first time
it starts with `--lan` (in `~/.local/state/dream/tls/`, nothing to install on the Mac, no admin password). It may only
vouch for addresses inside a home network (private IP ranges and `*.local`) – even if its key ever got out, it could
not stand in for any website. The key never leaves the Mac. The server certificate is renewed by itself when the Mac's
address changes (on the next start) and before it runs out.

**Once per device** (Android):
1. Panel → “Output” → **🎛 Dream Control**. Code **1** downloads the certificate `dream-ca.crt` – scan it.
2. Install it **in the settings** – since Android 11, tapping the download only says “CA certificates can't be
   installed” (or similar). Settings → search for **“CA certificate”**, or:
   - most devices: Settings → Security (and privacy) → More settings → **Encryption & credentials** → **Install a
     certificate** → **CA certificate**
   - Samsung: Settings → Security and privacy → More security settings → **Install from device storage** → **CA
     certificate**

   Then “Install anyway”, unlock (a screen lock is required) and choose **Downloads → `dream-ca.crt`**. Check:
   settings search “Trusted credentials” → tab **User** shows “Dream home network CA”.
3. Tap **“Certificate is installed → next”** – the lightbox shows the codes one after the other and remembers this step
   (next time it starts with code 2; “← Certificate” goes back). Scan code **2** (Dream Control). In Chrome: menu ⋮ →
   **Install app** (or the remote's own “⤓ Install as app” button). From then on it starts from the home screen like an
   app. A tablet with device management (work or school) may forbid own certificates altogether.

Firefox on Android uses its own certificates: Settings → About Firefox → tap the logo five times → back → Secret
settings → “Use third party CA certificates” on. iPhone/iPad: open the code in Safari → install the profile in
Settings → General → VPN & Device Management, then Settings → General → About → Certificate Trust Settings → turn on
“Dream home network CA”.

**Pairing inside the app (#170):** a device without a valid key – an installed app too – no longer gets a white “No
access” page but **“Pair with Dream”**: it first looks once more by itself (that also heals a key from before 17 Nov
2026, whose cookie was too strict for an app started from the home screen; a key that works is renewed on every page),
then offers **📷 Scan the QR code** right in the page (Chrome on Android reads QR codes itself; elsewhere it says to use
the camera app) or pasting the code's link, and says where each code is shown. A device that only holds the eyes'
key and opens Dream Control gets this page too (no bare “Only Dream Control may do this.”). Only the key is taken from
the code; the page stays on this Dream.

To start over (new authority): delete `~/.local/state/dream/tls/` and restart Dream; every device then needs the new
certificate. Without `--lan` there is no https and no certificate.

### On a tablet (Android)

The remote is made for a tablet as well, upright and lying, best in **Chrome** (Firefox as a fallback, see below):
- **Upright:** the cards in two columns, a **show bar** at the top that stays while scrolling: a small **live
  preview**, **Pause**, **Next**, **Autopilot**, **Blackout** and large sliders for **Transformation** and
  **Master brightness**. **Lying:** three columns, the bar as a column on the left. The cards keep their order and
  are only placed anew when you turn the tablet – folding a card moves nothing to another column.
- **Live preview:** what the stage shows, about 4 pictures per second, as a small picture (320 px, a fraction of the
  Wi-Fi the Wi-Fi output needs). Tap it to switch it off and on (remembered), hold it to see it large – while it is
  large, the remote gets the stage's full picture.
- **⛶ Fullscreen:** a tap fills the whole screen without address and status bar (on a phone the button is in the
  header). Coming back from another app, a button asks “⛶ Fullscreen again?” – browsers allow fullscreen only after
  a tap. A home screen shortcut (Chrome menu → “Add to home screen”) opens it with one tap, with Dream's icon (the
  cloud mandala) and the name “Dream”. Installing it is optional – the remote stays a normal web page.
- **The screen stays on** while the remote is open (Wake Lock where the browser offers it, otherwise a tiny silent
  video loop).
- **Blackout** in the bar sets the master to 0 and back, like the MIDI button.

### Live camera and motion of the Control device

Dream Control (over https, see above) has a card **“This device”**:
- **📷 Live camera** sends what the phone's or tablet's camera sees to the stage (back or front camera), about 12
  pictures a second at 640 px – smooth in the home Wi-Fi, about 0.5 MB/s. The stage switches to the input
  “Camera” with “📱 Live camera of a phone” and shows the chip “📱 Live camera: Dream Control” (orange when no
  picture came for 2 s). Nothing is stored; the pictures go from the device to the stage only. Switching it off, closing
  the page or losing the connection ends it, and the stage goes back to the dream – never by itself to the Mac's
  camera.
- **🧭 Motion** sends the device's sensors (acceleration, rotation, tilt) like a sensor on the arm (see “Sensor input”):
  choose what it steers, tap **📡 Learn** and move the device for 2 seconds; **a strike** (swinging the device
  sharply) becomes an impulse (flash, spin jolt, new motif, next scene, blackout). The stage shows “📱 Motion: Dream
  Control”; the learned assignments appear in the panel under “Control (MIDI, sensors, master)” like those of OSC.
- **Always one device:** live camera and motion come from one device only – the one that is Dream Control. Taking over
  Dream Control on another device ends both on the first. Guests cannot send either.
- Over plain http the card explains that the browser releases camera and motion only over https.
- The stage's camera source is called “📱 Live camera of a phone” – it is the Control device's or the Dreamy Eyes'.

### If the phone does not connect

1. Started Dream with `--lan`? (Without `--lan` Dream is only reachable on the Mac.)
2. The phone in the **same Wi-Fi** as the Mac – not the guest Wi-Fi, not mobile data. The phone's IP address (Wi-Fi
   details) must start with the same first three numbers as the Mac's (`ipconfig getifaddr en0`).
3. **Android:** in a test, Chrome reached no devices in the home network (not even the router), **Firefox worked at
   once**. So open the link in Firefox. In Chrome, these may help: Settings → Privacy and security → “Always use
   secure connections” off, “Secure DNS” off; no work profile (briefcase).
4. **iPhone:** open it in Safari; Chrome needs Settings → Privacy & Security → Local Network → on.
5. VPN or ad blocker on the phone off.
6. Test without the link: `http://<Mac's IP>:7860/health` on the phone – if anything answers (also “forbidden”), the
   connection stands. The Mac's IP: `ipconfig getifaddr en0`.

**A phone with a weak connection** (at the edge of the Wi-Fi) does not slow down anyone else: every device has its
own small queue, the stage, the projector and the other remotes go on. Of the pictures it only gets the latest; if its
line does not move for 10 seconds, Dream disconnects it, and its page connects again by itself (“Connection lost –
trying again …”) and gets all settings anew.

Photos and short clips also work via “Upload a picture or video” → camera. The live camera of the phone or tablet:
see the next section.

## Dreamy Eyes – a phone as dreaming eyes (installation)

<p align="center"><img src="docs/images/eyes-en.webp" alt="Dreamy Eyes" width="420"> <img src="docs/images/trance-en.webp" alt="Dreamy Eyes in trance: the third eye opens" width="420"></p>

A phone of its own stands at eye height, its **front camera** feeds the dream, and its screen shows **two dreaming
eyes** that invite people to step up and play:
- **In the iris lies the dream** as the stage shows it right now, curved like in an eyeball, with a soft highlight –
  and very faintly whoever stands in front of the camera.
- **The eyes react to the dream:** the pupils widen in dark, calm scenes and narrow in bright ones; much movement in the
  dream opens them wide and makes them lively, calm passages leave them dreamily half closed. Now and then they blink
  (sometimes twice), glance around, and a tap on the screen wakes them up a little.
- **They look at you:** the phone finds the face in front of its camera (MediaPipe Face Landmarker, on the phone itself –
  nothing of it is sent or kept) and the eyes follow the person; when someone steps up they open, very close they go
  wide with surprise, and interest widens the pupils. Without anyone in front they dream around by themselves.
- **Mostly only the eyes (#220):** how much of a face shows follows one rule, for everything face-like that is drawn in Dreamy
  Eyes and in the dream windows (the faces painted by the AI and “you in the dream” are pictures and stay whole). Most of the time there are only the eyes. Every one to two minutes **hints** come for
  about ten seconds: the brows, and the sign on the forehead of a face drawn in light. Every five to ten minutes or so,
  inside such a moment and only while the eyes are calm, **mouth and outline** join them – as a breath, never stronger
  than about a third – and leave again before the hints do. **A nose never shows**, and there is no grin. To look at a
  level, add `?face=0`, `?face=1` or `?face=2` to the address of Dreamy Eyes or of a dream window: it is held (0: only
  the eyes, 1: with hints, 2: with mouth and outline).
- **Style worlds (#221):** how all of this is drawn is a *style world*. Dreamy Eyes and the dream windows decide the
  scene – what appears, when and where; a world decides the material: the eye, everything that lives around the eyes
  and drifts through the windows, the faces of light, the large motifs of the windows. The first world, **Classic**,
  is the look Dream has had so far (glowing lines, soft light), unchanged. Choose the world in the panel (the row
  under “Trance: …”: **Style world**) or in Dream Control (card “👀 Dreamy Eyes”); a MIDI button can step to the next one
  (“Button: next style world”). Dream tells every Dreamy Eyes page and every dream window at once – they only hear
  it, their codes cannot set it. Fire, trance and “you in the dream” run in every world: besides the eye, the
  living things, the faces and the motifs, a world also draws the night behind the eyes, a window's sky, the flames,
  the trance and what surrounds “you in the dream” (#222: its frames, fireflies and the sparks it leaves, the colours
  of its glow; the person's picture itself and how it is dreamed – wavering, mist at the edge with its colour fringe,
  clear at the peak, coming apart – are the same in every world). In every
  world besides Classic the face rule above holds for everything drawn, and none of today's signs appear (hearts,
  stars, “z”): each world has a form of its own for them. A world is one file (see “Tests” for how it is built in).
  The worlds:
  - **Classic** – today's look, unchanged.
  - **Bioluminescence** (#222) – the deep sea: no outlines anywhere, only filaments of light, thin membranes and
    beads of light pulsing along them; marine snow drifts through everything. The eye is a dark chamber lit from its
    rim, with an anemone's crown around the iris and cilia for lashes; the brow is a row of small lights. Around the
    eyes: plankton, an anemone opening, a comb jelly, a sea fan growing, small medusae, a siphonophore's chain of
    lights. The faces of light are a medusa, an anglerfish and an anemone (a warm lure or a small crown on the
    forehead with the hints; bell, arms and the jaw's lights only in the rare moment). In a window the dream glows in
    the water around a medusa seen from above – with the eye or the folded dream in her bell – and the impossible
    shapes are panes of the dream edged with filaments. A fire is a vent glowing in the deep (warm plumes rising);
    where Classic shows a heart there is a warm lure or a tiny warm medusa, where it shows stars plankton flashes,
    and sleep is slow bubbles. Measured in a headless browser without a graphics card, the processor slowed four
    times: Dreamy Eyes about 19 frames a second (Classic: 30), a dream window 6 (Classic: 8) at full resolution – both
    pages lower their resolution by themselves when a device does not keep up, as before.
  - **Ink & watercolour** (#223) – light pigment on black paper. Surfaces are washes with wet edges and grain, lines are
    brush strokes that swell, thin out and run dry; the line work “boils” a little, as hand animation does. The eye is a
    bone-coloured wash with a brushed iris ring, bare paper for its highlight and one loaded lid stroke flicked into a
    wing; the brow is a brush stroke. Around the eyes: petal washes, a bloom of pigment spreading, an enso, an ink twig
    growing leaf by leaf, a bird of two strokes, drops in wet paper, a sweep of a broad brush. The faces of light are
    *sumi*, *willow* and *plum* (a small sign on the forehead with the hints; hair strokes and washes, a thin jaw line
    and closed lips only in the rare moment). In a window the dream shows through wash blots, around a brushed enso with
    the eye or the folded dream in it; the impossible shapes are washed panes with brushed edges. Fire is vermilion and
    ochre washes with flame strokes rising; where Classic shows a heart a drop of red pigment blooms, where it shows
    stars there is a flick of splatter, and sleep is slow rings of wash. Measured as above (processor slowed four
    times): Dreamy Eyes about 20 frames a second, a dream window 4 (Classic: 36 and 8 in the same run).
  - **Engraving** (#225) – an old engraved plate that comes alive, with the long lines of Art Nouveau. There is only
    line – strokes that swell and thin, hatching, stipple – in bone-coloured ink with verdigris, old rose and a little
    gold light that now and then runs along a line. The eye: the white is fine lines following the ball, the lid one
    swelling line that ends in a tendril, single lashes; the dream itself is engraved in the iris, strokes as thick as
    it is bright there. Around the eyes and through the windows: a fern whose crozier unrolls, a vine that draws itself
    with leaves opening behind its tip, a seed head whose seeds leave on the air, a lily opening, a naturalist's moth
    with hatched wings, hatched drops of dew, winged seeds circling an eye, a cloud of stipple. The faces of light are
    *lily* (a gem on a fine chain on the brow; rarely hair in bundles ending in curls, lilies at the temples, an open
    ticked halo), *fern* (a young crozier on the brow; rarely vines for hair, a wreath of leaves, a stippled jaw) and
    *moth* (a moth at rest on the brow; rarely a veil of fine lines, a halo of stipple) – closed, hatched lips only in
    the rare moment, and no nose although the design had one. In a window the dream is a rosette engraved in a ticked
    medallion with vines growing round its frame, the third eye sits in the middle of a seed head, the impossible shapes
    are hatched face by face and a seed climbs the stairs; the sky is stipple in the dream's colours. Fire is engraved
    flames with gold inside. Instead of a heart there is a bud, instead of stars a seed head and drifting seeds, and
    sleep is a poppy's head nodding and letting a few seeds go. No line is finer than about 1.2 px, so the plate holds
    on coarse outputs. Measured as above (processor slowed four times): Dreamy Eyes about 25 frames a second, a dream
    window 6 (Classic: 39 and 8 in the same run).
  - **Aurora** (#226) – curtains of northern light over a field of stars: slow, luminous, cold greens and violets with a
    warm lower edge; the calmest world. A curtain is a line with rays standing on it, their height and brightness
    wandering along it. The eye is a piece of night sky with light standing on its lower lid, rays rising from the upper
    lid for lashes, a thin corona around the iris; the brow is a small arc of rays. Around the eyes: a small drifting
    curtain, a halo with its mock moons, a small corona, light pillars over ice dust, a shooting star, diamond dust, a
    quiet arc. The faces of light are *veil*, *crown* and *pillars* (a brighter light on the forehead with the hints;
    veils where hair would fall, a low band along the jaw and a warm breath for the mouth only in the rare moment – and
    no pillar of light between the eyes, although the design had one). In a window the dream is seen in great curtains,
    around an auroral corona – rays streaming out of a dark disc with the eye or the folded dream in it; the impossible
    shapes have edges of light. Fire is a red aurora rising from the horizon; where Classic shows a heart there is a
    small warm sun dog, where it shows stars ice dust glitters, and in sleep pillars dim one after the other while snow
    sinks. Measured as above (processor slowed four times): Dreamy Eyes about 25 frames a second, a dream window 3 at
    full resolution (Classic: 35 and 8 in the same run) – this world's windows are the most costly so far and rely on
    the page lowering its resolution on a weak device.
- **Crossfading the worlds (#224):** two style worlds can show at once, one fading into the other – the same scene
  drawn in both and added up, like a double exposure: the eyes, the faces of light and a window's motif sit exactly on
  each other. Three controls beside the style world, in the panel (the row under “Trance: …”) and in Dream Control
  (card “👀 Dreamy Eyes”): the **second style world**, the **crossfade** between them (left: all of the first world,
  right: all of the second; anywhere between, both stay mixed for as long as you leave it there) and the **worlds
  drift**. A MIDI knob can turn the crossfade (slider target “Style worlds: crossfade”); the button “next style
  world” goes to the world after the one that shows most, all of it. Choosing another world never cuts: it comes in a
  short fade (about a second and a half).
  - **Worlds drift – on in a new Dream:** Dream wanders from world to world by itself, through all of them in the
    order of the list and round again. Each world stays alone for a while, then the next one comes slowly: *slow* (a
    world every five minutes), *calm* (every two minutes – the default), *lively* (every 45 seconds) or *off*. You see
    the crossfade slider move with it. A hand on the style world, the second world or the crossfade – in the panel, in
    Dream Control or with a MIDI knob or button – makes the drift wait three minutes; then it goes on from where you
    left the mix. To keep a world or a mix for good, set the drift to *off*. The drift rests while no Dreamy Eyes and
    no dream window is connected. “Reset” leaves all of this alone (it is for what shapes the AI picture).
  - **Old phones:** drawing two worlds in every frame costs about twice the time. A device that does not keep up
    therefore never shows a lasting mix: it shows the nearer of the two worlds and changes over in a short fade once
    the crossfade is clearly past the middle; the weakest devices (those that already draw with the least detail) go
    through black instead, so they never draw two pictures for one frame. Each page decides this for itself from its
    own frame rate (two worlds below about 33 frames a second for three seconds: one world from then on; it tries
    mixing again after a minute and a half, and waits longer each time that fails). So the same crossfade can look
    different on a new and an old device: a slow dissolve here, a change of worlds there. To look at one way on any
    device, add `?blend=mix`, `?blend=fade` or `?blend=dip` to the address of Dreamy Eyes or of a dream window.
  - **Measured** (the real pages in a headless Chromium, processor slowed four times, as for the worlds above):
    with one world Dreamy Eyes draw 34 frames a second in Classic and 23 in Engraving or Aurora, with a lasting mix
    of two worlds 10–11; a dream window at full resolution draws 8, 6 and 3 with one world and 2–3.5 with two. A mix
    costs a little more than both worlds together. Left to decide for themselves (processor slowed six times), the
    eyes and the windows went over to one world within a few seconds. Nothing was measured on a real old phone.
  - The eyes and the windows only hear of the worlds (the world, the second one, how far the crossfade is); their
    codes cannot set any of it, and neither can a guest.
- **Feminine eyes:** an almond shape with the outer corner a little lifted, a soft rose-violet eyeshadow with a little
  shimmer, a winged liner, full lashes that grow longer and curl towards the outer corner (a few fine ones below). **The brows
  come only with the hints** (see above) and show a feeling then: surprise (someone very close, waking up, a dream turning
  wild), joy (someone smiles at them), sadness (with the tear of light), doubt (one up, one flat, when they cross their eyes),
  a frown (rarely, in a dark wild dream) or curiosity – then they fade again. **Their look changes softly** every two minutes or so: rose, smoky (grey
  with a long wing), golden (with glitter), nymph (turquoise, long lashes) or doll (no wing, very long lashes, round
  brows).
- **Behind the eyes the dream shines through the night** – through drifting clouds, a huge breathing spiral of soft
  lights or a kaleidoscopic flower of rings; the masks change every minute or two
  or so (upright a little calmer), the dream behind them slowly
  zooms and wanders, a little brighter than on the stage. Every two to four minutes a **dream window** opens for 6–10
  seconds: the night opens wide and the dream shows clearly behind the eyes, then it softly withdraws behind the masks. Right behind the eyes it stays darker, so they stay clear.
- **Faces drawn in light, only hinted:** with the hints a face of light appears around the eyes, another one each
  time, and the eyes become its eyes – first only its sign: the goddess's diadem of rays, the cat's ears, the snakes
  above Medusa's brow, the mermaid's crown of shells, the forest spirit's crown of leaves with the leaf on the brow and
  glowing spores, the moon priestess's crescent. In the rare moments hair, outline and a closed mouth join them as a
  breath (flowing hair, twitching whiskers, writhing snakes, hair like seaweed, vines, a veil and long earrings). The
  dream fills the lines. None of them has a nose.
- **You in the dream:** whoever stands in front is mirrored in the iris – faintly all the time, and every two or three minutes
  for a few seconds very clearly, as in real eyes: then it is the person alone, cut out from the room (on the
  phone) and running out softly at their edge, the face as the camera sees it, and behind them the iris keeps dreaming. Now and then (every three to five
  minutes, only while someone is there) the person appears as a **moment**: first in the two pupils, as if seen through
  them, then the windows open and for 3–4 seconds they stand in a soft cloud in the middle of the screen, a little
  smaller and lighter than a painted face – **seen as in a dream, not as a photograph** (#229): the whole picture
  wavers gently as through water or the shimmer over a fire (the face less than what is around it), the person has no
  outline but **runs out into mist**, with a delicate fringe in the dream's colours, and they come soft and blurred.
  **In the middle of the moment the face is clear for a second or so – the real camera picture, so people recognise
  themselves** – then it blurs again. Around them is the dream: the dream's picture instead of the room, a soft glow,
  fireflies, and sometimes a wreath of blossoms, a mandala behind the head or veils of mist. Then the picture does not
  simply fade: within two or three seconds it **comes apart into the dream** from the outside in – its pieces are
  drawn out into drifting streaks and leave sparks, the face last, the fireflies fly away, and at the end the mist
  that is left blows away – while the eyes return (about 9 seconds in all). On a weak phone the picture is drawn
  smaller and wavers in coarser strips; it stays smooth. **Someone who just comes** (after a while with nobody) is greeted
  at once – very clearly in the iris or with this moment, in turn.
  **What happens with the camera picture:** all of this is drawn on the phone itself, from the live camera and a mask
  of the person found there (selfie segmentation, about 250 KB); no picture and no word about who stands there is sent
  for it, and nothing is kept. The dream look is drawn too, not computed: plain canvas drawing on the phone (strips
  moved a little aside, a small copy scaled up for softness), no model and no AI. The AI does **not** repaint people: the dream portrait the Mac used to paint from the
  eyes' camera picture is gone (and `DREAM_YOU_EVERY` with it) – the Mac paints only the fantasy faces below, from
  words. The one thing that leaves the phone is what Dreamy Eyes are for: the front camera you lend to the dream
  (below, “One camera at a time”), passed on to the stage as it is and kept nowhere; tests guard both.
- **Now and then they mirror you:** for a few seconds, every two or three minutes while someone stands in front, the eyes
  copy their expression – a blink or wink (the matching eye), a squint, eyes opened wide, raised or lowered brows – then
  they go their own way again.
- **Your silhouette as a mask:** now and then, only while someone is there, the dream shines through the outline of
  the person in front (selfie segmentation on the phone, about 250 KB, nothing is sent or kept).
- **Dreamy loves fire ❤️‍🔥 (#162, #218):** when the camera sees flames, the eyes are enchanted. What counts as a flame is
  strict, so that a warm room is no fire: very bright, saturated orange-to-yellow light (close to the rule of #162) with
  a core as bright as the camera can show, that **flickers the way a flame does** – its size and its shape both keep
  changing, irregularly – for most of a second (about 0.8 s) before the eyes believe it. Found on the phone, about 15
  times a second. No fire are: a still orange lamp, a lamp while the phone is touched or carried, a lamp being dimmed,
  warm walls and a dim warm room in a noisy camera, the camera hunting for its exposure, warm LEDs beating with the
  camera's shutter (they go up and down evenly and keep their shape), a screen with warm moving pictures, a face or a
  hand in warm light. A small flame counts only when it is swung (poi); a small flame standing far away, or a flame that
  does not flicker at all, is no more than a lamp.
  **To see what the eyes take for fire in your room:** open Dreamy Eyes with `?debug` at the end of its address (after
  an existing `?…`: `&debug`). A corner then shows the camera sample in grey, warm light in yellow (its bright core
  white) and what counts as fire in red, with the numbers beside it: how sure they are (fire from 0.70), the strength,
  and for the liveliest patch its size, the share of its core and its jumps (fire above 4).
  - **They follow the fire at once.** Their gaze goes where the flame is in the picture (within about a tenth of a
    second) and stays on it while it moves. Everything follows its **strength** without steps: how wide they open, how
    high the flames stand at the bottom of the screen (highest on the flame's side), how many embers rise, how deep the
    blush is. When it **flares up** (or catches) the pupils widen, a shower of sparks flies in from where the flame is
    and the night glows for a moment. When it **dies down** they grow calm: the lids sink, flames and embers thin out;
    once it is gone (1.5 s without) a moment of longing – then they go on as before.
  - **Their mood changes every 10–20 s** with much fire or a flame that dances – a lone candle is taken more gently (up to
    20–40 s a mood, a few sparks only) –, never the same twice in a row: **spellbound** (wide open, a hypnotic pupil –
    see below), **playful** (star pupils, a wink now with one eye, now with the other, sparks flying from it),
    **dreamy** (half closed, embers drifting in the iris, the gaze drifting after the flame), **in love** (glowing heart
    pupils that beat, little burning hearts, the deepest blush) and now and then the **fire spirit**: while the fire
    lasts the Mac paints her anew (at most once a minute, as before) and she comes burning through the pupils; every
    other painted face is surrounded by flames and embers meanwhile.
  - **They get used to it.** A fire that only burns on becomes the background after about 30 s (fading over the last
    8 s): low flames, a few embers, embers in the iris – and the eyes look around, at people, have their moods and
    visitors again. Flaring up or a flame that wanders (poi) makes it all new at once, with the next mood, for 6 s
    before it fades again; a fire that keeps moving never becomes the background. Nobody falls asleep beside a fire.
  - Nothing of this asks the Mac for more: the phone finds the fire itself in a 96 × 72 sample of its camera (about a
    millisecond per look with the processor slowed down four times), and all it draws are a few more dots.
- **Rarely a trance – the third eye 👁 (#172):** when much is intense at once – the dream much livelier than usual
  and someone looking at the eyes for a while or seen lately (or fire, mirroring, the dream window, petting) – or the
  dream simply stays that lively for about 8 s (in a dark room the camera may see nobody) – and at most about every 12
  minutes (now and then without a reason): the two eyes calm down and close, a glowing third eye opens above them with
  an iris of the dream, mandala rings turn against each other around it, a tunnel of rings flies towards it, then
  everything is pulled spiralling into its pupil and the dream shows large and clear through it; it closes into a
  glowing dot that fades, and the two open again (about 18 s, drawn on the phone only). In Dream Control on the card
  “👀 Dreamy Eyes”: **👁 Trance now**, and how often it may come by itself (only by hand, rarely ≈ 25 min, now and
  then ≈ 12 min, often ≈ 5 min; kept in `~/.local/state/dream/eyes.json`); on the Mac the same in the panel under
  “Output” (button, choice, key **E**). Before it opens, the third eye can be sensed: while petting deepens (from about
  4.5 s on) it shows faintly and opens a crack, more and more – and now and then it shimmers through for a moment by itself.
- **Touch the screen:** they look at your finger and follow it; a soft light glows under it, a ring of light opens where
  it lands and a trail of sparkles follows it; poke an eye and it
  flinches shut (three quick pokes and they frown and cross their eyes); stroke over the screen (anywhere) and they half close
  contentedly, with heart pupils – keep petting and it grows: they blush, little hearts rise, a rosy glow and a purr,
  by the time of petting – blushing after about 2 s, hearts
  about 3 s, a glow about 5 s, a purr about 6 s – and after about 10 s of petting the third eye opens (the trance, see below); it ebbs away when you
  stop; tap the night and a bloom of light opens there, a double tap makes them sparkle; a
  long press turns the iris into another world; two fingers apart or together widen or narrow the pupils.
- **An organic rhythm:** a temperament that drifts slowly over minutes – sometimes calm and dreamy, sometimes playful –
  sets how often moods, feelings, masks and apparitions come; nothing follows a fixed beat.
- **Now and then a face painted by the AI takes the eyes' place:** while Dreamy Eyes look on and the Mac computes
  locally, it paints a face about every 50 seconds – 24 dream faces in a shuffled round, about a third of them men:
  goddess, cat, Medusa, moon goddess, dryad, siren, fire spirit, ice queen, star woman, blossom fairy, oracle, clockwork
  lady, owl woman, masked lady, aurora, raven witch, nebula, and sun god, green man, sea king, star sage, faun, dream
  pharaoh and moon knight – in the mood of the dream's
  current prompt (a single quick AI step, about 0.4 s, the first one a few seconds; the stage barely notices). Every
  four to eight minutes one of them comes through the pupils: it appears inside them as if seen through mist – soft, pale, veiled, with no edge –,
  the two windows grow with glowing rims, turn a little and open into a **dream cloud** – the face inside soft puffs that
  drift and change shape, a glow of the dream around it, the dream still visible beyond – where it stays three to five seconds,
  breathing, swaying and drifting a little; then it shrinks back into the pupils, and the eyes are there again.
  The pictures stay in memory only and never go into the gallery; only the eyes (and Dream Control) may fetch them.
  `DREAM_AIMASK_EVERY=…` in `~/.config/dream/dream.env` changes how often one is painted (seconds); `DREAM_AIMASK=0`
  switches the painted faces off altogether (no fire spirit either: Dreamy Eyes never make the Mac load a model). With the cloud GPU
  there are no painted faces.
- **The pupils change shape:** a cat's slit while the cat's face of light shows, hearts when someone keeps smiling, stars when they
  are surprised, a turning spiral when they hypnotise (or are spellbound by a fire). About one time in four (#218) it is
  a soft shimmer instead of the spiral, never the same one twice in a row: lights turning like a mandala, lights sinking
  like snow, rings sinking into the depth, or a slow swirl – half transparent, in the dream's colours (like embers by a
  fire), breathing with the music's beat (without music: with the dream).
- **The iris is a world that changes** every minute or two: the dream itself, the dream folded into a kaleidoscope,
  a vortex of the dream with rings turning against each other, or a spiral galaxy in the dream's colours.
- **Moods now and then:** they wink, cross their eyes, roll them, hypnotise, shed a tear of light that bursts into
  stars, or sparkle. Nobody there for a long while and a calm dream: they slowly fall asleep and little z's drift up –
  whoever comes wakes them with a start (star pupils, sparkles). Livelier dream: more often.
- **Around the eyes** appear clouds, blooming light spirals, mandalas, growing fractal trees of light, fluttering light
  moths, iridescent bubbles, ribbons of northern light and little moons circling an eye – all in the dream's colours,
  more often when the dream is lively. If the phone runs short, these go first (never the camera); if it is still short,
  the eyes are drawn with fewer pixels (a little softer) until it keeps up again – easier on battery and warmth.
- The face model (about 4 MB) is fetched once by the Mac with the other movement files and cached in
  `~/.cache/dream/mediapipe`.
- **Setting up:** Dream Control → card **“👀 Dreamy Eyes”** → “Show the code for the eyes phone” (or on the Mac: panel →
  “Output” → **👀 Dreamy Eyes**) → scan it with the eyes phone. Once on that phone: install Dream's certificate (see “Dream Control over https and as an app”) – the browser
  gives the camera out only over https. Tap **“Open the eyes”** (fullscreen, the screen stays on). To keep it there:
  Android “App pinning” (Settings → Security → App pinning, then pin the browser via the app overview), the phone on
  power, in a holder at eye height.
- **Its code may only lend the front camera** and see the dream – no settings, no commands, nothing that costs money; it
  does not even learn the prompt. Beside the small picture of the dream it is told two numbers: the master brightness
  and (#218) the music's beat, a pulse between 0 and 1 – never what the stage tells its output windows (effects, fades,
  prompts); a guest's preview hears no beat. Its key is its own (`~/.local/state/dream/eyes-token`) and a cookie of its own, so
  trying the eyes on your own phone never replaces Dream Control.
- **One camera at a time:** the stage shows “👀 Live camera: Dreamy Eyes”. In Dream Control the card “This device” says
  who lends the camera, **■ End** stops it (the eyes say so and wait for a tap), and starting your own live camera
  takes over. The stage then goes back to the dream, never to the Mac's camera by itself.

<sub>[↑ Contents](#contents)</sub>

---

## Dream windows – old phones and tablets as windows to the dream

<p align="center"><img src="docs/images/windows.webp" alt="Six dream windows, the dream drifting through each as clouds: a large eye, a painted face, a Penrose triangle, the endless staircase, the third eye in its triangle and a mandala" width="840"></p>

Any number of old phones and tablets around the room become windows to the dream. Nothing to assign, no roles: every
window shows **one large, living motif**, the dream drifts around it as clouds, and now and then a motif wanders from
one device to another.

- **One large motif per window:**
  - a **large eye** – the very eye of Dreamy Eyes: iris fibres, lids, lashes, and a brow only with the hints (#220:
    every minute or two, by Dream's clock – both eyes of a pair raise theirs together). It looks
    around, blinks, its pupil widens in a dark dream and with the beat, and its iris is the dream – plain, folded into
    a kaleidoscope, a tunnel or a galaxy; rarely (about one time in ten, every 47 s) its pupil hypnotises for a few seconds (#218: the
    spiral or one of the soft shimmers in turn, breathing with the beat – the same in both windows of a pair);
  - a **pair of eyes across two devices**: one eye each, looking and blinking together;
  - a **dream face**: a face painted by the AI, alive (see below);
  - **impossible shapes**: the Penrose triangle, the endless staircase (a light climbs it and never arrives), the
    devil's fork and the impossible cube – slowly turning, every face filled with another part of the dream;
  - the **third eye** in its triangle of light, and a **mandala**: the dream folded twelvefold under turning petals.
- **The dream as clouds:** the dream is no picture in a frame. It shines through soft fields of cloud that drift, turn
  and tear open, with darkness between – no rectangle, no hard edge. The clouds swell with a breath all windows share
  and glow on the beat. Small beings of light (moths, bubbles, northern lights, little clouds) drift through and on
  into the next window.
- **Wandering:** every one to three minutes a motif dissolves into clouds and forms again on another device a few
  seconds later; the device it left gets a new one. Dream hands the motifs out by itself, and no two windows show the
  same one at a time – except the pair of eyes, which now and then opens in two windows next to each other (in the
  order they connected) and later moves on or closes. Only with more windows than motifs (nine or more) one is shown
  twice. A single window changes its motif the same way. `DREAM_WANDER_EVERY=…` in `~/.config/dream/dream.env` sets
  the shortest pause in seconds (default 60; the longest is three times that) – e.g. 10 to watch it while setting up.
- **Living faces:** where a painted face has its eyes, brows, mouth and outline is found **once per painted face, on
  the Mac** – by the stage, in a background worker, with the face model Dream has anyway (well under a second per
  face; the stage's own drawing never waits for it) – never by a window and not again for another window. The 82
  points travel with the face (under 1 kB). Every window moves them itself over a net of triangles: it blinks, lets
  its gaze wander, smiles, lifts a brow, breathes and tilts and turns its head a little – subtle, like a painting
  that is alive. A picture in which no face is found (a cat, a mask), or one painted while no stage is open, is shown
  still.
- **One organism:** all windows breathe together and pulse to the beat, and now and then a wave of light runs
  through them in turn. When Dreamy Eyes go into trance, the third eye opens in every window too (and the painted
  faces close their eyes); when someone pets the eyes, a rosy shimmer runs through the windows and the faces smile.
  They dim with the stage's master fader.
- **Light on the Mac:** Dream only says which motif a window shows (its kind and a random number, about a hundred
  bytes per change); every window draws by itself. The Mac's work does not grow with the number of windows: the
  points of a face are found once, whoever looks.
- **Old devices:** a window that can't keep up draws with fewer pixels (in four steps, down to about a third), with
  coarser clouds (a smaller field, no fine wisps, every other frame), moves a face less often and folds the mandala
  eightfold – and goes back up when it can. Everything is drawn with the plain 2D canvas; it needs no WebGL and no
  certificate (plain http in the home Wi-Fi), and it keeps the screen on.
- **Setting up:** panel → “Output” → **🪟 Dream windows** (or Dream Control → card **“🪟 Dream windows”**) → scan the
  code with each device and tap its screen for fullscreen. The output line in the panel counts the connected windows.
- **They only look:** a window's key (`~/.local/state/dream/window-token`, a cookie of its own) opens the window page,
  the dream's pictures and the painted faces – no settings, no commands, no camera, nothing that costs money. Where
  a face has its eyes only the stage on the Mac may say, never a window.

<sub>[↑ Contents](#contents)</sub>

---

## Movement

Movement detection is **built into Dream**: the stage detects movement itself on the camera picture, without a second
program, a picture stream or OSC. That saves a lot: the earlier flowtrack program alone needed more than one CPU core
(measured 115–135 %), the built-in detection in the browser about 7–10 % extra, the graphics chip does the rest.

Switch it on and off in the panel or on the phone with the big switch **“Movement: ON/OFF”** (Movement card). Dream
remembers the switch across a restart, like the autopilot. Next to it the kind:
- **Hands (AI):** a body model (MediaPipe Pose, runs on the graphics chip) finds both hands, also in half-light. The
  very first time Dream downloads the model once (about 15 MB, to `~/.cache/dream/mediapipe`), then everything works
  offline.
- **Fire/LED/light trails:** bright points in the picture, up to four. The threshold follows the room's brightness: in
  the dark a torch is enough, in a bright hall only really bright lights count.

**Calibrate (camera ↔ projector):** if the camera stands at an angle or to the side, effects, painting and light land
a little beside the person without matching. **📐 Calibrate** in the Movement card (movement must be on, camera and
projector fixed): stage and output window turn black and show four white points one after another; Dream finds each
point itself in the camera picture (it compares the picture with and without the point) and measures the delay
projector → camera on the way. If the camera does not see the projector (infrared camera), hold a lamp at the point or
click it in the camera picture of the diagnostics (it opens by itself for this). Afterwards all movement values –
points, hands, skeleton, light trails – lie in the projector picture. The calibration is saved, **Reset** deletes it,
**✕ Cancel** ends the run. Calibrate again after moving the camera or the projector.

**Subtract the projection** (checkbox below Calibrate, needs the calibration): a normal camera also sees the
projector's picture – the light detection would take bright parts of the projection for fire, changing pictures for
movement. With the checkbox Dream subtracts its own picture: it knows exactly what it shows, maps it into the camera
picture with the calibration, takes the picture from before the measured delay (±40 ms leeway), matches the brightness
itself and subtracts it from the light detection and the movement tracking. The hands AI gets the unchanged picture
(the projection hardly disturbs it). The diagnostics (D) show how much is subtracted. In a test with a simulated
projection the false detection fell from over 80 % of the pictures to 0 %, a light point was still always found. An
infrared camera does not need it (it does not see the projector at all).

**Camera for movement** (next to the switch, also on the phone): “as picture” or its own, e.g. an infrared camera
with an IR lamp that sees in the dark and does not notice the projection, while the normal camera gives the picture.
Dream remembers the cameras by name, also across a restart. If a chosen camera is not connected, it stands in the list
with “(not connected)”, Dream takes the default camera meanwhile and says so; when it is plugged in, Dream switches by
itself. The names appear once the browser was allowed to use a camera.

**More reliable light:** in the fire/LED mode Dream searches at 320×180 (small, distant LEDs are found). **Light
colour:** “anything bright” (fire, any LED) or an **LED token** in green, magenta, blue or red – then only that colour
counts, lamps, windows and white walls no longer disturb (in a test with a bright room and a window: “anything bright”
stuck to the window 86 % of the time, the green token was found in 100 % of the pictures). Best a colour that rarely
occurs in the visuals. **Short exposure:** where the camera lets the browser do it, Dream sets a short, fixed exposure
in the light mode – the room turns almost black, only lights remain, hardly any motion blur; for hands it goes back to
automatic. The diagnostics say “short exposure” or “the camera allows no fixed exposure” (some cameras, e.g. the
iPhone, do not allow it).

**Fast movements:** the camera runs at up to 60 pictures per second, every picture is analysed. The AI model computes
at most about 30 times per second (less on slower graphics); in between, and when a fast hand is only a blurred
streak, Dream follows the moving pixels (picture difference) near the hand – speed and direction are kept. A prediction
makes up for the delay: without calibration 80 ms, with calibration exactly the measured delay projector → camera plus
the computing time (at most 150 ms, so a jolt does not overshoot).

**Delay (latency) – where it comes from and what helps:** the last line of the diagnostics (D) shows how old the
camera picture is, how long the detection computes, the measured delay projector → camera (after calibrating) and the
prediction.
- **⚡ Fast (dance/flow)** in the Movement card (also on the phone): the movement values follow at once instead of
  calmly smoothed, smoothing off, 1 step and 384 px (more AI pictures per second), little dream share. Pressing again
  restores the previous values; the switch survives a restart.
- **Visible at once** are the effects, touching and light (60 pictures/s, to the output window 60 times a second).
  Everything the AI paints anew (painting, content, pose) always has the delay of one AI picture.
- **Smoothing** drags the picture behind (at 45 % about half a second) – for dance set it to 0. **Transformation 0**
  shows the camera picture without AI at the full frame rate; even 0.02 sends every picture through the AI.
- **A USB camera** instead of iPhone/Continuity (often saves over 100 ms), best with 60–120 fps. **Projector** in game
  mode if it has one; the stage directly on the projector saves the transfer to the output window.

**Poor light:** for the detection Dream brightens the camera picture automatically (up to ×4) and raises the
contrast; the thresholds for hands are low, a smoothing (One Euro filter) prevents jitter. The picture on the
projector does not change.

**Off really means off:** camera closed, no detection; movement, diagnostics, pose and direct interaction have no
effect and cost nothing. If there is no camera or no model, the stage shows a red warning at the top. **Key D** shows
below the preview what the detection sees: the camera picture faintly in the background, the points with their trail,
speed, values per second, light (how much brightened), “fast (blurred)” when the picture-difference tracking helps,
and the model's computing time.

**Direct interaction** (panel below “Movement” and on the phone): the hands act exactly where they are – at once and
fitting the content.
- **Paint:** the hands draw glowing trails in the colours of the picture under the hand (faster = wider and brighter).
  The trails appear at once and go into the next AI picture – the AI dreams them on to fit the prompt: with fire into
  tongues of flame, with an ocean into waves, with cosmos into star trails. They fade after about a second.
- **Touch:** the hands push and swirl the picture like a liquid, at the full frame rate; the AI paints the swirl on.
  When you let go, it glides back.
- **Content reacts to energy:** for each prompt the local language model writes a calm and a wild addition fitting
  the scene (ocean: “moonlit waves, soft mist” ↔ “raging tempest, crashing waves, foam”; visible in the panel). The
  faster the hands, the more the content turns wild – not just “more effect”. Without Ollama general additions apply.
- **Impulses:** a fast hit or an abrupt stop sets off a wave with a bright core exactly at the hand, in the picture's
  colours; the AI dreams it along.
- **Light in the dark** (off by default): the dream is bright and alive only around the hands, the rest lies in the
  dark – the faster, the larger the light circle. Fits fire and poi.
- **Directness** controls it all (0 = off), **Mirror** flips left/right if the camera sees mirrored.
- **Movement shapes the effects** (the more direct, the more; 0 = as without movement): tunnel, kaleidoscope, mandala,
  waves and feedback have their centre at the hand and move with it, fast hands make the effects stronger and faster,
  calm ones let them fade. The swipe direction sets the turning direction of kaleidoscope and mandala and the
  direction of the RGB shift. A hit or abrupt stop is a beat from the movement (effect push and a short flash). If no
  effect is chosen, movement brings a light effect of its own from about half directness (RGB shift and afterglow)
  that vanishes when still. Projector and Wi-Fi output show it too. Clearest with “On: hands by AI” and a little less
  drift.

**Diagnostics:** key **D** (or “Diagnostics below the preview” in the panel) shows below the preview what the
detection sees: a small map (the camera picture faintly behind) in the picture format with the tracked point and its
trail, all points and the cross the dream turns around, next to it speed, spread, values per second, light and whether
someone is there. The picture itself stays free; the display does not go to the output, Syphon or the AI. Switched
off, it draws nothing and frees its memory. With the panel hidden (H) the diagnostics are not visible either.

With the detection on, Dream reacts (switch “react to movement”, slider “Movement” up to 3× – also on the phone). The
movement makes a pull of its own around the tracked point – also in camera and video mode and when zoom and rotation
are at 0; while moving, more of the previous dream picture flows along. The values are smoothed, a calm hand gives a
calm dream:
- **x/y** of the tracked point becomes the centre of zoom pull and rotation – the dream swirls around fire, poi or hand.
- **speed** → stronger transformation, faster rotation and colour drift.
- **spread** (distance of props/hands) → more zoom.
- **present** → nobody there: calm; someone comes: a light impulse.
- **Rules** trigger scene changes if you want: “Fire on” (someone/something there, 0.3 s), “Fire off” (2 s nothing),
  “Fast” (speed above 1 for 0.5 s, at most every 4 s), in `~/.config/dream/motion.json`:

```json
{"rules": {"Fast": "next", "Fire on": {"playlist": "Fire"}, "Fire off": {"playlist": "Calm"}}}
```

<sub>[↑ Contents](#contents)</sub>

### Dreaming light trails (input “Light trails”)

Switch movement on (best fire/LED) and choose the input **“Light trails”**: Dream draws the light trails itself
(orange, glowing, fading after about a second), and the AI dreams on the real fire, poi or body trails – dragons, mist,
tendrils, depending on the prompt. Tips: transformation 0.65–0.8 (the trails are bright on black, the AI needs some
freedom), dream share 0.3–0.5 for flowing transitions.

### Keep outlines (ControlNet)

In the card “Input & prompt” (with camera, picture, video, light trails): **Keep outlines (the body stays
recognisable)**. Dream takes the outlines (thin edge lines) from the input picture and gives them to the AI as
guidance: body, arms, furniture, stage stay recognisable even with a strong transformation, only surface and content
are dreamed – the most direct link between your movement and the picture. **Outline strength** 0.6–1.0 is a good range
(more = closer to the camera picture, less freedom for the dream). Combines with “Pose shapes the figure”.

Drawbacks: the first time Dream loads an extra model (SD-Turbo ~0.7 GB, SDXL-Turbo in the cloud ~2.5 GB); every picture
needs a little more computing time (measured on the Mac 275 → 296–318 ms) and memory; the outlines come from the whole
picture, so also from room and furniture, not only from the body; in the dark (noisy camera) they get more restless.
Best with a cloud GPU.

### Pose shapes the figure (ControlNet)

With the movement kind “Hands (AI)” Dream knows the person's whole skeleton and draws it in OpenPose style. Switch on
“Pose shapes the figure”: a ControlNet makes a figure appear in the dream in exactly this posture – it dances along.
The prompt decides *what* kind of figure (e.g. “dancer made of glowing fire ribbons”). “Pose strength” sets how
strictly the posture is kept (0.8–1.2 good).

- Locally with SD-Turbo: ControlNet `thibaud/controlnet-sd21-openpose-diffusers` (~0.7 GB, downloaded once), about
  0.5 s per picture on the M2 Max – jerky, but clearly visible.
- In the cloud with SDXL-Turbo: `xinsir/controlnet-openpose-sdxl-1.0` (~2.5 GB, Apache 2.0) – more fluid and nicer.
- Pose does not raise the transformation: the figure comes only from the pose strength. With a strong transformation
  the stage pulls the starting picture a little towards grey so that the figure stands out against the colourful
  dream; with a gentle one the picture stays as it is. For a clear figure: transformation 0.6+ and pose strength
  0.8–1.2.

## MIDI controller

A MIDI controller with faders and knobs (e.g. an older USB controller with 8 faders, a master fader, 24 knobs and
transport buttons) controls Dream live. Dream reads it directly on the Mac – whatever browser, also with the output on
the projector. USB controllers macOS recognises without a driver (“class compliant”) work at once; check under Audio
MIDI Setup → Window → Show MIDI Studio. Devices with round 5-pin sockets need a USB MIDI interface. Plugging in and out
during operation works; Dream looks for devices every 3 s.

**Mapping (MIDI learn):** in the panel under “MIDI controller” (or on the phone under “MIDI · master”) choose a target,
click **🎛 Learn**, then turn the knob or press the button on the controller – done. The list below shows all mappings,
✕ deletes one. Saved in `~/.config/dream/midi.json` (not in the repository), so they also hold after a restart. Which
numbers the controller sends depends on its preset – just choose a preset and stay with it.

- **Slider targets:** transformation, dream share, zoom pull, rotation, colour drift, drift, music reaction,
  movement, pose strength, **master brightness** (0 = black; acts on stage, output window and Syphon), effect
  strength and the crossfade between two style worlds (#224).
- **Button targets:** pause/start, next scene, new, new seed, **blackout on/off** (master to 0 and back), tap tempo,
  next pattern, next style world (#221; #224: the one after the world that shows most), each of the twelve effects on/off, roll effects anew, effects off.
- Sliders glide softly to the new value (no jumps) and move along in the panel and on the phone. Endless knobs (that
  only send “more/less”) are recognised by Dream after a few clicks.
- Suggestion for 8 faders + master: transformation, dream share, zoom pull, rotation, colour drift, drift, music
  reaction, movement; master fader = master brightness; buttons ▶ pause/start, ▶▶ next scene, ◀◀ new, ■ blackout.

<sub>[↑ Contents](#contents)</sub>

## Sensor input (movement in the dark: phone on the arm, later a wristband)

Movement sensors on the body work in the dark and with very fast movements too. Dream takes anything that sends
numbers by OSC (UDP, port **7020**; another port: `DREAM_SENSOR_PORT=…` in `~/.config/dream/dream.env`) – only from
devices in the home network. Without an extra app: the Dream Control device itself sends its motion (“🧭 Motion”, see
“Live camera and motion of the Control device”); its channels are called `/device/…`.

**With the phone on the forearm** (Android e.g. the app *Sensors2OSC*; iPhone e.g. *ZIG SIM*):
1. Start Dream with `./dream.sh --lan` (otherwise it only accepts data from the Mac itself).
2. In the app enter the Mac's IP (`ipconfig getifaddr en0`) and port 7020 as the target; switch on acceleration,
   gyroscope and orientation (or rotation), start sending.
3. In the panel under **Sensor input** “… values/s from …” appears, below it the readings as bars.

**Mapping:** choose a target (e.g. zoom pull), click **📡 Learn** and make exactly the movement it should control for
2 seconds (e.g. arm up/down). Dream takes the reading that now moves clearly more than before. ⇅ reverses the
direction, ✕ deletes. Every reading is smoothed and adapts its range by itself – no calibration. Saved in
`~/.config/dream/sensors.json` (not in the repository).

**Hit (whip):** a strong, jerky movement is an impulse (at most every 0.25 s). Under “Hit →” set what it triggers:
flash, spin jolt, new motif, next scene or blackout; “Hit sensitivity” sets how strong it must be. **Swing** (how
fast the wrist turns) shows in the panel. The values run through the same soft gliding as with the MIDI controller.

Ideas: arm height → zoom pull or master brightness, turning the wrist (roll) → rotation, tilting → colour drift,
hit → flash. A planned wristband and finger glove send in the same format.

<sub>[↑ Contents](#contents)</sub>

---

## Cloud GPU

A rented GPU computes much faster than the Mac, especially SDXL-Turbo and the style models. Two providers:
**Scaleway** (Paris, billed in €) and **RunPod** (data centres in Europe, billed in $ per second). Under “Computing” →
**Cloud GPU** the list has both; start, delete, the cost display and the automatic deletion after 2 hours work the
same way. After every restart Dream first computes locally again – the cloud is not remembered, so it is never chosen
by accident. Camera, picture and video frames and the prompt then go to your own machine at the provider; speech and
music analysis stay on the Mac.

**Starting:** choose the GPU, **Start**. A question shows the price and three buttons: **“Start – if not free: RTX
5090 …”** (falls back to the other RTX, 4090 ↔ 5090, each in the same kind secure or community), **“Try only RTX
4090”** and **“Cancel”** – Cancel (or Esc) starts nothing. A running GPU is never switched, the H100 has no fallback.
The card Computing shows what is happening; **Delete** ends it at once.

**Compiling and the compile cache:** on the cloud GPU the model is compiled for the card before its first picture
(torch.compile, TF32), slim in one variant. `dream-cloud` brings the compiled code to the Mac as a **cache**
(`~/.cache/dream/compile`, per GPU type, PyTorch version and model) and takes it to the next machine: the **first**
start on a GPU type takes a good 6 minutes until the first picture, later ones about 4 (measured on an RTX 4090). With
a style reference picture in the cloud, its technique comes with the first reference picture; the cloud then paints
uncompiled (measured about 4.5 instead of 5 pictures/s) – if a reference picture is chosen at the next start, it is
compiled in at once. If compiling fails, the model simply runs normally (switch it off: `DREAM_COMPILE=0`).

**Overlapping pictures:** with live inputs (camera, video, light trails) two to three pictures are on their way at the
same time, so the GPU does not wait for the way over the internet; with “Dream only” and “Picture” each picture builds
on the previous one, so it stays one. Below the preview it says “… pictures/s · GPU … ms · way … ms · overlapping”:
GPU = computing time per picture, way = transfer.

**Saving the line (automatically, cloud GPU only):** pictures go both ways as WebP instead of JPEG, live inputs go up
at 5/8 of the size, the cloud scales them back to full size before dreaming; the picture comes back at full size, the
projector stays sharp. “Dream only” and “Picture” stay at full size (they build on the last picture and would get
softer round by round). With a camera picture the upload fell from about 57 to 25 KB per picture, the download from
79 to 46 KB. Below the preview: “↑ … KB ↓ … KB”.

- The machine is **deleted automatically after 2 hours at the latest** (a timer on the Mac; in addition the machine
  switches itself off). If the Mac is off in that time, check yourself: `./dream-cloud status`.
- The panel and Dream Control show the GPU's state without asking all the time (#176): Dream looks itself – every
  few seconds while a GPU starts, stops or is in use, every half minute otherwise, rarely while no provider is set up –
  and tells them. Guests see nothing of the cloud.
- In the terminal:

```bash
./dream-cloud status
./dream-cloud start --type runpod:RTX-4090 --model sdxl-turbo
./dream-cloud stop
```

`stop` deletes machine, disk and IP. Nothing costs afterwards.

<sub>[↑ Contents](#contents)</sub>

### Scaleway: set up once

```bash
brew install scw
scw init
```

`scw init` asks for access key and secret key (they stay in `~/.config/scw/config.yaml` on the Mac); choose the default
zone **fr-par-2**, telemetry **no**, **add** the local SSH key. `dream-cloud` creates machines only in the default
project of this configuration (`scw config get default-project-id`).

**SSH key:** Scaleway console → IAM → SSH keys – the key from `~/.ssh/id_rsa.pub` must be there, otherwise Dream does
not get onto the machine (it costs anyway, until `dream-cloud stop`).

**GPU quota:** new accounts are often not allowed to create a GPU (“quota exceeded … 0/0”). Check in the Scaleway
console → Organization → Organization Dashboard → tab **Quotas**, product “Instances”, search “L4”: if L4-1-24G shows at
least 1, it works. Otherwise have it unlocked: **“Verify ID”** at the top or **“Contact support”** with “Instances,
L4-1-24G, fr-par-2, quota 1”. Prices: L4 (24 GB) about €0.79 per hour, L40S (48 GB) about €1.47, H100 (80 GB) about
€2.87; every type needs its own quota.

### RunPod: set up once

1. An account on runpod.io, top up credit under **Billing** (from $10 for many hours). Without credit nothing starts.
2. Under **Settings → API Keys** create a key: REST API → **read and write pods** (optionally read billing), nothing
   else. Put it into the keychain on the Mac (it asks for the key; never in files or chat):
   ```bash
   security add-generic-password -a dream -s runpod-api-key -w
   ```
3. An SSH key on the Mac (`~/.ssh/id_ed25519.pub` or `id_rsa.pub`) is enough – Dream gives it to the pod, nothing needs
   to be stored at RunPod. Do not create anything in the RunPod web interface itself (“Deploy” costs at once).

Recommended: RTX 4090 (for Dream as fast as more expensive cards). Billed by the second; a started GPU is yours until
“Delete” (no spot machines). The pod also deletes itself if the Mac is off. Error messages in the card: no credit, no
fitting GPU free in Europe right now (choose another GPU or try later), key without rights. Dream's PyTorch is built for
CUDA 13; on machines with an older driver (12.6 or newer) `dream-cloud` installs the matching PyTorch.

**Measured (RTX 4090):** the GPU computes a picture (512 px, 1 step) in **26 ms** – seven times faster than the Mac
(≈ 190 ms). The picture rate depends mostly on the line, not the GPU: each picture must go up and come back, the way to
the data centre costs ~35 ms. What helps: a faster upload (cable instead of Wi-Fi, fibre), **384 px** instead of 512,
and the line saving above.

---

## When something gets stuck

- **A picture that turns, races or flickers and you don't know why:** look for the orange and red sliders and card
  strips (see “What the sliders show”), or tap **↺ Reset** – it glides back to the defaults and can be undone for 10 s.
- **🔮 Relieve** (title bar of the panel and of Dream Control, not for guests): when Dream gets slow and you don't want
  to hunt for the cause. The face on the button is the load right now – 😌 plenty of power, 🔮 dreams smoothly, 😬 getting
  tight, 🥵 overloaded, 🤯 far overloaded, 😴 paused (smooth means about 3 AI pictures a second on the Mac, 4 in the
  cloud). A tap takes back, one step after the other, what costs most: diagnostics → style model and style reference
  picture (only with SDXL, faded out first – the style goes early) → quality “Fluid” → outlines and pose (their strength
  slides to zero first, then they switch off) → hand detection “Hands (AI)” → “Fire/LED” → resolution 512 px. The model is never
  switched – that stays your choice. After every step it waits a few seconds and measures; as soon as Dream
  runs smoothly it stops, the rest stays as it was. While it works the face exhales (😮‍💨) and the button counts the
  steps with a bar underneath. The chip “🐢 relieved: …” says what was taken back; **↶** puts everything back as it
  was. **The autopilot presses it too** when Dream stays overloaded (🥵/🤯) for 15 seconds, at most every two minutes
  (“🤖 Autopilot relieved: …”).
- **“⚠ Memory short” (red chip, red tile “swapping”):** the Mac pushes memory onto the disk, everything gets sluggish.
  Most common reason: a big language model in Ollama that is still loaded (e.g. from another program). `ollama ps`
  shows it, `ollama stop <name>` frees it (it loads again on next use). Also helps: close unused programs and browser
  tabs, SD-Turbo instead of SDXL-Turbo, 512 px instead of more.
- **The stage stays black or dark:** restart and update Dream (see above). In prompt mode drift helps; an entirely black
  picture after an update usually means the old version still runs.
- **The picture on the stage or in the output window looks wrong (stripes, black, wrong colours), stutters, or the
  AI makes clearly fewer pictures than it used to:** the graphics card draws the picture (WebGL 2) and shares its time
  with the AI. Open the page with `?render=canvas` at the end of the address (http://127.0.0.1:7860/?render=canvas,
  http://127.0.0.1:7860/output?render=canvas): then it draws with Canvas 2D. If that helps, please report it with the
  browser and the Mac. In the first seconds after a start the AI is slower either way (the model warms up) – compare
  after that. A badge “The graphics card’s drawing (WebGL 2) stopped …” means the browser lost its graphics context;
  Dream goes on with Canvas 2D and returns by itself.
- **The controls are extremely slow:** is a second Dream, a second stage or another GPU program running? Keep only one
  stage open.
- **“site can't be reached” on the phone:** see “If the phone does not connect”. The macOS firewall was not the reason
  in a test; Firefox instead of Chrome on Android helped.
- **“Not enough memory for this picture”** (#177): the Mac's GPU memory ran out – choose a smaller size, SD-Turbo,
  or close other programs and AI models (e.g. Ollama). Dream logs every failed picture and dreams on with the next one.
- **“No answer from the AI for a while – reconnecting …”** (#177): the stage got no answer for 10 s (the first
  picture of a connection: 3 minutes) and opens the line anew by itself; a single broken picture never stops it.
- **Speech input shows an error:** restart Dream; really hold key V (too short → “Too short”).
- **Scaleway “quota exceeded”:** the GPU quota is missing, see “Scaleway: set up once”. Dream says so in the Computing
  card (“Start failed: no GPU quota for … – … Quotas”) and switches back to “Local” by itself; nothing costs. The ID
  verification alone is not enough – the quota must also be requested from the support.
- **Chip “☁ …” below the preview:** red means a GPU runs or starts (it costs money); neutral “not started” means the
  cloud is only chosen as the computer. “Delete” is active only when something runs, and shows “Deleting …” and
  “Deleted ✓”.
- **Red movement warning at the top:** no camera (allow access in the browser, connect a camera) or the AI model could
  not be loaded (the very first time “Hands (AI)” needs the internet). Key D shows what the detection sees.

**Still stuck, or found a bug?** Open an issue on GitHub (the form asks for what helps; leave out keys, QR codes and
your own paths). A security problem goes privately – see `SECURITY.md`. Pull requests are welcome, see
`CONTRIBUTING.md`; their authors sign the Contributor License Agreement (`CLA.md`) once, by a comment the CLA bot
asks for.

<sub>[↑ Contents](#contents)</sub>

## Disk space and removal

Locally: the Python environment `.venv` in the Dream folder (about 1.2 GB) and the models in the Hugging Face cache
(SD-Turbo about 2.6 GB, SDXL-Turbo about 7 GB if used locally, style models 10–320 MB each, the reference adapter about
3 GB). Saved pictures and clips lie in `~/Pictures/Dream/`. To remove:

```bash
rm -rf <Dream folder> ~/.cache/huggingface/hub/models--stabilityai--sd-turbo ~/.cache/huggingface/hub/models--stabilityai--sdxl-turbo ~/.cache/huggingface/hub/models--madebyollin--taesd*
```

<sub>[↑ Contents](#contents)</sub>

## Tests

`uv run pytest` runs the automated tests (a few seconds; no model, no GPU, no network – they use a stand-in for torch and
a temporary home folder, so your own settings, keys and pictures are never touched). They check who may do what (every
route of the server for this Mac, Dream Control, guests, Dreamy Eyes and devices without a key), the origin check, the
ranges of every setting, the folders, the home-network certificates, the MIDI, sensor and playlist helpers, the
translations and what keeps Dream running smoothly (the prompt encoded once per prompt, no waiting for a loading model
or a slow device, the state file written once the hands rest, the small preview). `node --test tests/js/morph.test.mjs` (#215) plays the motion between the pictures as plain numbers
(`static/morph.js`) – 1 to 8 pictures a second, uneven and late ones, several requests at once, a pause – and checks
that nothing on the stage ever moves back. `node --test tests/js/beat.test.mjs` tests the beat detection (#195) on synthesised music (house with
room noise, a dotted kick at 100 BPM, a half-time section, a 4-bar break with a drop, drum & bass with taps, music
without drums, a 120 Hz display) and the beat grid. `node --test tests/js/soft.test.mjs` (#211) tests the shares of the soft switches
(old input picture, old and new prompt, a change during a running fade). `node --test tests/js/gl-stage.test.mjs` (#204) opens
`tests/js/gl-stage.html` in a headless Chrome or Chromium (found by itself, or named with `CHROME_BIN`; a software
WebGL is enough) and compares picture by picture what the WebGL 2 chain and the Canvas 2D drawing make of every effect
and every step of the chain (cross-fade, motion, smoothing, touch layers, colours, master; #215: that the smoothed
picture keeps its place when a new picture takes over), plus the fallback when the
graphics context is lost, that the chain draws sparingly (#210: nothing while nothing moves, the canvas no finer
than the picture), and #205: that the morph along a flow field shows a moved picture half-way where the cross-fade
shows it twice – also within the camera's motion – and that the strongest smoothing arrives at the new picture; with `KEEP=1` the page stays open and shows both pictures side by side. `node --test tests/js/window.test.mjs` (#214) opens four dream windows of different sizes in the same browser and is
their Dream itself (it speaks their picture stream): one large motif each, the dream as clouds with darkness between,
the pair of eyes looking together, a painted face that moves by its points and one without points that stays still, a
motif wandering from one window to another, wave, blush and trance, and a weak device drawing fewer pixels; with
`KEEP=1` the windows stay open. `node --test tests/js/vis.test.mjs` (#220) tests the rule itself as plain numbers (`static/dreamvis.js`): only the eyes more than four fifths of the time, hints 60–120 s apart, mouth and outline 4–11 min apart and never above a breath, no jump from one picture to the next, the same for both windows of a pair, no nose at any level – and that the pages draw every line of a face through the rule (no grin, no nose in their code). `node --test tests/js/style.test.mjs` (#221) tests the style layer: the registry in Node (a world by its name, today's look for an unknown name, a part a world does not draw comes from the first world; every world of `settings.WORLDS` is a file `static/world-<name>.js` that registers itself, and the panel and Dream Control offer it), and in the same headless browser `tests/js/style.html` draws today's look through the layer with a seeded random and a clock that stands still – eyes with every look, iris world and pupil, every living thing, the six faces of light with hints and in the rare moment, the six window motifs – and compares small copies with the pictures kept in `tests/js/style-ref.json` (`STYLE_REF=write` keeps the ones drawn now, only when the look is meant to change). It also draws what moved behind the layer with #222 (the night behind the eyes, a window's sky, flames, trance, what surrounds “you in the dream”). `node --test tests/js/worlds.test.mjs` (#222) tests every other world (`tests/js/worlds.html`, the same scenes from `tests/js/style-scenes.js`): every scene is drawn without an error and does not look like Classic; the world draws every part and every window motif itself; its faces show nothing while only the eyes show, leave the place of a nose empty at every level and ask the face rule only for parts it knows; where Classic draws a heart, a star or a letter the world draws a form of its own (nothing is borrowed from Classic, no text is drawn); and no world file talks to the network or exports a picture. `you.test.mjs` runs its checks of the face in every world. **A new world:** write `static/world-<name>.js` (take `world-deepsea.js` as the pattern; register every part), add the name to `settings.WORLDS`, an option to the two selects (`static/index.html`, `static/remote.html`) with its German in `static/i18n/de.json`, the script to `eyes.html`, `window.html` and the three test pages – the tests name whatever is missing. `node --test tests/js/brush.test.mjs` tests the shared brushes as numbers (`static/dreambrush.js`: seeded random and noise, a tile of noise that repeats, smooth lines and swelling bands, the dream's brightness, the lids, the skeleton of a face – in which nothing lies where a nose would be). **A new style world** is one file `static/world-<name>.js` that calls `DreamStyle.register('<name>', { eye, life, face, motif })` with the parts it draws (the rest comes from Classic), one name in `settings.WORLDS`, a script tag in `eyes.html` and `window.html`, an option in the two selects and its German name (the select of the second world, #224, fills itself from the first). `node --test tests/js/blend.test.mjs` (#224) tests the crossfade: the plan of a frame as plain numbers (`static/dreamstyle.js`: one world, or two whose weights add up to 1; a hand on the mix is followed softly; another world comes in a short fade; a device that does not keep up shows one world at a time and does not see-saw, the weakest goes through black), and the real pages – Dreamy Eyes and a dream window, each in a frame of `tests/js/blend.html` with a clock the test steps (`tests/js/still.js`) – in the same browser: what Dream says reaches the style layer, half and half is the mean of both worlds' pictures, every pair of worlds draws with fire, trance and a face, and a weak device never draws two pictures for one frame. `node --test tests/js/you.test.mjs` (#219, #229) draws “you in the dream” for an invented person in the same browser: the person runs out softly instead of ending in a line, in the middle of the moment the face is exactly the camera's picture with nothing over it, before and after it is soft and wavers, the room is never shown, and the picture leaves by coming apart into streaks, the face last, until nothing is left; and the drawing's code uses no network, no model, no blur filter and no loop over a large picture. `node --test tests/js/sliders.test.mjs` (#216) tests the sliders: the rules (influence, fill, snap, colours) in Node and
`tests/js/sliders.html` in the same headless browser (zero mark and button, double tap, shimmer, card strips, the
reset button). `node --test tests/js/signs.test.mjs` (#217) tests the moving signs and the shape: slider → sign (kind,
strength, direction, the real tempo, standing still at 0) and sliders → axes in Node, and `tests/js/signs.html` in the
browser (the signs beside the names, pausing while hidden, the shape). `node --test tests/js/fire.test.mjs` (#218) tests
how Dreamy Eyes find fire (`static/dreamfire.js`) on painted camera pictures (`tests/js/fire-frames.mjs`; no real
pictures): flames from a campfire to a lighter and a swung poi count; silent for a minute each stay lamps (still, small
in a noisy camera, a string of them, dimmed, with the phone touched or carried), a dim warm room and warm walls in a
noisy camera, the camera's exposure pumping, warm LEDs beating (slowly, fast, with bands running through, a string of
them), a screen with warm moving pictures, an orange jacket and skin from pale to dark in warm light; the strength,
flaring up, dying down, the gaze following within two samples, the moods taking turns and getting used to a steady
fire. `node --test tests/js/eye.test.mjs` tests how often which hypnotic pupil comes. To see the eyes with a fire
without lighting one: `node scripts/fire_video.mjs fire.y4m` writes a 70 s film of the same painted fire (about 90 MB),
and a Chrome or Chromium started with `--use-fake-device-for-media-stream --use-fake-ui-for-media-stream
--use-file-for-fake-video-capture=fire.y4m` shows it to Dreamy Eyes as its camera (a Dream started only for that:
with `DREAM_AIMASK=0`, or the eyes make it load the image model for their painted faces). GitHub runs all of the tests on
Linux and macOS for every pull request to `main` and after every merge (`.github/workflows/tests.yml`); a pull request
can only be merged when both are green. The real AI on a graphics card and the 📏 measurements are not part of it –
they run on your own Mac, as below.

What the drawing costs the AI is measured by hand (#210), with the real model: start a second Dream in a sandbox HOME
on a port of its own (never your own Dream – the script changes the effects setting), set it to what you want to
compare (e.g. sd-turbo, 1 step, transformation 0.5), then `PORT=7885 node scripts/measure_stage.cjs <playwright>`
(the folder of an installed Playwright). It opens the stage in a headless Chromium on the real graphics card and
counts the AI pictures that come back in windows of 20 s after 8 s of warming up – drawn with Canvas 2D and with
WebGL 2, for the stage alone and the panel with an output window, at device scale 1 and 2, alternating and three
times each – and prints mean, spread and the difference, plus how many passes and megapixels per second the WebGL
chain drew. `SECONDS`, `WARMUP`, `RUNS`, `SCENES`, `SCALES`, `FX` (effects on) and `HEADED=1` (real windows) change
the run. Let the model warm up first: the first seconds after a start are slower whatever draws.

Where the code is, if you want to change something: `server.py` is what `./dream.sh` starts and only puts the parts
together – one file each for painting (`render.py`, `render_api.py`, `flow.py` for the flow field between two pictures), the rights (`rights.py`: the roles and what each
may do), the settings (`settings.py`: one table with every setting, its range and whether a guest may change it), the
shared state (`hub.py`), the control line (`ctl.py`), playlists (`scenes.py`), MIDI and sensors (`inputs.py`), the
outputs (`output.py`), Dreamy Eyes (`eyes.py`), dream windows (`windows.py`), the cloud GPU (`cloud.py`), measuring
(`measure.py`), uploads and the gallery (`media.py`), voice (`voice.py`), and the pages with their links (`pages.py`,
`net.py`). The pages are in `static/`; what they share is in `static/common.js`, the sliders of the panel and of Dream
Control in `static/sliders.js` (drawn from the settings table: default, range and `weight` of a setting), their moving
signs and the shape of the picture's character in `static/signs.js`.

<sub>[↑ Contents](#contents)</sub>

## Translations

The code and this README are English; the German texts of the interface lie in `static/i18n/de.json` (English text →
German), used by the pages (`static/i18n.js`, `T('text {x}', { x })`) and by the server and the scripts (`i18n.py`).
The names of built-in playlists and music patterns are stored in English; `de.json` gives their German names under
`_names`. `python3 scripts/i18n_check.py` reports every shown text without a German version.

<sub>[↑ Contents](#contents)</sub>

## Licences

**Dream's own code** is free software under the **GNU Affero General Public License v3.0 or later** (`LICENSE`).
You may use, change and pass it on; whoever passes on a changed version, or lets other people use a changed version
over a network (Dream Remote counts), must offer them its source code under the same licence. The remote shows a
“Source code” link for that (`DREAM_SOURCE_URL=…` in `~/.config/dream/dream.env` points it to your own copy).

The licence covers the code only. **The AI models are not part of this repository** – Dream downloads them on first
use, and each comes with its own licence:

| Model | Used for | Licence | Commercial use |
|---|---|---|---|
| [SD-Turbo](https://huggingface.co/stabilityai/sd-turbo), [SDXL-Turbo](https://huggingface.co/stabilityai/sdxl-turbo) | the dream | [Stability AI Community License](https://stability.ai/community-license-agreement) | free below USD 1 million annual revenue, after [registering](https://stability.ai/community-license); above that, an enterprise licence from Stability AI |
| [TAESD](https://huggingface.co/madebyollin/taesd), [TAESDXL](https://huggingface.co/madebyollin/taesdxl) | fast decoder | MIT | yes |
| [ControlNet SD 2.1 openpose/canny](https://huggingface.co/thibaud/controlnet-sd21-openpose-diffusers) (local) | pose, outlines | “other” – the card refers to the preprocessors' licences (OpenPose: non-commercial) | check yourself; for commercial work use the SDXL ones |
| [ControlNet SDXL openpose/canny](https://huggingface.co/xinsir/controlnet-openpose-sdxl-1.0) (cloud) | pose, outlines | Apache 2.0 | yes |
| [IP-Adapter](https://huggingface.co/h94/IP-Adapter) | style reference picture | Apache 2.0 | yes |
| Style LoRAs: watercolour, crayon ([ostris](https://huggingface.co/ostris)), illustration | styles | Apache 2.0 | yes |
| Style LoRAs: pixel art, paper cut | styles | CreativeML OpenRAIL-M | yes, with its use restrictions |
| Style LoRA: sticker | style | MIT | yes |
| [Whisper large-v3-turbo](https://huggingface.co/openai/whisper-large-v3-turbo) (MLX) | speech | MIT | yes |
| [Llama 3.2 3B](https://www.llama.com/llama3_2/license/) via Ollama (optional) | prompt ideas, playlists | Llama 3.2 Community License | yes (below 700 million monthly users; “Built with Llama”) |
| [MediaPipe](https://ai.google.dev/edge/mediapipe) models (pose, face, segmentation) | movement, Dreamy Eyes | Apache 2.0 | yes |

The Python libraries (PyTorch, diffusers, transformers, FastAPI, uvicorn, Pillow, NumPy, cryptography, qrcode,
python-osc, mido, python-rtmidi, syphon-python, mlx-whisper, psutil, …) are under permissive licences (BSD, MIT,
Apache 2.0, MIT-CMU, Unlicense). This list is a guide, not legal advice; the model cards are what counts.

<sub>[↑ Contents](#contents)</sub>
