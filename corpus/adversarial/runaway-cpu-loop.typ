= Practice problems

// A finite loop that takes minutes: 400 million iterations. No built-in guard
// stops it; only the engine's watchdog can.
#let count = 0
#for a in range(20000) {
  for b in range(20000) {
    count += 1
  }
}

Generated #count problems.
