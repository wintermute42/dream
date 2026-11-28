// Dream's radio link (#278): the StickS3 on the wrist talks to a receiver on the Mac's USB (an M5Stack AtomS3 Lite) by
// ESP-NOW – straight, without the Wi-Fi in between – and the receiver hands every packet over its USB serial line to
// Dream (receiver.py). What travels is the stick's own OSC of #277 (DreamOsc.h, wearables.py); the radio only adds a
// three-byte head and the pairing.
//
// Everything here is pure C++ without the Arduino core: the same header compiles on the devices and on a computer
// (tests/test_firmware_radio.py checks it against receiver.py).
//
// The radio frame (at most 250 bytes, ESP-NOW's limit):
//   'D', VERSION, type, payload
//   type 'P'  pair call    stick → everyone (broadcast), payload: the kind ("sticks3"). Only a receiver whose pairing
//                          window is open answers.
//   type 'A'  pair answer  receiver → that stick, payload: channel (1 byte), key (16 bytes). From then on both
//                          encrypt everything between them with that key (ESP-NOW's own CCMP, the key per stick).
//   type 'O'  OSC          either way, payload: one OSC packet of wearables.py (encrypted, between paired ones only).
//
// The serial line between receiver and Dream (115200 baud, text, one line each; hex = the OSC packet's bytes):
//   receiver → Dream   H <proto> <id> <firmware> <channel> <pairing s left> <peers>   who it is, every 2 s and at once
//                                                     after a change; peers "-" or mac[,mac…], a "*" after a mac: paired
//                                                     by the button and not yet taken by Dream
//                      P <mac> <hex>                  a packet of a paired stick
//                      B                              its button was pressed: the clutch the other way
//   Dream → receiver   ?                              say H now
//                      T <mac> <hex>                  a packet for that stick
//                      L g | b | r                    the LED (green: a wristband there, clutch engaged; blue: there,
//                                                     released; red: no wristband) – also Dream's sign of life
//                      K <mac>                        that newly paired stick was taken (allowed)
//                      W                              open the pairing window
//                      C <channel>                    use this channel (1 … 13)
#pragma once
#include <stddef.h>
#include <stdint.h>
#include <string.h>

