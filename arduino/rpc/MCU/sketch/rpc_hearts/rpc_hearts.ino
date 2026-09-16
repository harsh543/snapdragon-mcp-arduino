#include <Arduino_LED_Matrix.h>
#include "Arduino_RouterBridge.h"
#include "heart_frames.h"

const int STATUS_LED = LED_BUILTIN;
Arduino_LED_Matrix matrix;

int flash_heart() {
  digitalWrite(STATUS_LED, HIGH);

  matrix.loadSequence(HeartAnim);
  matrix.playSequence();
  delay(1000);
  matrix.loadFrame(HeartStatic);

  digitalWrite(STATUS_LED, LOW);
  return 1;
}

const char* mcu_ping() {
  for (int count = 0; count < 3; count++) {
    digitalWrite(STATUS_LED, HIGH);
    delay(100);
    digitalWrite(STATUS_LED, LOW);
    delay(100);
  }
  return "pong";
}

// Scope-sensitive alert: "local" strobes only the built-in LED, "all" also
// strobes the LED matrix. The scope parameter is the point of this tool,
// not the visual effect - it stands in for any action whose blast radius
// depends on a target the model can get wrong.
int trigger_alert(String target, int duration_ms) {
  bool all_leds = (target == "all");
  unsigned long deadline = millis() + (unsigned long)duration_ms;

  while (millis() < deadline) {
    digitalWrite(STATUS_LED, HIGH);
    if (all_leds) {
      matrix.loadFrame(HeartStatic);
    }
    delay(75);
    digitalWrite(STATUS_LED, LOW);
    if (all_leds) {
      matrix.clear();
    }
    delay(75);
  }

  matrix.loadFrame(HeartStatic);
  return 1;
}

void setup() {
  pinMode(STATUS_LED, OUTPUT);
  digitalWrite(STATUS_LED, LOW);

  matrix.begin();
  matrix.clear();
  matrix.loadFrame(HeartStatic);

  if (!Bridge.begin()) {
    while (true) {
      digitalWrite(STATUS_LED, !digitalRead(STATUS_LED));
      delay(100);
    }
  }

  Bridge.provide("flash_heart", flash_heart);
  Bridge.provide("mcu_ping", mcu_ping);
  Bridge.provide("trigger_alert", trigger_alert);
}

void loop() {
  delay(1);
}
