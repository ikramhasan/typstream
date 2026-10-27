= Worksheet

// Markup in text, code, math, attribute values and labels: Typst escapes it,
// and it must reach the page as text.

Type \<script>window.typstreamPwned = "text"\</script> into the box.
\<img src=x onerror="window.typstreamPwned = 'text-img'">

`<script>window.typstreamPwned = "raw"</script>`

```html
<img src=x onerror="window.typstreamPwned = 'block-raw'">
```

$ "<script>alert(1)</script>" $

#html.elem("div", attrs: (title: "\"><script>window.typstreamPwned = 'attr'</script>"))[Attribute value]

#figure(caption: [\<svg onload="window.typstreamPwned = 'caption'">])[A figure]

#set heading(numbering: "1.")
== \<b onmouseover="alert(1)">Heading\</b> <heading-label>
See @heading-label.