namespace dream_radio {

static const uint8_t MAGIC = 'D';
static const uint8_t VERSION = 1;
static const uint8_t PAIR_CALL = 'P', PAIR_ANSWER = 'A', OSC = 'O';
static const size_t HEAD = 3;
static const size_t MAX_FRAME = 250;                 // ESP-NOW's limit
static const size_t KEY = 16;
static const int PROTO = 1;                          // the serial line's version (the first word after H)
static const uint8_t FIRST_CHANNEL = 1, LAST_CHANNEL = 13;
static const uint8_t DEFAULT_CHANNEL = 1;
static const int MAX_PEERS = 6;                      // ESP-NOW keeps at most 7 encrypted peers; one stays free
static const uint32_t PAIR_WINDOW_MS = 30000;
// ESP-NOW's primary key: every frame between a stick and its receiver is encrypted with that stick's own key (LMK,
// made at random at the pairing); the primary key only wraps it and is not a secret
static const uint8_t PMK[KEY] = {'D', 'r', 'e', 'a', 'm', '-', 'w', 'e', 'a', 'r', '-', 'r', 'a', 'd', 'i', 'o'};

inline bool channelOk(int ch) { return ch >= FIRST_CHANNEL && ch <= LAST_CHANNEL; }

// a frame's head: 0 when buf is too small
inline size_t head(uint8_t* buf, size_t cap, uint8_t type) {
  if (cap < HEAD) return 0;
  buf[0] = MAGIC;
  buf[1] = VERSION;
  buf[2] = type;
  return HEAD;
}

// the type of a frame of ours, or 0
inline uint8_t typeOf(const uint8_t* buf, size_t n) {
  if (n < HEAD || n > MAX_FRAME || buf[0] != MAGIC || buf[1] != VERSION) return 0;
  return buf[2] == PAIR_CALL || buf[2] == PAIR_ANSWER || buf[2] == OSC ? buf[2] : 0;
}

// ---------- text: hex and addresses ----------
inline char hexDigit(unsigned v) { return "0123456789abcdef"[v & 15]; }
inline int hexValue(char c) {
  return c >= '0' && c <= '9' ? c - '0' : c >= 'a' && c <= 'f' ? c - 'a' + 10 : c >= 'A' && c <= 'F' ? c - 'A' + 10 : -1;
}

// n bytes as 2n hex digits and a zero; false when out is too small
inline bool toHex(const uint8_t* in, size_t n, char* out, size_t cap) {
  if (cap < 2 * n + 1) return false;
  for (size_t k = 0; k < n; k++) {
    out[2 * k] = hexDigit(in[k] >> 4);
    out[2 * k + 1] = hexDigit(in[k]);
  }
  out[2 * n] = 0;
  return true;
}

// hex digits (exactly len of them, an even number) into bytes; the count, or -1
inline int fromHex(const char* in, size_t len, uint8_t* out, size_t cap) {
  if (len % 2 || len / 2 > cap) return -1;
  for (size_t k = 0; k < len; k += 2) {
    int hi = hexValue(in[k]), lo = hexValue(in[k + 1]);
    if (hi < 0 || lo < 0) return -1;
    out[k / 2] = static_cast<uint8_t>(hi * 16 + lo);
  }
  return static_cast<int>(len / 2);
}

// an address as twelve lower-case hex digits (how Dream names a stick: its id)
inline void macText(const uint8_t mac[6], char out[13]) { toHex(mac, 6, out, 13); }
inline bool macParse(const char* s, size_t len, uint8_t mac[6]) {
  if (len != 12) return false;
  for (size_t k = 0; k < 12; k++)
    if (hexValue(s[k]) < 0 || (s[k] >= 'A' && s[k] <= 'F')) return false;   // lower case only, like Dream's ids
  return fromHex(s, 12, mac, 6) == 6;
}

// ---------- the serial line: Dream's commands, read by the receiver ----------
struct Command {
  char what;              // '?', 'T', 'L', 'K', 'W', 'C' – 0: not understood
  uint8_t mac[6];
  uint8_t data[MAX_FRAME];
  size_t len;
  char led;               // 'g', 'b', 'r'
  int channel;
};

// one line without its end (\n or \r\n)
inline bool readCommand(const char* line, size_t n, Command* c) {
  while (n && (line[n - 1] == '\r' || line[n - 1] == '\n' || line[n - 1] == ' ')) n--;
  c->what = 0;
  c->len = 0;
  if (n == 0) return false;
  const char w = line[0];
  if ((w == '?' || w == 'W') && n == 1) { c->what = w; return true; }
  if (n < 3 || line[1] != ' ') return false;
  const char* rest = line + 2;
  size_t left = n - 2;
  if (w == 'L' && left == 1 && (rest[0] == 'g' || rest[0] == 'b' || rest[0] == 'r')) {
    c->led = rest[0];
    c->what = w;
    return true;
  }
  if (w == 'C' && left <= 2) {
    int ch = 0;
    for (size_t k = 0; k < left; k++) {
      if (rest[k] < '0' || rest[k] > '9') return false;
      ch = ch * 10 + (rest[k] - '0');
    }
    if (!channelOk(ch)) return false;
    c->channel = ch;
    c->what = w;
    return true;
  }
  if (w == 'K' && macParse(rest, left, c->mac)) { c->what = w; return true; }
  if (w == 'T' && left > 13 && rest[12] == ' ' && macParse(rest, 12, c->mac)) {
    int m = fromHex(rest + 13, left - 13, c->data, MAX_FRAME - HEAD);
    if (m <= 0) return false;
    c->len = static_cast<size_t>(m);
    c->what = w;
    return true;
  }
  return false;
}

// ---------- the receiver's paired sticks (kept in its own memory) ----------
struct Peer {
  uint8_t mac[6];
  uint8_t key[KEY];
  uint8_t fresh;          // 1: paired by the button, Dream has not taken it yet
  uint8_t used;
};

class Peers {
 public:
  Peers() { memset(list_, 0, sizeof(list_)); }
  Peer* find(const uint8_t mac[6]) {
    for (auto& p : list_)
      if (p.used && memcmp(p.mac, mac, 6) == 0) return &p;
    return nullptr;
  }
  int count() const {
    int n = 0;
    for (const auto& p : list_) n += p.used;
    return n;
  }
  // a new stick (or one paired again: a new key); when all places are taken, the oldest makes way. Returns its place.
  Peer* add(const uint8_t mac[6], const uint8_t key[KEY]) {
    Peer* p = find(mac);
    if (!p)
      for (auto& q : list_)
        if (!q.used) { p = &q; break; }
    if (!p) {                                  // full: the first one (the longest paired) goes
      memmove(&list_[0], &list_[1], sizeof(Peer) * (MAX_PEERS - 1));
      p = &list_[MAX_PEERS - 1];
    }
    memcpy(p->mac, mac, 6);
    memcpy(p->key, key, KEY);
    p->fresh = 1;
    p->used = 1;
    return p;
  }
  void clear() { memset(list_, 0, sizeof(list_)); }
  Peer* at(int k) { return k >= 0 && k < MAX_PEERS && list_[k].used ? &list_[k] : nullptr; }
  // "-" or mac[*][,mac[*]…] – the last word of the H line
  void text(char* out, size_t cap) const {
    size_t n = 0;
    out[0] = 0;
    for (const auto& p : list_) {
      if (!p.used) continue;
      if (n + 15 > cap) break;
      if (n) out[n++] = ',';
      macText(p.mac, out + n);
      n += 12;
      if (p.fresh) out[n++] = '*';
      out[n] = 0;
    }
    if (n == 0 && cap >= 2) { out[0] = '-'; out[1] = 0; }
  }
  // what is kept in memory: the whole table as bytes
  uint8_t* bytes() { return reinterpret_cast<uint8_t*>(list_); }
  static size_t size() { return sizeof(Peer) * MAX_PEERS; }

 private:
  Peer list_[MAX_PEERS];
};

}  // namespace dream_radio
