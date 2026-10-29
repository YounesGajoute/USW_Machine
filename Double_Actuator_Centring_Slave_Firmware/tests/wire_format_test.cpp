#define main commandAuditMain
#include "production_command_audit.cpp"
#undef main
#include <assert.h>
#include <limits>

std::string expected(float value, unsigned decimals) {
  if (isnan(value)) return decimals == 2 ? "0.00" : "0.0";
  std::string sign = value < 0 ? "-" : "";
  value = fabsf(value);
  const uint32_t scale = decimals == 2 ? 100 : 1000000;
  const float ceiling = decimals == 2 ? 40000000.0f : 4000.0f;
  if (value > ceiling) value = ceiling;
  const uint32_t rounded = static_cast<uint32_t>(value * float(scale) + .5f);
  std::string whole = std::to_string(rounded / scale);
  std::string fraction = std::to_string(rounded % scale);
  fraction.insert(0, decimals - fraction.size(), '0');
  if (decimals == 6) while (fraction.size() > 1 && fraction.back() == '0') fraction.pop_back();
  return sign + whole + "." + fraction;
}

void check(float v, unsigned decimals) {
  output.clear();
  protocol::wFixed(v, decimals);
  protocol::flushChunk();
  assert(output == expected(v, decimals));
}

int main() {
  reset();
  for (unsigned decimals : {2, 6}) {
    for (float v : {0.f, -0.f, .000001f, .0000005f, .005f, .1f, 1.f, 1.01f,
                    9.999f, 99.995f, 4000.f, 40000000.f,
                    std::numeric_limits<float>::infinity(), std::numeric_limits<float>::quiet_NaN()}) {
      check(v, decimals); check(-v, decimals);
    }
    uint32_t state = 123456;
    for (unsigned i = 0; i < 10000; ++i) {
      state = state * 1664525U + 1013904223U;
      check(float(state % 10000000) / (i % 2 ? 1000.f : 1000000.f), decimals);
      check(-float(state % 10000000) / 1000000.f, decimals);
    }
  }
  puts("PASS: 40,056 fixed-decimal wire cases, rounding, zero padding, trimming, clamps and non-finite values");
}
