#define main commandAuditMain
#include "production_command_audit.cpp"
#undef main
int main() {
  reset(); actuators::pulse[0]=2000; homeInputs[0]=true;
  command("HOME_UPPER"); tick(false);
  printf("HOME on asserted UH: PWM 2000 -> %u, busy=%d\n",actuators::pulseUpper(),actuators::busy());
  report("HOME must not step farther into asserted HOME",actuators::pulseUpper()<=2000);

  for (unsigned i=0; i<100; ++i) tick(false);
  printf("HOME recovery while UH stays asserted reaches PWM=%u\n",actuators::pulseUpper());

  reset(); actuators::pulse[0]=2102; homeInputs[0]=true;
  command("CALIBRATE"); tick(false);
  printf("CALIBRATE on asserted UH: PWM 2102 -> %u\n",actuators::pulseUpper());
  report("CALIBRATE must not step farther into asserted HOME",actuators::pulseUpper()<=2102);

  reset(); actuators::pulse[0]=544;
  command("SEEK_TRAVEL_UPPER"); tick(false); homeInputs[0]=true;
  unsigned prior=actuators::pulseUpper(); tick(false);
  printf("TRAVEL recovery with UH asserted: PWM %u -> %u\n",prior,actuators::pulseUpper());
  report("TRAVEL reverse must respect HOME switch",actuators::pulseUpper()<=prior);

  reset(); emergencyInput=true; actuators::init();
  report("boot with E-stop must leave PWM detached",bothDetached());

  reset(); homeInputs[0]=travelInputs[0]=true; actuators::pollSafety();
  command("SETCAL restored 2102 1266 1538 742"); actuators::pollSafety();
  printf("SETCAL both-limits fault: attached=%d busy=%d moveEnd=%d\n",!bothDetached(),actuators::busy(),int(actuators::lastMoveEnd()));
  report("SETCAL must not re-enable PWM during both-limits fault",bothDetached() && has("accepted=0"));

  reset(); command("MOVEBOTHMM 20 45"); finishMotion();
  homeInputs[0]=true; tick(false);
  printf("late HOME while holding: PWM=%u calHOME=2102 attached=%d end=%d\n",actuators::pulseUpper(),!bothDetached(),int(actuators::lastMoveEnd()));
  report("contradictory endpoint during gap hold releases PWM",bothDetached());

  reset(); actuators::speedDegS=0.01f;
  printf("0.01 deg/s: step at dt1=%u dt20=%u (expected average 0.103us/s)\n",actuators::usStepForDt(1),actuators::usStepForDt(20));
  report("tiny requested speed does not force one us per tick",actuators::usStepForDt(1)==0);
  actuators::speedDegS=45;
  printf("45 deg/s: dt1=%u dt2=%u dt20=%u\n",actuators::usStepForDt(1),actuators::usStepForDt(2),actuators::usStepForDt(20));

  reset(); command("MOVEBOTHMM 20 45"); command("MOVEBOTHMM 30 45");
  output.clear(); finishMotion();
  printf("completed target after rejected second MOVE: %s\n",output.c_str());
  report("rejected MOVE cannot overwrite accepted targetH",has("targetH=20.00"));

  reset(); command("HOME_UPPER"); emergencyInput=true; actuators::pollSafety(); command("PING");
  report("query cannot consume pending fault completion",actuators::consumeCompletionEvent());

  for (int cause=0; cause<3; ++cause) {
    reset(); command("CALIBRATE");
    if(cause==0) actuators::onDisconnect();
    if(cause==1) { emergencyInput=true; actuators::pollSafety(); }
    if(cause==2) { homeInputs[0]=travelInputs[0]=true; actuators::pollSafety(); }
    printf("cal abort cause %d: valid=%d hu=%u\n",cause,kinematics::calValid(),kinematics::cal().hu);
    report("calibration abort restores previous known calibration",kinematics::calValid() && kinematics::cal().hu==2102);
  }
  reset(); command("SETHENDS 30 4"); float previous=kinematics::hminMm(); command("SETCAL restored 2102 1266 1538 742");
  printf("SETHENDS followed by pulses-only SETCAL: hmin %.4f -> %.4f\n",previous,kinematics::hminMm());
  report("pulses-only SETCAL retains gauge height mapping",fabsf(previous-kinematics::hminMm())<0.001);
  printf("SUMMARY: %u passed, %u failed; offline only\n",passed,failed);
  return failed?1:0;
}
