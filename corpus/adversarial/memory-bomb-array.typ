= Answer bank

// Doubling an array 64 times: 2^64 elements. Allocation grows until the
// process runs out of memory.
#let bank = (0,)
#for _ in range(64) {
  bank += bank
}

#bank.len() answers.
