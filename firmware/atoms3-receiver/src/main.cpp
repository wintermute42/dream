// Dream's USB receiver (#278): an M5Stack AtomS3 Lite on the Mac's USB. It takes the packets of the StickS3s paired
// with it by ESP-NOW (radio straight from the wrist, the Wi-Fi is not needed) and hands them to Dream over its USB serial
// line; Dream's answers go back the same way. The protocol is in DreamRadio.h, Dream's side is receiver.py.
//
//   The button, pressed briefly: the clutch the other way (like key K, the phone's button or a MIDI button).
//   Held 2 s: the pairing window opens for 30 s (the LED blinks white) – switch the wristband on near the receiver;
//     it pairs by itself (three green flashes). Dream's panel can open the window too.
//   Held 10 s: every paired wristband is forgotten (three red flashes).
//   The LED: green = a wristband is there and the clutch is engaged, blue = there and released, red = no wristband,
//     yellow = Dream is not listening (not running, or the USB line is not open).
//
// Only paired sticks are heard (its own list, kept in its memory; every frame between them is encrypted with a key of
// that stick's own). The radio stays on one channel (Dream says which, default 1); a stick follows it by itself.
#include <Arduino.h>
#include <Preferences.h>
#include <WiFi.h>
#include <esp_now.h>
#include <esp_random.h>
#include <esp_wifi.h>

#include "DreamRadio.h"

#ifndef DREAM_FW_VERSION
#define DREAM_FW_VERSION "1.0.0"
#endif

using namespace dream_radio;

