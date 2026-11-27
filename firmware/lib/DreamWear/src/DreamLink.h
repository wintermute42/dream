// Dream's worn devices (#277, #278): the link to Dream – by radio to the USB receiver on the Mac (ESP-NOW, #278:
// DreamRadio.h) or, when no receiver answers, over the Wi-Fi (set up once through a setup hotspot, kept in the device's
// own memory, never in the code), finding Dream (mDNS `_dream-osc._udp`, or the address entered in the setup) and
// sending the messages of wearables.py over UDP. Either way the messages are the same. Nothing here waits for an answer:
// a lost packet is sent again by the loop.
#pragma once
#include <Arduino.h>
#include <IPAddress.h>
#include <WiFiUdp.h>

#include "DreamOsc.h"
#include "DreamRadio.h"

namespace dream {

// Setup: the Wi-Fi setup hotspot is open · WiFi: no Wi-Fi · Looking: looking for Dream in the Wi-Fi ·
// Receiver: looking for its receiver by radio · Linked: packets go to Dream (over the receiver or the Wi-Fi)
enum class Phase { Setup, WiFi, Looking, Receiver, Linked };
enum class Via { Radio, WiFi };

struct SetupInfo {          // what the device shows while its setup hotspot is open
  const char* ap;           // the hotspot's name
  const char* password;     // its password, made up at each start of the setup
  const char* address;      // where the setup page is
};

class Link {
 public:
  // kind: "sticks3" (what the hello says). setup: open the setup hotspot now (a button held at start). showSetup:
  // called before the hotspot opens (it blocks until the setup is done or SETUP_SECONDS passed) – the hotspot has a
  // random password the device shows there. Before anything else the device calls for a receiver in pairing mode
  // (PAIR_CALL_MS on every channel) and then looks for the receiver it knows; only without one it goes into the Wi-Fi.
  void begin(const char* kind, bool setup, void (*showSetup)(const SetupInfo&));
  void loop(uint32_t now);                    // call often: the radio or the Wi-Fi, finding Dream, the answers

  Phase phase() const { return phase_; }
  Via via() const { return via_; }
  const char* id() const { return id_; }      // twelve hex digits of the device's own address
  const char* shortId() const { return id_ + 8; }
  bool justPaired() const { return justPaired_; }   // paired with a receiver at this start

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
  static const uint32_t PAIR_CALL_MS = 150;   // per channel: the pair call at every start takes 13 × this

 private:
  void send(size_t n);
  void handle(const dream_osc::Message& m, uint32_t now);
  void receiveUdp(uint32_t now);
  void receiveRadio(uint32_t now);
  void look(uint32_t now);
  bool resolve(const char* host, IPAddress* ip);
  void hello(uint32_t now);
  // the radio (#278)
  void radioBegin();
  bool pairCall();
  bool findReceiver(uint32_t waitMs);
  void radioLoop(uint32_t now);
  void toRadio(uint8_t channel, uint32_t now);
  void setChannel(uint8_t channel);
  // the Wi-Fi (#277)
  void wifiBegin(bool portal, void (*showSetup)(const SetupInfo&));
  void toWiFi(uint32_t now);
  void wifiLoop(uint32_t now);
  bool wifiKnown() const;

  const char* kind_ = "";
  char id_[13] = {0};
  char token_[33] = {0};
  char host_[64] = {0};                       // entered in the setup: "" (find Dream) or "address[:port]"
  Phase phase_ = Phase::Receiver;
  Via via_ = Via::Radio;
  WiFiUDP udp_;
  bool wifiStarted_ = false;
  IPAddress dream_;
  uint16_t port_ = 7020;
  uint32_t got_ = 0, helloAt_ = 0, lookAt_ = 0, wifiAt_ = 0, linkedAt_ = 0;
  int battery_ = -1;
  bool clutch_ = false, paired_ = false, setupUnfinished_ = false, justPaired_ = false;
  uint32_t ack_ = 0;
  // the receiver: its address, this stick's key, its channel
  bool hasRx_ = false;
  uint8_t rx_[6] = {0};
  uint8_t rxKey_[dream_radio::KEY] = {0};
  uint8_t rxChannel_ = dream_radio::DEFAULT_CHANNEL, channel_ = 0;
  uint32_t scanAt_ = 0, scanned_ = 0, radioSince_ = 0, hintBlockUntil_ = 0, hintBlockMs_ = 60000;
  uint8_t out_[dream_radio::HEAD + 128];      // a radio frame's head, then the OSC packet (UDP sends from out_ + HEAD)
  uint8_t in_[256];
};

}  // namespace dream
