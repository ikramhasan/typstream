| browser | profile | engine | format | backend | wasm dl+compile ms | fonts ms | first compile 1p ms | 5p stream p50/p90 ms | 20p stream p50/p90 ms | 20p main-thread render p50/p90 ms | 20p warm recompile ms | long tasks >50ms |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| chromium | local | custom(html-svg) | html | coi | 106 | 41 | 14 | 5 / 8 | 22 / 47 | 2 / 3 | 2 | 0 |
| chromium | local | custom(slim-html-svg) | html | coi | 68 | 39 | 13 | 5 / 7 | 21 / 44 | 2 / 3 | 2 | 0 |
| chromium | local | custom(html-svg) | svg | coi | 86 | 34 | 26 | 20 / 33 | 86 / 161 | 58 / 115 | 115 | 23 |
| chromium | local | typstts | paged | coi | 105 | 34 | 42 | 5 / 9 | 21 / 39 | 4 / 5 | 7 | 1 |
| chromium | local | typstwasm | html | jspi | 90 | 27 | 15 | 8 / 12 | 31 / 63 | 1 / 2 | 3 | 0 |
| chromium | local | typstwasm | html | worker | 90 | 29 | 15 | 10 / 15 | 34 / 63 | 2 / 3 | 4 | 0 |
| chromium | local | typstwasm | svg | coi | 90 | 29 | 27 | 41 / 70 | 165 / 301 | 53 / 104 | 126 | 22 |
| chromium | local | typstwasmw | html | jspi-in-worker | 101 | 43 | 18 | 9 / 17 | 35 / 71 | 2 / 3 | 4 | 0 |
| chromium | local | typstwasmw | svg | jspi-in-worker | 98 | 30 | 28 | 44 / 71 | 183 / 326 | 57 / 119 | 148 | 25 |
| chromium | throttled | custom(html-svg) | html | coi | 2413 | 814 | 12 | 5 / 8 | – | 2 / 4 (5p) | – | 0 |
| chromium | throttled | custom(html-svg) | svg | coi | 2408 | 817 | 25 | 21 / 31 | – | 50 / 101 (5p) | – | 22 |
| chromium | throttled | typstts | paged | coi | 3388 | 843 | 50 | 6 / 10 | – | 4 / 13 (5p) | – | 1 |
| chromium | throttled | typstwasm | html | jspi | 2568 | 663 | 74 | 42 / 66 | – | 2 / 2 (5p) | – | 0 |
| chromium | throttled | typstwasm | html | coi | 2559 | 644 | 15 | 10 / 27 | – | 2 / 3 (5p) | – | 0 |
| chromium | throttled | typstwasm | svg | coi | 2558 | 645 | 25 | 36 / 60 | – | 45 / 79 (5p) | – | 18 |
| chromium | throttled | typstwasmw | html | jspi-in-worker | 2607 | 638 | 17 | 10 / 15 | – | 2 / 4 (5p) | – | 0 |
| chromium | throttled | typstwasmw | svg | jspi-in-worker | 2623 | 636 | 29 | 47 / 73 | – | 57 / 111 (5p) | – | 24 |
| firefox | local | custom(html-svg) | html | coi | 122 | 56 | 3 | 6 / 9 | 21 / 35 | 2 / 4 | 2 | 0 |
| firefox | local | custom(slim-html-svg) | html | coi | 117 | 50 | 3 | 7 / 10 | 22 / 35 | 2 / 4 | 2 | 0 |
| firefox | local | custom(html-svg) | svg | coi | 125 | 38 | 5 | 23 / 36 | 96 / 164 | 77 / 141 | 129 | 0 |
| firefox | local | typstts | paged | coi | 345 | 75 | 5 | 10 / 22 | 26 / 58 | 17 / 32 | 9 | 0 |
| firefox | local | typstwasm | html | jspi | 173 | 20 | 4 | 10 / 16 | 35 / 57 | 1 / 2 | 5 | 0 |
| firefox | local | typstwasm | html | worker | 186 | 24 | 5 | 9 / 14 | 28 / 68 | 2 / 5 | 5 | 0 |
| firefox | local | typstwasm | svg | coi | 138 | 18 | 5 | 44 / 63 | 255 / 1069 | 77 / 539 | 234 | 0 |
| firefox | local | typstwasmw | html | jspi-in-worker | 253 | 32 | 3 | 12 / 15 | 32 / 51 | 3 / 5 | 5 | 0 |
| firefox | local | typstwasmw | svg | jspi-in-worker | 198 | 34 | 6 | 48 / 77 | 188 / 350 | 90 / 149 | 133 | 0 |
| webkit | local | custom(html-svg) | html | coi | 79 | 28 | 14 | 6 / 7 | 17 / 28 | 4 / 7 | 2 | 0 |
| webkit | local | custom(slim-html-svg) | html | coi | 77 | 28 | 16 | 5 / 8 | 16 / 27 | 4 / 7 | 2 | 0 |
| webkit | local | custom(html-svg) | svg | coi | 78 | 24 | 30 | 21 / 33 | 81 / 140 | 146 / 263 | 113 | 0 |
| webkit | local | typstts | paged | coi | 100 | 26 | 19 | 7 / 14 | 24 / 44 | 6 / 13 | 6 | 0 |
| webkit | local | typstwasm | html | jspi | 154 | 39 | 17 | 9 / 19 | 29 / 45 | 2 / 4 | 4 | 0 |
| webkit | local | typstwasm | html | worker | 206 | 43 | 21 | 12 / 20 | 33 / 49 | 4 / 6 | 6 | 0 |
| webkit | local | typstwasm | svg | coi | 118 | 33 | 41 | 52 / 81 | 158 / 281 | 138 / 249 | 120 | 0 |
| webkit | local | typstwasmw | html | jspi-in-worker | 129 | 23 | 20 | 9 / 12 | 25 / 41 | 3 / 6 | 4 | 0 |
| webkit | local | typstwasmw | svg | jspi-in-worker | 86 | 16 | 30 | 37 / 58 | 139 / 234 | 144 / 265 | 115 | 0 |