namespace {
const int BUTTON_PIN = 41;                   // AtomS3 Lite: the button under the top (low while pressed)
const int LED_PIN = 35;                      // … and its one RGB LED (WS2812)
const uint8_t BRIGHT = 40;                   // of 255: bright enough in a lit room, not glaring
const uint32_t HELLO_MS = 2000;              // the H line at least this often
const uint32_t DREAM_SILENT_MS = 3000;       // no line of Dream this long: Dream is not listening (yellow)
const uint32_t SHORT_MS = 1000, PAIR_HOLD_MS = 2000, FORGET_HOLD_MS = 10000;
const uint32_t ENCRYPT_AFTER_MS = 80;        // the pair answer goes out unencrypted; then the stick's key is used

struct Frame {
  uint8_t mac[6];
  uint8_t len;
  uint8_t data[MAX_FRAME];
};

QueueHandle_t inbox;
Preferences prefs;
Peers peers;
uint8_t channel = DEFAULT_CHANNEL;
char myId[13] = {0};

uint32_t pairUntil = 0;                      // the pairing window is open until then (0: closed)
uint8_t encryptMac[6];                       // a stick just paired: its frames are encrypted from ENCRYPT_AFTER_MS on
uint32_t encryptAt = 0;
uint32_t helloAt = 0, dreamAt = 0;
bool helloNow = true;
char dreamLed = 'r';
char line[600];
size_t lineLen = 0;

// a short sign: (r, g, b) blinking `times` times, then the state again
uint8_t signR = 0, signG = 0, signB = 0, signTimes = 0;
uint32_t signAt = 0;

void sign(uint8_t r, uint8_t g, uint8_t b, uint8_t times) {
  signR = r; signG = g; signB = b; signTimes = times; signAt = millis();
}

// ESP-NOW calls this in the Wi-Fi task: only copied into the inbox, handled in loop()
#ifdef DREAM_RADIO_LOG
volatile uint32_t logIn = 0;
uint32_t logOsc = 0, logStranger = 0, logCall = 0;
#endif
void onReceive(const uint8_t* mac, const uint8_t* data, int len) {
#ifdef DREAM_RADIO_LOG
  logIn++;
#endif
  if (len <= 0 || len > static_cast<int>(MAX_FRAME)) return;
  Frame f;
  memcpy(f.mac, mac, 6);
  f.len = static_cast<uint8_t>(len);
  memcpy(f.data, data, len);
  xQueueSend(inbox, &f, 0);                  // full: dropped (the next motion packet is already on its way)
}

void savePeers() { prefs.putBytes("peers", peers.bytes(), Peers::size()); }

bool addPeer(const uint8_t mac[6], const uint8_t* key) {
  esp_now_peer_info_t p = {};
  memcpy(p.peer_addr, mac, 6);
  p.channel = 0;                             // the channel the receiver is on
  p.ifidx = WIFI_IF_STA;
  p.encrypt = key != nullptr;
  if (key) memcpy(p.lmk, key, KEY);
  if (esp_now_is_peer_exist(mac)) esp_now_del_peer(mac);     // anew, not modified: a changed key takes effect for sure
  return esp_now_add_peer(&p) == ESP_OK;
}

void useChannel(uint8_t ch) {
  channel = ch;
  esp_wifi_set_promiscuous(true);
  esp_wifi_set_channel(channel, WIFI_SECOND_CHAN_NONE);
  esp_wifi_set_promiscuous(false);
}

void send(const char* text, size_t n) { Serial.write(reinterpret_cast<const uint8_t*>(text), n); }

void sayHello(uint32_t now) {
  helloAt = now;
  helloNow = false;
  char list[MAX_PEERS * 14 + 2];
  peers.text(list, sizeof(list));
  const uint32_t left = pairUntil && now < pairUntil ? (pairUntil - now + 999) / 1000 : 0;
  char out[180];
  int n = snprintf(out, sizeof(out), "H %d %s %s %u %lu %s\n", PROTO, myId, DREAM_FW_VERSION, channel,
                   static_cast<unsigned long>(left), list);
  if (n > 0 && n < static_cast<int>(sizeof(out))) send(out, n);
}

// a stick's pair call while the window is open: a key of its own, the answer, then everything encrypted
void pair(const uint8_t mac[6]) {
  if (peers.count() == MAX_PEERS && !peers.find(mac)) {     // full: the longest paired makes way
    Peer* old = peers.at(0);
    if (old) esp_now_del_peer(old->mac);
  }
  uint8_t key[KEY];
  esp_fill_random(key, KEY);
  peers.add(mac, key);
  savePeers();
  addPeer(mac, nullptr);
  uint8_t answer[HEAD + 1 + KEY];
  head(answer, sizeof(answer), PAIR_ANSWER);
  answer[HEAD] = channel;
  memcpy(answer + HEAD + 1, key, KEY);
  esp_now_send(mac, answer, sizeof(answer));
  memcpy(encryptMac, mac, 6);
  encryptAt = millis() + ENCRYPT_AFTER_MS;
  pairUntil = 0;                             // one stick per window: a second one needs the button again
  sign(0, BRIGHT, 0, 3);
  helloNow = true;
}

void forgetAll() {
  for (int k = 0; k < MAX_PEERS; k++)
    if (Peer* p = peers.at(k)) esp_now_del_peer(p->mac);
  peers.clear();
  savePeers();
  pairUntil = 0;
  sign(BRIGHT, 0, 0, 3);
  helloNow = true;
}

void handleFrame(const Frame& f) {
  const uint8_t type = typeOf(f.data, f.len);
#ifdef DREAM_RADIO_LOG
  if (type == PAIR_CALL) logCall++;
  else if (type == OSC && !peers.find(f.mac)) logStranger++;
  else if (type == OSC) logOsc++;
#endif
  if (type == PAIR_CALL) {
    if (pairUntil && millis() < pairUntil) pair(f.mac);
    return;
  }
  if (type != OSC || f.len <= HEAD) return;
  Peer* p = peers.find(f.mac);
  if (!p) return;                            // only paired sticks are heard
  char out[16 + 2 * MAX_FRAME];
  char mac[13];
  macText(f.mac, mac);
  int n = snprintf(out, sizeof(out), "P %s ", mac);
  toHex(f.data + HEAD, f.len - HEAD, out + n, sizeof(out) - n - 1);
  n += 2 * (f.len - HEAD);
  out[n++] = '\n';
  send(out, n);
}

void handleCommand(const Command& c, uint32_t now) {
  dreamAt = now ? now : 1;
  switch (c.what) {
    case '?': helloNow = true; break;
    case 'L': dreamLed = c.led; break;
    case 'W': pairUntil = now + PAIR_WINDOW_MS; helloNow = true; break;
    case 'C':
      if (c.channel != channel) {
        useChannel(static_cast<uint8_t>(c.channel));
        prefs.putUChar("channel", channel);
      }
      helloNow = true;
      break;
    case 'K':
      if (Peer* p = peers.find(c.mac)) {
        if (p->fresh) { p->fresh = 0; savePeers(); }
        helloNow = true;
      }
      break;
    case 'T':
      if (peers.find(c.mac) && c.len + HEAD <= MAX_FRAME) {
        uint8_t frame[MAX_FRAME];
        head(frame, sizeof(frame), OSC);
        memcpy(frame + HEAD, c.data, c.len);
        esp_now_send(c.mac, frame, c.len + HEAD);
      }
      break;
    default: break;
  }
}

void readSerial(uint32_t now) {
  while (Serial.available() > 0) {
    int ch = Serial.read();
    if (ch < 0) break;
    if (ch == '\n') {
      Command c;
      if (readCommand(line, lineLen, &c)) handleCommand(c, now);
      lineLen = 0;
    } else if (lineLen < sizeof(line) - 1) {
      line[lineLen++] = static_cast<char>(ch);
    } else {
      lineLen = sizeof(line);                // too long: ignored up to its end
    }
  }
}

// the button: briefly – the clutch; held – pairing, held long – forget all
bool down = false, pairedByHold = false, forgotByHold = false;
uint32_t downAt = 0, changedAt = 0;

void button(uint32_t now) {
  const bool pressed = digitalRead(BUTTON_PIN) == LOW;
  if (pressed != down && now - changedAt > 30) {           // 30 ms against bouncing
    changedAt = now;
    down = pressed;
    if (down) {
      downAt = now;
      pairedByHold = forgotByHold = false;
    } else if (now - downAt < SHORT_MS) {
      if (dreamAt && now - dreamAt < DREAM_SILENT_MS) {
        send("B\n", 2);
        sign(BRIGHT, BRIGHT, BRIGHT, 1);
      } else {
        sign(BRIGHT, BRIGHT / 2, 0, 2);      // Dream is not listening: the press does nothing
      }
    }
  }
  if (down && !pairedByHold && now - downAt >= PAIR_HOLD_MS) {
    pairedByHold = true;
    pairUntil = now + PAIR_WINDOW_MS;
    helloNow = true;
  }
  if (down && !forgotByHold && now - downAt >= FORGET_HOLD_MS) {
    forgotByHold = true;
    forgetAll();
  }
}

uint8_t ledR = 255, ledG = 255, ledB = 255;
void led(uint8_t r, uint8_t g, uint8_t b) {
  if (r == ledR && g == ledG && b == ledB) return;
  ledR = r; ledG = g; ledB = b;
  neopixelWrite(LED_PIN, r, g, b);
}

void showLed(uint32_t now) {
  if (signTimes) {                           // a sign: on 150 ms, off 150 ms, so many times
    const uint32_t t = now - signAt;
    if (t >= signTimes * 300UL) signTimes = 0;
    else { (t % 300) < 150 ? led(signR, signG, signB) : led(0, 0, 0); return; }
  }
  if (pairUntil && now < pairUntil) {        // pairing: white, blinking
    (now / 125) % 2 ? led(BRIGHT, BRIGHT, BRIGHT) : led(0, 0, 0);
    return;
  }
  if (!dreamAt || now - dreamAt > DREAM_SILENT_MS) { led(BRIGHT, BRIGHT / 2, 0); return; }   // yellow: no Dream
  if (dreamLed == 'g') led(0, BRIGHT, 0);
  else if (dreamLed == 'b') led(0, 0, BRIGHT);
  else led(BRIGHT, 0, 0);
}
}  // namespace

