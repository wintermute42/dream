#include "DreamLink.h"

#include <ESPmDNS.h>
#include <Preferences.h>
#include <WiFi.h>
#include <WiFiManager.h>
#include <esp_now.h>
#include <esp_wifi.h>

#ifndef DREAM_FW_VERSION
#define DREAM_FW_VERSION "1.0.0"
#endif

namespace dream {

namespace {
const char* const PREFIX = "/dream/wear/";
const uint16_t DEFAULT_PORT = 7020;           // Dream's sensor port (DREAM_SENSOR_PORT) unless mDNS or the setup says otherwise
const uint32_t HELLO_MS = 1000;
const uint32_t LOOK_MS = 5000;                // a new mDNS question while Dream is not found
const uint32_t LOST_MS = 10000;               // no word of Dream this long: look for it again (it may have a new address)
const uint32_t WIFI_RETRY_MS = 10000;
// #278: the radio
const uint32_t RADIO_LOST_MS = 1500;          // nothing delivered to the receiver this long: look for it on every channel
const uint32_t HOP_MS = 150;                  // … this long on each
const uint32_t WIFI_NO_DREAM_MS = 30000;      // on the Wi-Fi without Dream this long: try the receiver again
const uint32_t HINT_BLOCK_MS = 60000;         // the receiver did not answer after all: Dream's hint waits this long …
const uint32_t HINT_BLOCK_MAX_MS = 900000;    // … twice as long after every further miss, at most a quarter of an hour
Preferences prefs;
bool saveHost = false;
WiFiManagerParameter* hostParam = nullptr;

struct Frame {
  uint8_t mac[6];
  uint8_t len;
  uint8_t data[dream_radio::MAX_FRAME];
};
QueueHandle_t inbox = nullptr;
volatile uint32_t deliveredAt = 0;            // the receiver confirmed a frame (ESP-NOW's own acknowledgement)
uint8_t receiverMac[6];
const uint8_t BROADCAST[6] = {0xff, 0xff, 0xff, 0xff, 0xff, 0xff};

void onSave() { saveHost = true; }

void onReceive(const uint8_t* mac, const uint8_t* data, int len) {   // the Wi-Fi task: only into the inbox
  if (!inbox || len <= 0 || len > static_cast<int>(dream_radio::MAX_FRAME)) return;
  Frame f;
  memcpy(f.mac, mac, 6);
  f.len = static_cast<uint8_t>(len);
  memcpy(f.data, data, len);
  xQueueSend(inbox, &f, 0);
}

void onSent(const uint8_t* mac, esp_now_send_status_t status) {
  if (status != ESP_NOW_SEND_SUCCESS || memcmp(mac, receiverMac, 6) != 0) return;
  const uint32_t t = millis();
  deliveredAt = t ? t : 1;
}

bool isHex(const char* s, size_t n) {
  if (strlen(s) != n) return false;
  for (size_t k = 0; k < n; k++)
    if (!isxdigit(static_cast<unsigned char>(s[k])) || isupper(static_cast<unsigned char>(s[k]))) return false;
  return true;
}
}  // namespace

void Link::begin(const char* kind, bool setup, void (*showSetup)(const SetupInfo&)) {
  kind_ = kind;
  uint64_t mac = ESP.getEfuseMac();
  for (int k = 0; k < 6; k++) snprintf(id_ + 2 * k, 3, "%02x", static_cast<unsigned>((mac >> (8 * k)) & 0xff));
  prefs.begin("dream", false);
  prefs.getString("token", token_, sizeof(token_));
  if (!isHex(token_, 32)) token_[0] = 0;
  prefs.getString("host", host_, sizeof(host_));
  hasRx_ = prefs.getBytes("rx", rx_, 6) == 6 && prefs.getBytes("rxkey", rxKey_, sizeof(rxKey_)) == sizeof(rxKey_);
  rxChannel_ = prefs.getUChar("rxch", dream_radio::DEFAULT_CHANNEL);
  if (!dream_radio::channelOk(rxChannel_)) rxChannel_ = dream_radio::DEFAULT_CHANNEL;

  WiFi.mode(WIFI_STA);
  WiFi.setAutoReconnect(false);
  radioBegin();
  if (setup) {                               // B held at start: the Wi-Fi setup, nothing else
    wifiBegin(true, showSetup);
    return;
  }
  // #278: a receiver in pairing mode near by takes this stick now (blind: switched on next to it, nothing pressed)
  if (pairCall()) justPaired_ = true;
  if (hasRx_ && findReceiver(2500)) {
    via_ = Via::Radio;
    phase_ = Phase::Linked;
    radioSince_ = millis();
    return;
  }
  // no receiver answers: the Wi-Fi as before (#277) – the setup hotspot only on the very first start (neither a
  // receiver nor a Wi-Fi known); a stick that knows its receiver but no Wi-Fi keeps looking for the receiver
  if (wifiKnown() || !hasRx_) {
    wifiBegin(!wifiKnown(), showSetup);
  } else {
    via_ = Via::Radio;
    phase_ = Phase::Receiver;
    radioSince_ = millis();
  }
}

// ---------- the radio (#278) ----------
void Link::radioBegin() {
  if (!inbox) {
    inbox = xQueueCreate(8, sizeof(Frame));
    esp_now_init();
    esp_now_set_pmk(dream_radio::PMK);
    esp_now_register_recv_cb(onReceive);
    esp_now_register_send_cb(onSent);
    esp_now_peer_info_t p = {};
    memcpy(p.peer_addr, BROADCAST, 6);
    p.channel = 0;
    p.ifidx = WIFI_IF_STA;
    esp_now_add_peer(&p);
  }
  if (hasRx_) {
    memcpy(receiverMac, rx_, 6);
    esp_now_peer_info_t r = {};
    memcpy(r.peer_addr, rx_, 6);
    memcpy(r.lmk, rxKey_, sizeof(rxKey_));
    r.channel = 0;                           // whatever channel the stick is on (it follows the receiver)
    r.ifidx = WIFI_IF_STA;
    r.encrypt = true;
    if (esp_now_is_peer_exist(rx_)) esp_now_mod_peer(&r);
    else esp_now_add_peer(&r);
  }
}

void Link::setChannel(uint8_t channel) {
  channel_ = channel;
  esp_wifi_set_promiscuous(true);
  esp_wifi_set_channel(channel, WIFI_SECOND_CHAN_NONE);
  esp_wifi_set_promiscuous(false);
}

// On every channel once: "is a receiver in pairing mode here?" The one that answers gives its channel and a key of
// this stick's own; from then on everything between them is encrypted.
bool Link::pairCall() {
  uint8_t call[dream_radio::HEAD + 8];
  size_t n = dream_radio::head(call, sizeof(call), dream_radio::PAIR_CALL);
  const size_t kl = strlen(kind_) < 8 ? strlen(kind_) : 8;
  memcpy(call + n, kind_, kl);
  n += kl;
  for (uint8_t ch = dream_radio::FIRST_CHANNEL; ch <= dream_radio::LAST_CHANNEL; ch++) {
    setChannel(ch);
    esp_now_send(BROADCAST, call, n);
    const uint32_t until = millis() + PAIR_CALL_MS;
    Frame f;
    while (static_cast<int32_t>(until - millis()) > 0) {
      if (xQueueReceive(inbox, &f, pdMS_TO_TICKS(10)) != pdTRUE) continue;
      if (dream_radio::typeOf(f.data, f.len) != dream_radio::PAIR_ANSWER || f.len != dream_radio::HEAD + 1 + dream_radio::KEY)
        continue;
      const uint8_t answered = f.data[dream_radio::HEAD];
      if (!dream_radio::channelOk(answered)) continue;
      if (hasRx_ && memcmp(rx_, f.mac, 6) != 0) esp_now_del_peer(rx_);   // paired with another receiver now
      memcpy(rx_, f.mac, 6);
      memcpy(rxKey_, f.data + dream_radio::HEAD + 1, dream_radio::KEY);
      rxChannel_ = answered;
      hasRx_ = true;
      prefs.putBytes("rx", rx_, 6);
      prefs.putBytes("rxkey", rxKey_, sizeof(rxKey_));
      prefs.putUChar("rxch", rxChannel_);
      delay(150);                            // the receiver switches to this stick's key meanwhile
      radioBegin();                          // the receiver as an encrypted peer
      setChannel(rxChannel_);
      return true;
    }
  }
  return false;
}

// Its known channel first (three hellos), then every other: a hello on each until the receiver confirms one
bool Link::findReceiver(uint32_t waitMs) {
  const uint32_t start = millis();
  uint8_t ch = rxChannel_;
  via_ = Via::Radio;
  for (int tries = 0; millis() - start < waitMs; tries++) {
    setChannel(ch);
    deliveredAt = 0;
    hello(millis());
    const uint32_t until = millis() + HOP_MS;
    while (static_cast<int32_t>(until - millis()) > 0 && !deliveredAt) delay(5);
    if (deliveredAt) {
      if (ch != rxChannel_) { rxChannel_ = ch; prefs.putUChar("rxch", ch); }
      return true;
    }
    if (tries >= 2) ch = ch >= dream_radio::LAST_CHANNEL ? dream_radio::FIRST_CHANNEL : ch + 1;
  }
  phase_ = Phase::Receiver;
  return false;
}

void Link::toRadio(uint8_t channel, uint32_t now) {
  WiFi.setAutoReconnect(false);
  WiFi.disconnect();
  via_ = Via::Radio;
  phase_ = Phase::Receiver;
  if (dream_radio::channelOk(channel)) rxChannel_ = channel;
  setChannel(rxChannel_);
  deliveredAt = 0;
  radioSince_ = scanAt_ = now;
  scanned_ = 0;
  got_ = 0;
  helloAt_ = 0;
}

void Link::radioLoop(uint32_t now) {
  receiveRadio(now);
  if (helloAt_ == 0 || now - helloAt_ >= HELLO_MS) hello(now);
  const uint32_t delivered = deliveredAt;
  if (delivered && static_cast<int32_t>(now - delivered) < static_cast<int32_t>(RADIO_LOST_MS)) {
    if (phase_ != Phase::Linked) {           // found (again, perhaps on another channel)
      phase_ = Phase::Linked;
      hintBlockMs_ = HINT_BLOCK_MS;
      if (channel_ != rxChannel_) { rxChannel_ = channel_; prefs.putUChar("rxch", rxChannel_); }
    }
    scanned_ = 0;
    return;
  }
  if (now - radioSince_ < RADIO_LOST_MS) return;   // just switched to the radio: a moment for the first answer
  phase_ = Phase::Receiver;
  if (now - scanAt_ >= HOP_MS) {             // the next channel, and a hello there
    scanAt_ = now;
    scanned_++;
    setChannel(channel_ >= dream_radio::LAST_CHANNEL ? dream_radio::FIRST_CHANNEL : channel_ + 1);
    hello(now);
  }
  // every channel tried and nobody answers: the Wi-Fi (#277), when one is known; else it keeps looking
  if (scanned_ > dream_radio::LAST_CHANNEL && wifiKnown()) toWiFi(now);
}

void Link::receiveRadio(uint32_t now) {
  Frame f;
  for (int k = 0; k < 8 && xQueueReceive(inbox, &f, 0) == pdTRUE; k++) {
    if (!hasRx_ || memcmp(f.mac, rx_, 6) != 0) continue;            // only its receiver's frames count
    if (dream_radio::typeOf(f.data, f.len) != dream_radio::OSC) continue;
    dream_osc::Message m;
    if (!dream_osc::parse(f.data + dream_radio::HEAD, f.len - dream_radio::HEAD, &m)) continue;
    handle(m, now);
  }
}

// ---------- the Wi-Fi (#277) ----------
bool Link::wifiKnown() const {
  wifi_config_t conf;
  return esp_wifi_get_config(WIFI_IF_STA, &conf) == ESP_OK && conf.sta.ssid[0] != 0;
}

void Link::wifiBegin(bool portal, void (*showSetup)(const SetupInfo&)) {
  via_ = Via::WiFi;
  WiFiManager wm;
  wm.setDebugOutput(false);
  wm.setConfigPortalTimeout(SETUP_SECONDS);
  wm.setConnectTimeout(20);
  wm.setTitle("Dream");
  if (!hostParam) hostParam = new WiFiManagerParameter("dream", "Dream: address of the Mac (empty: Dream is found by itself)", host_, 63);
  wm.addParameter(hostParam);
  wm.setSaveParamsCallback(onSave);
  char ap[32], pass[12] = "";
  snprintf(ap, sizeof(ap), "Dream-StickS3-%s", shortId());
  for (char* c = ap; *c; c++) *c = (*c >= 'a' && *c <= 'f') ? *c - 32 : *c;
  snprintf(pass, sizeof(pass), "%08lu", static_cast<unsigned long>(esp_random() % 100000000UL));
  static SetupInfo info;
  info = {ap, pass, "192.168.4.1"};
  static void (*show)(const SetupInfo&) = nullptr;
  show = showSetup;
  wm.setAPCallback([](WiFiManager*) { if (show) show(info); });
  // The setup hotspot opens only when asked (a button held at start) or on the very first start. A device with its
  // Wi-Fi known never waits for anyone: it connects by itself, now or whenever the Wi-Fi is back (the loop) – it may sit
  // in a band where nobody sees or presses it.
  bool ok = false;
  if (portal) {
    phase_ = Phase::Setup;
    ok = wm.startConfigPortal(ap, pass);
    setupUnfinished_ = !ok;
  } else {
    WiFi.begin();
  }
  if (saveHost && hostParam) {
    strncpy(host_, hostParam->getValue(), sizeof(host_) - 1);
    host_[sizeof(host_) - 1] = 0;
    prefs.putString("host", host_);
  }
  phase_ = ok ? Phase::Looking : Phase::WiFi;
  WiFi.setAutoReconnect(true);
  WiFi.setSleep(true);                       // modem sleep between packets: the radio rests, the battery lasts longer
  if (!wifiStarted_) {
    wifiStarted_ = true;
    char name[32];
    snprintf(name, sizeof(name), "dream-%s-%s", kind_, shortId());
    MDNS.begin(name);
    udp_.begin(0);                           // any local port: Dream answers to the port a packet came from
  }
  linkedAt_ = millis();
}

void Link::toWiFi(uint32_t now) {
  // Dream's "your receiver is there" waits a while: it did not answer just now (plugged in, but out of reach) – and
  // longer after every miss, so a stick out of the receiver's reach is not taken off the Wi-Fi again and again
  hintBlockUntil_ = now + hintBlockMs_;
  hintBlockMs_ = hintBlockMs_ * 2 > HINT_BLOCK_MAX_MS ? HINT_BLOCK_MAX_MS : hintBlockMs_ * 2;
  got_ = 0;
  if (!wifiStarted_) {
    wifiBegin(false, nullptr);
  } else {
    via_ = Via::WiFi;
    phase_ = Phase::WiFi;
    WiFi.setAutoReconnect(true);
    WiFi.begin();
  }
  linkedAt_ = now;
}

bool Link::resolve(const char* host, IPAddress* ip) {
  if (ip->fromString(host)) return true;
  size_t n = strlen(host);
  if (n > 6 && strcmp(host + n - 6, ".local") == 0) {
    char base[64];
    memcpy(base, host, n - 6);
    base[n - 6] = 0;
    *ip = MDNS.queryHost(base, 1500);
    return *ip != IPAddress();
  }
  return WiFi.hostByName(host, *ip) == 1;
}

void Link::look(uint32_t now) {
  if (now - lookAt_ < LOOK_MS && lookAt_ != 0) return;
  lookAt_ = now;
  if (host_[0]) {                            // entered in the setup: "address" or "address:port"
    char host[64];
    strncpy(host, host_, sizeof(host));
    char* colon = strrchr(host, ':');
    uint16_t port = DEFAULT_PORT;
    if (colon) { *colon = 0; port = static_cast<uint16_t>(atoi(colon + 1)); }
    if (port && resolve(host, &dream_)) { port_ = port; phase_ = Phase::Linked; got_ = 0; }
    return;
  }
  int n = MDNS.queryService("dream-osc", "udp");
  if (n > 0) {
    dream_ = MDNS.IP(0);
    port_ = MDNS.port(0);
    phase_ = Phase::Linked;
    got_ = 0;
  }
}

void Link::wifiLoop(uint32_t now) {
  // #278: on the Wi-Fi without Dream for a while, and a receiver is known: perhaps it is plugged in again
  if (phase_ == Phase::Linked && fresh(now)) linkedAt_ = now;
  if (hasRx_ && now - linkedAt_ > WIFI_NO_DREAM_MS) {
    linkedAt_ = now;
    toRadio(rxChannel_, now);
    return;
  }
  if (WiFi.status() != WL_CONNECTED) {
    phase_ = Phase::WiFi;
    if (now - wifiAt_ > WIFI_RETRY_MS) { wifiAt_ = now; WiFi.reconnect(); }
    return;
  }
  if (phase_ == Phase::WiFi || phase_ == Phase::Setup) { phase_ = Phase::Looking; lookAt_ = 0; }
  if (phase_ == Phase::Looking) { look(now); if (phase_ != Phase::Linked) return; helloAt_ = 0; }
  receiveUdp(now);
  if (via_ != Via::WiFi) return;             // Dream's hint moved it to the radio just now
  if (helloAt_ == 0 || now - helloAt_ >= HELLO_MS) hello(now);
  // Dream was heard from once and then fell silent (restarted elsewhere?): look for it again – an address entered
  // in the setup stays where it is
  if (!host_[0] && got_ != 0 && now - got_ > LOST_MS) { phase_ = Phase::Looking; lookAt_ = 0; }
}

void Link::loop(uint32_t now) {
  if (via_ == Via::Radio) radioLoop(now);
  else wifiLoop(now);
}

void Link::hello(uint32_t now) {
  helloAt_ = now;
  char tag[24];
  snprintf(tag, sizeof(tag), "%shello", PREFIX);
  send(dream_osc::Writer(out_ + dream_radio::HEAD, sizeof(out_) - dream_radio::HEAD)
           .build(tag, "sssis", id_, kind_, token_, battery_, DREAM_FW_VERSION));
}

// ---------- Dream's answers, whichever way they came ----------
void Link::handle(const dream_osc::Message& m, uint32_t now) {
  if (strncmp(m.address, PREFIX, strlen(PREFIX)) != 0) return;
  const char* what = m.address + strlen(PREFIX);
  if (strcmp(what, "state") == 0 && m.count >= 3) {
    clutch_ = dream_osc::number(m, 0) > 0.5f;
    paired_ = dream_osc::number(m, 1) > 0.5f;
    ack_ = m.args[2].type == 'i' ? static_cast<uint32_t>(m.args[2].i) : 0;
    got_ = now ? now : 1;
  } else if (strcmp(what, "pair") == 0 && m.count >= 1 && m.args[0].type == 's' && isHex(m.args[0].s, 32)) {
    if (strcmp(token_, m.args[0].s) != 0) {
      strncpy(token_, m.args[0].s, sizeof(token_) - 1);
      prefs.putString("token", token_);
    }
    helloAt_ = 0;                                          // tell Dream at once that it arrived
  } else if (strcmp(what, "ping") == 0 && m.count >= 1 && m.args[0].type == 'i') {
    // #278: Dream measures the way there and back (the panel shows half of it as the delay)
    char tag[24];
    snprintf(tag, sizeof(tag), "%spong", PREFIX);
    send(dream_osc::Writer(out_ + dream_radio::HEAD, sizeof(out_) - dream_radio::HEAD).build(tag, "si", id_, m.args[0].i));
  } else if (strcmp(what, "radio") == 0 && m.count >= 1 && m.args[0].type == 'i' && via_ == Via::WiFi && hasRx_ &&
             static_cast<int32_t>(now - hintBlockUntil_) >= 0) {
    // #278: Dream says the receiver this stick is paired with is plugged in, on this channel: over to the radio
    toRadio(static_cast<uint8_t>(m.args[0].i), now);
  }
}

void Link::receiveUdp(uint32_t now) {
  for (int size; (size = udp_.parsePacket()) > 0;) {
    int n = udp_.read(in_, sizeof(in_));
    if (udp_.remoteIP() != dream_ || n <= 0) continue;       // only Dream's answers count
    dream_osc::Message m;
    if (!dream_osc::parse(in_, static_cast<size_t>(n), &m)) continue;
    handle(m, now);
    if (via_ != Via::WiFi) return;
  }
}

void Link::send(size_t n) {
  if (n == 0) return;
  if (via_ == Via::Radio) {                  // to the receiver (encrypted with this stick's key)
    if (!hasRx_) return;
    dream_radio::head(out_, sizeof(out_), dream_radio::OSC);
    esp_now_send(rx_, out_, n + dream_radio::HEAD);
    return;
  }
  if (phase_ != Phase::Linked) return;
  udp_.beginPacket(dream_, port_);
  udp_.write(out_ + dream_radio::HEAD, n);
  udp_.endPacket();
}

void Link::imu(uint32_t ms, float ax, float ay, float az, float gx, float gy, float gz) {
  char tag[24];
  snprintf(tag, sizeof(tag), "%simu", PREFIX);
  send(dream_osc::Writer(out_ + dream_radio::HEAD, sizeof(out_) - dream_radio::HEAD)
           .build(tag, "siffffff", id_, static_cast<int32_t>(ms & 0x7fffffff), ax, ay, az, gx, gy, gz));
}

void Link::clutchWish(bool want, uint32_t seq) {
  char tag[24];
  snprintf(tag, sizeof(tag), "%sclutch", PREFIX);
  send(dream_osc::Writer(out_ + dream_radio::HEAD, sizeof(out_) - dream_radio::HEAD)
           .build(tag, "ssii", id_, token_, static_cast<int32_t>(want), static_cast<int32_t>(seq)));
}

void Link::button(bool down) {
  char tag[40];
  snprintf(tag, sizeof(tag), "/sticks3/%s/button", id_ + 6);   // an ordinary sensor button (sensors.py): the lab's feedback
  send(dream_osc::Writer(out_ + dream_radio::HEAD, sizeof(out_) - dream_radio::HEAD).build(tag, "i", static_cast<int32_t>(down)));
}

}  // namespace dream
