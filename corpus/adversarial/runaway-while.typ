= Counting forever

// The condition depends on a variable, so Typst can't reject it statically
// (`while true` is a compile error); its loop guard has to stop it.
#let i = 0
#while i >= 0 {
  i += 1
}

Never reached: #i
