// Dream's worn devices (#277): the few OSC messages they exchange with Dream (wearables.py) – written and read here
// without a library, so the same header compiles on the device and on a computer (tests/test_firmware_osc.py checks
// it against the OSC library Dream itself uses).
//
// OSC 1.0: the address and the type tags as texts padded with zeros to four bytes, then the arguments big-endian
// (int32 "i", float32 "f", texts "s" padded like the address). Only these three types are written or read.
#pragma once
#include <stdarg.h>
#include <stddef.h>
#include <stdint.h>
#include <string.h>

namespace dream_osc {

static const size_t MAX_ARGS = 8;

struct Arg {
  char type;           // 'i', 'f' or 's'
  int32_t i;
  float f;
  const char* s;       // points into the packet (zero-terminated there)
};

struct Message {
  const char* address;
  size_t count;
  Arg args[MAX_ARGS];
};

inline size_t pad4(size_t n) { return (n + 4) & ~static_cast<size_t>(3); }   // a text and its zero, to four bytes

class Writer {
 public:
  Writer(uint8_t* buf, size_t cap) : buf_(buf), cap_(cap), n_(0), ok_(true) {}
  size_t size() const { return ok_ ? n_ : 0; }

  // tags: one letter per argument ("siffffff"); the arguments follow as int32_t (i), double (f) and const char* (s)
  size_t build(const char* address, const char* tags, ...) {
    va_list ap;
    va_start(ap, tags);
    n_ = 0;
    ok_ = true;
    text(address);
    char typetag[MAX_ARGS + 2] = ",";
    size_t nt = strlen(tags);
    if (nt > MAX_ARGS) ok_ = false;
    else memcpy(typetag + 1, tags, nt + 1);
    text(typetag);
    for (size_t k = 0; ok_ && k < nt; k++) {
      switch (tags[k]) {
        case 'i': word(static_cast<uint32_t>(va_arg(ap, int32_t))); break;
        case 'f': { float v = static_cast<float>(va_arg(ap, double)); uint32_t u; memcpy(&u, &v, 4); word(u); break; }
        case 's': text(va_arg(ap, const char*)); break;
        default: ok_ = false;
      }
    }
    va_end(ap);
    return size();
  }

 private:
  void text(const char* s) {
    size_t len = strlen(s), all = pad4(len);
    if (n_ + all > cap_) { ok_ = false; return; }
    memcpy(buf_ + n_, s, len);
    memset(buf_ + n_ + len, 0, all - len);
    n_ += all;
  }
  void word(uint32_t u) {
    if (n_ + 4 > cap_) { ok_ = false; return; }
    buf_[n_++] = u >> 24; buf_[n_++] = u >> 16; buf_[n_++] = u >> 8; buf_[n_++] = u;
  }
  uint8_t* buf_;
  size_t cap_, n_;
  bool ok_;
};

// A text at buf[*at] that ends inside the packet; *at moves past its padding. nullptr: no such text.
inline const char* read_text(const uint8_t* buf, size_t n, size_t* at) {
  if (*at >= n) return nullptr;
  const char* s = reinterpret_cast<const char*>(buf + *at);
  size_t left = n - *at;
  const void* end = memchr(s, 0, left);
  if (end == nullptr) return nullptr;
  size_t all = pad4(static_cast<const char*>(end) - s);
  if (all > left) return nullptr;
  *at += all;
  return s;
}

// Reads one message (no bundles). The packet must stay as it is while the message is used.
inline bool parse(const uint8_t* buf, size_t n, Message* m) {
  size_t at = 0;
  if (n < 8 || n % 4 || buf[0] != '/') return false;
  m->address = read_text(buf, n, &at);
  const char* tags = m->address ? read_text(buf, n, &at) : nullptr;
  if (!tags || tags[0] != ',') return false;
  m->count = 0;
  for (const char* t = tags + 1; *t; t++) {
    if (m->count == MAX_ARGS) return false;
    Arg& a = m->args[m->count++];
    a.type = *t;
    if (*t == 's') {
      a.s = read_text(buf, n, &at);
      if (!a.s) return false;
    } else if (*t == 'i' || *t == 'f') {
      if (at + 4 > n) return false;
      uint32_t u = (uint32_t(buf[at]) << 24) | (uint32_t(buf[at + 1]) << 16) | (uint32_t(buf[at + 2]) << 8) | buf[at + 3];
      at += 4;
      if (*t == 'i') a.i = static_cast<int32_t>(u);
      else memcpy(&a.f, &u, 4);
    } else {
      return false;
    }
  }
  return true;
}

// The message's argument k as a number (an int or a float), or `otherwise`
inline float number(const Message& m, size_t k, float otherwise = 0) {
  if (k >= m.count) return otherwise;
  return m.args[k].type == 'i' ? static_cast<float>(m.args[k].i) : m.args[k].type == 'f' ? m.args[k].f : otherwise;
}

}  // namespace dream_osc
