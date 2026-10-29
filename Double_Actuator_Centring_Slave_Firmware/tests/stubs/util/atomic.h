#pragma once
// Native tests have no interrupts. Production uses AVR's restore-state block.
#define ATOMIC_RESTORESTATE 0
#define ATOMIC_BLOCK(unused) for (bool testAtomicOnce = true; testAtomicOnce; testAtomicOnce = false)
