// Dream's worn devices (#277): the link to Dream – Wi-Fi (set up once through a setup hotspot, kept in the device's
// own memory, never in the code), finding Dream (mDNS `_dream-osc._udp`, or the address entered in the setup), and
// the messages of wearables.py over UDP. Nothing here waits for an answer: a lost packet is sent again by the loop.
#pragma once
#include <Arduino.h>
#include <IPAddress.h>
#include <WiFiUdp.h>

#include "DreamOsc.h"

namespace dream {

enum class Phase { Setup, WiFi, Looking, Linked };

struct SetupInfo {          // what the device shows while its setup hotspot is open
  const char* ap;           // the hotspot's name
  const char* password;     // its password, made up at each start of the setup
  const char* address;      // where the setup page is
};

class Link {
 public:
  // kind: "sticks3" (what the hello says). setup: open the setup hotspot now (a button held at start). showSetup:
  // called before the hotspot opens (it blocks until the setup is done or SETUP_SECONDS passed) – the hotspot has a
  // random password the device shows there.
  void begin(const char* kind, bool setup, void (*showSetup)(const SetupInfo&));
  void loop(uint32_t now);                    // call often: Wi-Fi, finding Dream, the answers

  Phase phase() const { return phase_; }
  const char* id() const { return id_; }      // twelve hex digits of the device's own address
  const char* shortId() const { return id_ + 8; }

  // Dream's last word: fresh while it came within FRESH_MS (else the device shows "?")
  bool fresh(uint32_t now) const { return got_ != 0 && now - got_ < FRESH_MS; }
  bool clutch() const { return clutch_; }
  bool paired() const { return paired_; }
  uint32_t acked() const { return ack_; }

  void battery(int percent) { battery_ = percent; }   // told in the hello the loop sends once a second (-1: unknown)
  void imu(uint32_t ms, float ax, float ay, float az, float gx, float gy, float gz);
  void clutchWish(bool want, uint32_t seq);
  void button(bool down);                     // the second button: the dance lab's "good" (twice: "bad")
  bool hasToken() const { return token_[0] != 0; }
  bool setupUnfinished() const { return setupUnfinished_; }   // the setup hotspot was open and nobody finished it

  static const uint32_t FRESH_MS = 2500;
  static const uint32_t SETUP_SECONDS = 300;

 private:
  void send(size_t n);
  void receive(uint32_t now);
  void look(uint32_t now);
  bool resolve(const char* host, IPAddress* ip);

  const char* kind_ = "";
  char id_[13] = {0};
  char token_[33] = {0};
  char host_[64] = {0};                       // entered in the setup: "" (find Dream) or "address[:port]"
  Phase phase_ = Phase::WiFi;
  WiFiUDP udp_;
  IPAddress dream_;
  uint16_t port_ = 7020;
  uint32_t got_ = 0, helloAt_ = 0, lookAt_ = 0, wifiAt_ = 0;
  int battery_ = -1;
  bool clutch_ = false, paired_ = false, setupUnfinished_ = false;
  uint32_t ack_ = 0;
  uint8_t out_[128];
  uint8_t in_[256];
};

}  // namespace dream
