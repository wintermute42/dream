// Dream on the wrist (#277): an M5Stack StickS3 sends its motion sensor's raw values to Dream and is the dance's clutch.
//
// Nothing needs doing on the device: switched on, it connects to the known Wi-Fi and to Dream by itself and sends its
// motion; after a drop it comes back by itself (it may sit in a band where nobody sees or presses it).
//   Button A (the big one on the front, optional): the clutch in or out – only once the owner allowed this device in
//     Dream's panel. Heard: two rising tones = engaged, two falling = released, a low buzz = Dream did not confirm (or
//     the device is not allowed). The screen shows what Dream confirmed, "?" while Dream has not answered.
//   Button B (on the side): the dance lab's feedback – once "good", twice quickly "bad".
//   Held B while switching on (or the very first start): the Wi-Fi setup (a hotspot "Dream-StickS3-…" with the
//     password on the screen).
//
// Battery: the radio sleeps between packets, the screen is dim unless something changed, the motion goes out less often
// while the arm rests, and the device switches itself off after IDLE_OFF_MS without Dream.
#include <M5Unified.h>

#include "DreamLink.h"

#ifndef DREAM_IMU_HZ
#define DREAM_IMU_HZ 50
#endif

namespace {
dream::Link dreamLink;
const uint32_t IMU_MS = 1000 / DREAM_IMU_HZ;
const uint32_t REST_IMU_MS = 100;            // while the arm rests: ten values a second are enough
const float REST_DPS = 4.0f;                 // below this rotation rate (degrees a second) the arm counts as resting …
const uint32_t REST_AFTER_MS = 20000;        // … once it was that still for so long
const uint32_t RETRY_MS = 150;               // a press is sent again until Dream confirms it …
const uint32_t GIVE_UP_MS = 2000;            // … for so long
const uint32_t BRIGHT_MS = 4000;             // the screen is bright this long after a change, then dim
const uint32_t IDLE_OFF_MS = 30UL * 60 * 1000;
const uint8_t BRIGHT = 90, DIM = 12;

uint32_t imuAt = 0, stillSince = 0, seq = 0, pressAt = 0, sentAt = 0, brightAt = 0, contactAt = 0, battAt = 0, drawnAt = 0;
bool pending = false, want = false, refusedFlash = false;

// the sounds of a press (the device is often worn where its screen is not seen)
void beep(bool engaged) {                    // two rising tones: engaged; two falling: released
  M5.Speaker.tone(engaged ? 880 : 1320, 90);
  delay(110);
  M5.Speaker.tone(engaged ? 1320 : 880, 120);
}
void buzz() { M5.Speaker.tone(196, 350); }   // low: Dream did not confirm, or this device is not allowed
int battery = -1;

enum class Shown { None, Setup, WiFi, Looking, Unknown, Engaged, Released, NotAllowed };
Shown shown = Shown::None;
int shownBattery = -2;
bool shownPending = false;

uint16_t rgb(uint8_t r, uint8_t g, uint8_t b) { return M5.Display.color565(r, g, b); }

void showSetup(const dream::SetupInfo& info) {
  auto& d = M5.Display;
  d.setBrightness(BRIGHT);
  d.fillScreen(TFT_BLACK);
  d.setTextColor(TFT_WHITE, TFT_BLACK);
  d.setTextDatum(top_left);
  d.setFont(&fonts::Font2);
  d.drawString("Wi-Fi setup", 8, 6);
  d.setTextColor(rgb(199, 139, 255), TFT_BLACK);
  d.drawString(info.ap, 8, 30);
  d.setTextColor(TFT_WHITE, TFT_BLACK);
  d.drawString(String("Password: ") + info.password, 8, 54);
  d.drawString(String("then: http://") + info.address, 8, 78);
  d.setTextColor(rgb(185, 177, 207), TFT_BLACK);
  d.drawString("(5 min, then it switches off)", 8, 106);
  shown = Shown::Setup;
}

void drawBattery(int pct) {
  auto& d = M5.Display;
  const int x = d.width() - 34, y = 6;
  d.fillRect(x - 2, y - 2, 36, 16, TFT_BLACK);
  if (pct < 0) return;
  uint16_t c = pct <= 15 ? rgb(255, 107, 125) : rgb(127, 227, 160);
  d.drawRect(x, y, 26, 12, TFT_WHITE);
  d.fillRect(x + 26, y + 3, 3, 6, TFT_WHITE);
  d.fillRect(x + 2, y + 2, (22 * pct) / 100, 8, c);
}

// the whole screen for a state: a big sign in the middle, a word under it, the link and the battery at the top
void draw(Shown s, uint32_t now) {
  auto& d = M5.Display;
  if (s != shown || pending != shownPending) {
    shown = s;
    shownPending = pending;
    d.fillScreen(TFT_BLACK);
    const int cx = d.width() / 2, cy = d.height() / 2 + 6;
    uint16_t c;
    const char* word;
    switch (s) {
      case Shown::Engaged: c = rgb(127, 227, 160); word = "IN"; d.fillCircle(cx, cy - 6, 34, c); break;
      case Shown::Released: c = rgb(185, 177, 207); word = "OUT"; d.drawCircle(cx, cy - 6, 34, c); d.drawCircle(cx, cy - 6, 33, c); break;
      case Shown::NotAllowed: c = rgb(255, 180, 84); word = "allow in Dream"; d.drawRect(cx - 18, cy - 14, 36, 28, c); d.drawCircle(cx, cy - 18, 12, c); break;
      case Shown::Unknown: c = rgb(255, 180, 84); word = "no answer"; break;
      case Shown::Looking: c = rgb(199, 139, 255); word = "looking for Dream"; break;
      case Shown::WiFi: c = rgb(255, 107, 125); word = "no Wi-Fi"; break;
      default: c = TFT_WHITE; word = ""; break;
    }
    d.setTextDatum(middle_center);
    if (s == Shown::Unknown || s == Shown::Looking || s == Shown::WiFi) {
      d.setFont(&fonts::Font4);
      d.setTextColor(c, TFT_BLACK);
      d.setTextSize(2);
      d.drawString("?", cx, cy - 8);
      d.setTextSize(1);
    }
    d.setFont(&fonts::Font2);
    d.setTextColor(s == Shown::Engaged ? TFT_BLACK : c, s == Shown::Engaged ? c : TFT_BLACK);
    d.drawString(word, cx, s == Shown::Engaged || s == Shown::Released ? cy - 6 : cy + 40);
    if (pending) { d.setTextColor(TFT_WHITE, TFT_BLACK); d.drawString("...", cx, cy + 40); }
    // the link: a dot, green while Dream answers
    d.fillCircle(10, 12, 5, s == Shown::Engaged || s == Shown::Released || s == Shown::NotAllowed ? rgb(127, 227, 160) : c);
    d.setTextDatum(middle_left);
    d.setTextColor(rgb(185, 177, 207), TFT_BLACK);
    d.drawString(dreamLink.shortId(), 20, 12);
    shownBattery = -2;
    brightAt = now;
  }
  if (battery != shownBattery) { shownBattery = battery; drawBattery(battery); }
}

Shown wanted(uint32_t now) {
  switch (dreamLink.phase()) {
    case dream::Phase::Setup: return Shown::Setup;
    case dream::Phase::WiFi: return Shown::WiFi;
    case dream::Phase::Looking: return Shown::Looking;
    default: break;
  }
  if (!dreamLink.fresh(now)) return Shown::Unknown;
  if (!dreamLink.paired() || refusedFlash) return Shown::NotAllowed;
  return dreamLink.clutch() ? Shown::Engaged : Shown::Released;
}

void led(Shown s, uint32_t now) {            // a LED, where the device has one Dream can light: the same state
  if (!M5.Led.isEnabled()) return;
  if (s == Shown::Engaged) M5.Led.setAllColor(0, 40, 0);
  else if (s == Shown::Released) M5.Led.setAllColor(0, 0, 0);
  else M5.Led.setAllColor((now / 400) % 2 ? 40 : 0, (now / 400) % 2 ? 20 : 0, 0);
}
}  // namespace

