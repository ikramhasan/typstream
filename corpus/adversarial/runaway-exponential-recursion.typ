= Binary tree of examples

// 2^40 calls. Every call has distinct arguments, so memoization can't collapse
// the tree the way it does for `f(n - 1) + f(n - 1)`.
#let tree(depth, id) = if depth == 0 { id } else { tree(depth - 1, 2 * id) + tree(depth - 1, 2 * id + 1) }

#tree(40, 1)
