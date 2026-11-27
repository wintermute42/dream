#include "DreamLink.h"

#include <ESPmDNS.h>
#include <Preferences.h>
#include <WiFi.h>
#include <WiFiManager.h>

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
Preferences prefs;
bool saveHost = false;
WiFiManagerParameter* hostParam = nullptr;

void onSave() { saveHost = true; }

bool isHex(const char* s, size_t n) {
  if (strlen(s) != n) return false;
  for (size_t k = 0; k < n; k++)
    if (!isxdigit(static_cast<unsigned char>(s[k])) || isupper(static_cast<unsigned char>(s[k]))) return false;
  return true;
}
}  // namespace

void Link::begin(const char* kind, bool setup, void (*showSetup)(const SetupInfo&), bool password) {
  kind_ = kind;
  uint64_t mac = ESP.getEfuseMac();
  for (int k = 0; k < 6; k++) snprintf(id_ + 2 * k, 3, "%02x", static_cast<unsigned>((mac >> (8 * k)) & 0xff));
  prefs.begin("dream", false);
  prefs.getString("token", token_, sizeof(token_));
  if (!isHex(token_, 32)) token_[0] = 0;
  prefs.getString("host", host_, sizeof(host_));

  WiFi.mode(WIFI_STA);
  WiFiManager wm;
  wm.setDebugOutput(false);
  wm.setConfigPortalTimeout(SETUP_SECONDS);
  wm.setConnectTimeout(20);
  wm.setTitle("Dream");
  hostParam = new WiFiManagerParameter("dream", "Dream: address of the Mac (empty: Dream is found by itself)", host_, 63);
  wm.addParameter(hostParam);
  wm.setSaveParamsCallback(onSave);
  char ap[32], pass[12] = "";
  snprintf(ap, sizeof(ap), "Dream-%s-%s", strcmp(kind, "matrix") == 0 ? "Matrix" : "StickS3", shortId());
  for (char* c = ap; *c; c++) *c = (*c >= 'a' && *c <= 'f') ? *c - 32 : *c;
  if (password) snprintf(pass, sizeof(pass), "%08lu", static_cast<unsigned long>(esp_random() % 100000000UL));
  static SetupInfo info;
  info = {ap, pass, "192.168.4.1"};
  static void (*show)(const SetupInfo&) = nullptr;
  show = showSetup;
  wm.setAPCallback([](WiFiManager*) { if (show) show(info); });
  // The setup hotspot opens only when asked (a button held at start) or when no Wi-Fi is known yet. A device with its
  // Wi-Fi known never waits for anyone: it connects by itself, now or whenever the Wi-Fi is back (the loop) – it may sit
  // in a band where nobody sees or presses it.
  bool ok = false;
  if (setup || !wm.getWiFiIsSaved()) {
    phase_ = Phase::Setup;
    ok = wm.startConfigPortal(ap, password ? pass : nullptr);
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
  char name[32];
  snprintf(name, sizeof(name), "dream-%s-%s", kind, shortId());
  MDNS.begin(name);
  udp_.begin(0);                             // any local port: Dream answers to the port a packet came from
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

void Link::loop(uint32_t now) {
  if (WiFi.status() != WL_CONNECTED) {
    phase_ = Phase::WiFi;
    if (now - wifiAt_ > WIFI_RETRY_MS) { wifiAt_ = now; WiFi.reconnect(); }
    return;
  }
  if (phase_ == Phase::WiFi || phase_ == Phase::Setup) { phase_ = Phase::Looking; lookAt_ = 0; }
  if (phase_ == Phase::Looking) { look(now); if (phase_ != Phase::Linked) return; helloAt_ = 0; }
  receive(now);
  if (helloAt_ == 0 || now - helloAt_ >= HELLO_MS) {
    helloAt_ = now;
    char tag[24];
    snprintf(tag, sizeof(tag), "%shello", PREFIX);
    send(dream_osc::Writer(out_, sizeof(out_)).build(tag, "sssis", id_, kind_, token_, battery_, DREAM_FW_VERSION));
  }
  // Dream was heard from once and then fell silent (restarted elsewhere?): look for it again – an address entered
  // in the setup stays where it is
  if (!host_[0] && got_ != 0 && now - got_ > LOST_MS) { phase_ = Phase::Looking; lookAt_ = 0; }
}

void Link::receive(uint32_t now) {
  for (int size; (size = udp_.parsePacket()) > 0;) {
    int n = udp_.read(in_, sizeof(in_));
    if (udp_.remoteIP() != dream_ || n <= 0) continue;       // only Dream's answers count
    dream_osc::Message m;
    if (!dream_osc::parse(in_, static_cast<size_t>(n), &m) || strncmp(m.address, PREFIX, strlen(PREFIX)) != 0) continue;
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
    } else if (strcmp(what, "beat") == 0 && m.count >= 1) {
      float b = dream_osc::number(m, 0);
      if (b > beat_) beat_ = b > 1 ? 1 : b;
    }
  }
}

void Link::send(size_t n) {
  if (n == 0 || phase_ != Phase::Linked) return;
  udp_.beginPacket(dream_, port_);
  udp_.write(out_, n);
  udp_.endPacket();
}

void Link::imu(uint32_t ms, float ax, float ay, float az, float gx, float gy, float gz) {
  char tag[24];
  snprintf(tag, sizeof(tag), "%simu", PREFIX);
  send(dream_osc::Writer(out_, sizeof(out_)).build(tag, "siffffff", id_, static_cast<int32_t>(ms & 0x7fffffff),
                                                   ax, ay, az, gx, gy, gz));
}

void Link::clutchWish(bool want, uint32_t seq) {
  char tag[24];
  snprintf(tag, sizeof(tag), "%sclutch", PREFIX);
  send(dream_osc::Writer(out_, sizeof(out_)).build(tag, "ssii", id_, token_, static_cast<int32_t>(want), static_cast<int32_t>(seq)));
}

void Link::button(bool down) {
  char tag[40];
  snprintf(tag, sizeof(tag), "/sticks3/%s/button", id_ + 6);   // an ordinary sensor button (sensors.py): the lab's feedback
  send(dream_osc::Writer(out_, sizeof(out_)).build(tag, "i", static_cast<int32_t>(down)));
}

}  // namespace dream
