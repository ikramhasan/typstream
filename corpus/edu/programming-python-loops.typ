#set page(margin: 2cm)
#set text(size: 11pt)
#show raw.where(block: true): block.with(fill: luma(245), inset: 8pt, radius: 4pt, width: 100%)
#show raw.where(block: false): box.with(fill: luma(240), inset: (x: 3pt), outset: (y: 3pt), radius: 2pt)

= Python Practice: Loops

*Computer Science — Year 8*

A `for` loop repeats code for each item in a sequence. A `while` loop repeats as long as a condition is `True`.

== Example 1 — Counting

```python
for i in range(1, 6):
    print(i * i)
```

*Output:* `1 4 9 16 25` (each on a new line).

== Example 2 — Running total

```python
total = 0
number = int(input("Enter a number (0 to stop): "))
while number != 0:
    total += number
    number = int(input("Enter a number (0 to stop): "))
print(f"The total is {total}")
```

== Predict the output

Write what each program prints.

+ ```python
  for letter in "CODE":
      print(letter.lower())
  ```
+ ```python
  n = 10
  while n > 0:
      n -= 3
  print(n)
  ```
+ ```python
  words = ["apple", "kiwi", "banana"]
  for w in words:
      if len(w) > 4:
          print(w.upper())
  ```

== Find the bug

This program should print the numbers 1 to 10, but it never stops. Explain why and fix it.

```python
count = 1
while count <= 10:
    print(count)
```

== Write your own

+ Print the 7 times table from $7 times 1$ to $7 times 12$.
+ Ask the user for a password until they type `"letmein"`.
+ Print every *even* number between 1 and 50 using `range` with a step.

#v(1em)

#table(
  columns: (auto, 1fr),
  [*Keyword*], [*Meaning*],
  [`break`], [leave the loop immediately],
  [`continue`], [skip to the next iteration],
  [`range(a, b, s)`], [numbers from `a` up to (not including) `b`, counting in steps of `s`],
)

Inline raw with backticks inside: ``` `code` ``` and a JSON snippet `{"key": [1, 2, 3]}`.

```js
// JavaScript for comparison
for (let i = 0; i < 5; i++) console.log(`i = ${i}`);
```