void setup() {
  auto cfg = M5.config();
  cfg.serial_baudrate = 115200;
  M5.begin(cfg);
  setCpuFrequencyMhz(80);                    // enough for 100 packets a second, and far less current
  M5.Display.setRotation(1);
  M5.Display.setBrightness(BRIGHT);
  M5.Display.fillScreen(TFT_BLACK);
  M5.Speaker.setVolume(160);
  M5.update();
  bool setupNow = M5.BtnB.isPressed();       // B held while switching on: the Wi-Fi setup
  dreamLink.begin("sticks3", setupNow, showSetup);
  if (dreamLink.setupUnfinished()) M5.Power.powerOff();   // the setup timed out: off, the battery keeps
  contactAt = millis();
  seq = esp_random() & 0xffff;               // a press after a restart never looks like one Dream already took
}

void loop() {
  M5.update();
  const uint32_t now = millis();
  dreamLink.loop(now);

  if (now - battAt > 10000 || battAt == 0) {
    battAt = now;
    battery = M5.Power.getBatteryLevel();
    dreamLink.battery(battery);
  }

  // the motion: raw, with the device's own clock
  if (M5.Imu.update()) {
    auto d = M5.Imu.getImuData();
    float rate = fabsf(d.gyro.x) + fabsf(d.gyro.y) + fabsf(d.gyro.z);
    if (rate > REST_DPS) stillSince = now;
    const uint32_t every = now - stillSince > REST_AFTER_MS ? REST_IMU_MS : IMU_MS;
    if (now - imuAt >= every) {
      imuAt = now;
      dreamLink.imu(now, d.accel.x, d.accel.y, d.accel.z, d.gyro.x, d.gyro.y, d.gyro.z);
    }
  }

  // button A: the clutch as the dancer wants it – the opposite of what Dream confirmed; nothing while that is not known
  if (M5.BtnA.wasPressed()) {
    brightAt = now;
    if (dreamLink.fresh(now) && dreamLink.paired() && !pending) {
      want = !dreamLink.clutch();
      seq++;
      pending = true;
      pressAt = 0;
    } else if (dreamLink.fresh(now) && !dreamLink.paired()) {
      refusedFlash = true;                   // said plainly on the screen: allow it in the panel first
      buzz();
    } else if (!pending) {
      buzz();                                // nothing confirmed from Dream right now: the press does nothing
    }
  }
  if (pending) {
    if (dreamLink.acked() == seq && dreamLink.fresh(now)) {           // Dream took it (and says what the clutch is)
      pending = false;
      beep(dreamLink.clutch());
    } else if (pressAt && now - pressAt > GIVE_UP_MS) {               // no answer: buzz; the screen shows "?" by itself
      pending = false;
      buzz();
    } else if (pressAt == 0 || now - sentAt >= RETRY_MS) {
      if (pressAt == 0) pressAt = now;
      sentAt = now;
      dreamLink.clutchWish(want, seq);
    }
  }
  if (refusedFlash && now - brightAt > 2500) refusedFlash = false;

  // button B: the dance lab's feedback (Dream counts one press "good", two quick ones "bad")
  if (M5.BtnB.wasPressed()) dreamLink.button(true);
  if (M5.BtnB.wasReleased()) dreamLink.button(false);

  if (now - drawnAt >= 50) {                 // the screen at most twenty times a second, and only what changed
    drawnAt = now;
    Shown s = wanted(now);
    draw(s, now);
    led(s, now);
    M5.Display.setBrightness(now - brightAt < BRIGHT_MS ? BRIGHT : DIM);
    if (s == Shown::Engaged || s == Shown::Released || s == Shown::NotAllowed) contactAt = now;
  }
  if (now - contactAt > IDLE_OFF_MS) M5.Power.powerOff();   // no Dream for half an hour: off, the battery keeps
  delay(2);
}
