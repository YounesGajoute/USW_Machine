#pragma once

class Servo {
 public:
  void attach(int, int, int) { attached_ = true; }
  void detach() { attached_ = false; }
  void writeMicroseconds(int value) { pulse_ = value; }
  bool attached() const { return attached_; }
  int readMicroseconds() const { return pulse_; }

 private:
  bool attached_ = false;
  int pulse_ = 0;
};
