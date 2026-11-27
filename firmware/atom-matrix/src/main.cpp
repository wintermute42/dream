// Dream's little display (#277): an M5Stack ATOM Matrix shows the dance's clutch on its 5×5 lights and blinks on the beat.
//
//   engaged: a full green disc · released: a pale ring · "?": Dream has not answered lately (never a state it assumes)
//   blue, running round: looking for Dream · red dot: no Wi-Fi · purple, breathing: the Wi-Fi setup is open
//   The button (press the matrix): brighter or dimmer, three steps. Held while switching on: the Wi-Fi setup
//   (an open hotspot "Dream-Matrix-…" for five minutes – the matrix has no screen to show a password on).
// It only shows: it moves nothing in Dream and needs no pairing.
#include <M5Unified.h>

#include "DreamLink.h"

namespace {
dream::Link dreamLink;
const uint8_t LEVELS[] = {8, 20, 40};        // the matrix gets warm: never brighter than this (M5Stack's advice)
uint8_t level = 1;
uint32_t drawnAt = 0;
float pulse = 0;                             // the latest beat, fading

// the signs, one bit per light (row by row, the top left first)
constexpr uint32_t rows(uint32_t a, uint32_t b, uint32_t c, uint32_t d, uint32_t e) { return a << 20 | b << 15 | c << 10 | d << 5 | e; }
const uint32_t DISC = rows(0b01110, 0b11111, 0b11111, 0b11111, 0b01110);
const uint32_t RING = rows(0b01110, 0b10001, 0b10001, 0b10001, 0b01110);
const uint32_t ASK = rows(0b01110, 0b00010, 0b00100, 0b00000, 0b00100);
const uint32_t DOT = rows(0b00000, 0b00000, 0b00100, 0b00000, 0b00000);

struct RGB { uint8_t r, g, b; };

void paint(uint32_t sign, RGB c, float gain) {
  const size_t n = M5.Led.getCount();
  for (size_t k = 0; k < n && k < 25; k++) {
    bool on = sign & (1UL << (24 - k));
    float g = on ? gain : 0;
    M5.Led.setColor(k, static_cast<uint8_t>(c.r * g), static_cast<uint8_t>(c.g * g), static_cast<uint8_t>(c.b * g));
  }
  M5.Led.display();
}

// one light running round the ring (looking for Dream)
uint32_t runner(uint32_t now) {
  static const uint8_t ROUND[] = {1, 2, 3, 9, 14, 19, 23, 22, 21, 15, 10, 5};
  return 1UL << (24 - ROUND[(now / 120) % sizeof(ROUND)]);
}

void showSetup(const dream::SetupInfo&) { paint(DISC, {199, 139, 255}, 0.6f); }
}  // namespace

void setup() {
  auto cfg = M5.config();
  M5.begin(cfg);
  setCpuFrequencyMhz(80);
  M5.Led.setAutoDisplay(false);
  M5.Led.setBrightness(LEVELS[level]);
  M5.update();
  bool setupNow = M5.BtnA.isPressed();       // the button held while switching on: the Wi-Fi setup
  dreamLink.begin("matrix", setupNow, showSetup, false);
}

void loop() {
  M5.update();
  const uint32_t now = millis();
  dreamLink.loop(now);
  if (M5.BtnA.wasPressed()) {
    level = (level + 1) % sizeof(LEVELS);
    M5.Led.setBrightness(LEVELS[level]);
  }
  float beat = dreamLink.takeBeat();
  if (beat > pulse) pulse = beat;
  if (now - drawnAt < 30) { delay(2); return; }
  const float dt = (now - drawnAt) / 1000.0f;
  drawnAt = now;
  pulse *= expf(-dt / 0.15f);                // a beat fades in about a sixth of a second
  const float gain = 0.55f + 0.45f * pulse;  // between the beats a little dimmer, on the beat full
  switch (dreamLink.phase()) {
    case dream::Phase::Setup: paint(DISC, {199, 139, 255}, 0.4f + 0.3f * sinf(now / 400.0f)); break;
    case dream::Phase::WiFi: paint(DOT, {255, 107, 125}, (now / 500) % 2 ? 1.0f : 0.2f); break;
    case dream::Phase::Looking: paint(runner(now), {80, 190, 255}, 1.0f); break;
    default:
      if (!dreamLink.fresh(now)) paint(ASK, {255, 180, 84}, 1.0f);
      else if (dreamLink.clutch()) paint(DISC, {127, 227, 160}, gain);
      else paint(RING, {185, 177, 207}, 0.35f + 0.45f * pulse);
  }
  delay(2);
}
