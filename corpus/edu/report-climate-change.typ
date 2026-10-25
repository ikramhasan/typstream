#set document(title: "Climate Change: Causes, Effects and Responses", author: "Class 11C")
#set page(
  paper: "a4",
  margin: (inside: 2.5cm, outside: 2cm, y: 2.5cm),
  numbering: "i",
)
#set text(size: 11pt)
#set par(justify: true, leading: 0.65em)
#set heading(numbering: "1.1")
#show heading.where(level: 1): it => {
  pagebreak(weak: true)
  v(2cm)
  text(20pt, it)
  v(0.5cm)
}
#show link: set text(fill: blue.darken(30%))

#align(center + horizon)[
  #text(24pt, weight: "bold")[Climate Change] \
  #v(0.3em)
  #text(14pt)[Causes, Effects and Responses]

  #v(2cm)
  A research report by Class 11C \
  Environmental Science
]

#pagebreak()

#outline(depth: 2, indent: auto)

#outline(title: [List of Figures], target: figure.where(kind: image))

#outline(title: [List of Tables], target: figure.where(kind: table))

#set page(numbering: "1")
#counter(page).update(1)

= Introduction

The Earth's climate has always changed, but the rate of warming since the mid-twentieth century is
unprecedented over at least the last 2,000 years @ipcc2021. This report summarises the scientific
evidence for human-caused climate change, its observed and projected effects, and the main ways in
which societies are responding.

== Scope

We focus on three questions:

+ What causes the current warming?
+ What effects can already be observed?
+ What can individuals, governments and businesses do?

= Causes

== The greenhouse effect

Certain gases in the atmosphere absorb and re-emit infrared radiation, warming the surface. Without
this natural greenhouse effect, the Earth's average temperature would be about $-18 degree"C"$
instead of $+15 degree"C"$ @houghton2015.

#figure(
  rect(width: 80%, height: 4cm, fill: gradient.linear(rgb("#fff59d"), rgb("#90caf9"), angle: 90deg))[
    #align(center + horizon)[_Diagram: incoming solar radiation, outgoing infrared, absorption by greenhouse gases_]
  ],
  caption: [The greenhouse effect (schematic).],
) <fig-greenhouse>

As @fig-greenhouse shows, increasing the concentration of greenhouse gases traps more energy.

== Human contributions

#figure(
  table(
    columns: 3,
    align: (left, right, right),
    table.header([*Gas*], [*Pre-industrial*], [*2023*]),
    [Carbon dioxide ($"CO"_2$)], [280 ppm], [420 ppm],
    [Methane ($"CH"_4$)], [700 ppb], [1,920 ppb],
    [Nitrous oxide ($"N"_2"O"$)], [270 ppb], [336 ppb],
  ),
  caption: [Atmospheric concentrations of the main greenhouse gases.],
) <tab-gases>

@tab-gases shows that carbon dioxide has risen by about 50% since 1750, mainly from burning fossil
fuels and deforestation.#footnote[Concentrations are global annual means from ice cores and direct measurements.]

= Effects

== Observed changes

- Global average surface temperature has risen by about $1.1 degree"C"$ since 1850–1900.
- Arctic sea ice in September has declined by roughly 13% per decade since 1979.
- Global mean sea level rose by about 20 cm between 1901 and 2018 @ipcc2021.
- Heatwaves have become more frequent and more intense on most land areas.

== Projected changes

The size of future changes depends on emissions. Under a high-emissions scenario, warming could
exceed $4 degree"C"$ by 2100; limiting warming to $1.5 degree"C"$ requires reaching net zero
$"CO"_2$ emissions around 2050 @ipcc2021.

#figure(
  rect(width: 70%, height: 3.5cm, stroke: 0.5pt)[#align(center + horizon)[_Line chart: temperature projections under four scenarios_]],
  caption: [Projected global temperature change by scenario.],
) <fig-projections>

= Responses

== Mitigation

Mitigation means reducing emissions or increasing carbon sinks:

/ Energy: switching from coal and gas to wind, solar, hydro and nuclear power.
/ Transport: electric vehicles, public transport and active travel.
/ Buildings: insulation and heat pumps.
/ Land: protecting forests and restoring peatlands @stern2007.

== Adaptation

Adaptation means preparing for changes that can no longer be avoided, such as building flood
defences, developing drought-resistant crops and updating building codes for heat.

= Conclusion

The evidence that humans are warming the planet is overwhelming. The effects are already visible,
and they will grow unless emissions fall rapidly. The good news is that many solutions exist; the
challenge is deploying them quickly and fairly. See @fig-projections for why the next decade matters.

#bibliography("assets/climate-refs.yml", title: "References", style: "apa")