void setup() {
  Serial.setRxBufferSize(2048);
  Serial.begin(115200);
  Serial.setTxTimeoutMs(0);                  // nobody reading (Dream not running): the lines are dropped, nothing waits
  pinMode(BUTTON_PIN, INPUT_PULLUP);
  led(0, 0, 0);
  inbox = xQueueCreate(32, sizeof(Frame));
  prefs.begin("dream-rx", false);
  if (prefs.getBytesLength("peers") == Peers::size()) prefs.getBytes("peers", peers.bytes(), Peers::size());
  const uint8_t ch = prefs.getUChar("channel", DEFAULT_CHANNEL);

  WiFi.mode(WIFI_STA);                       // the radio only: the receiver never joins a Wi-Fi
  WiFi.disconnect();
  uint8_t mac[6];
  WiFi.macAddress(mac);
  macText(mac, myId);
  useChannel(channelOk(ch) ? ch : DEFAULT_CHANNEL);
  esp_now_init();
  esp_now_set_pmk(PMK);
  esp_now_register_recv_cb(onReceive);
  for (int k = 0; k < MAX_PEERS; k++)
    if (Peer* p = peers.at(k)) addPeer(p->mac, p->key);
}

void loop() {
  const uint32_t now = millis();
#ifdef DREAM_RADIO_LOG
  static uint32_t logAt = 0;
  if (now - logAt >= 2000) {
    logAt = now;
    char out[120];
    int n = snprintf(out, sizeof(out), "# radio ch=%u in=%lu calls=%lu osc=%lu strangers=%lu peers=%d\n", channel, (unsigned long)logIn,
                     (unsigned long)logCall, (unsigned long)logOsc, (unsigned long)logStranger, peers.count());
    if (n > 0) send(out, n);
  }
#endif
  readSerial(now);
  Frame f;
  for (int k = 0; k < 16 && xQueueReceive(inbox, &f, 0) == pdTRUE; k++) handleFrame(f);
  if (encryptAt && static_cast<int32_t>(now - encryptAt) >= 0) {
    encryptAt = 0;
    if (Peer* p = peers.find(encryptMac)) addPeer(p->mac, p->key);
  }
  if (pairUntil && now >= pairUntil) { pairUntil = 0; helloNow = true; }
  button(now);
  if (helloNow || now - helloAt >= HELLO_MS) sayHello(now);
  showLed(now);
  delay(1);
}
