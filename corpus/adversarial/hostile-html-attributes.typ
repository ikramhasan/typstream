= Worksheet

// Attributes on elements the sanitizer keeps: event handlers, URL attributes,
// CSS that loads or escapes the document's box, and ids that would clobber
// globals. Allowed elements stay; these attributes go.

#html.elem("div", attrs: (onclick: "window.typstreamPwned = 'onclick'", onmouseover: "alert(1)"))[Handlers]
#html.elem("img", attrs: (src: "x", onerror: "window.typstreamPwned = 'onerror'", alt: "broken"))
#html.elem("img", attrs: (src: "javascript:alert(1)", alt: "script source"))
#html.elem("img", attrs: (src: "https://tracker.example/pixel.png", alt: "tracking pixel"))
#html.elem("img", attrs: (src: "data:image/png;base64,iVBORw0KGgo=", srcset: "https://tracker.example/2x.png 2x", alt: "srcset"))
#html.elem("a", attrs: (href: "javascript:alert(1)"))[Script link]
#html.elem("a", attrs: (href: "https://example.com/", ping: "https://tracker.example/ping", target: "_top"))[Ping]
#html.elem("div", attrs: (style: "background: url(https://tracker.example/bg.png)"))[CSS url()]
#html.elem("div", attrs: (style: "background: \\75 rl(https://tracker.example/escaped.png)"))[CSS escapes]
#html.elem("div", attrs: (style: "background-image: image-set('https://tracker.example/set.png' 1x)"))[image-set]
#html.elem("div", attrs: (style: "position: fixed; inset: 0; z-index: 2147483647; background: white"))[A fixed overlay]
#html.elem("div", attrs: (style: "position: absolute; top: 0; left: 0; width: 100vw; height: 100vh"))[An absolute overlay]
#html.elem("div", attrs: (class: "fixed inset-0 z-50 bg-white"))[The host page's overlay classes]
#html.elem("div", attrs: (style: "position: relative; top: -100vh; left: -100vw; width: 300vw; height: 300vh; z-index: 2147483647; background: white"))[A relative overlay]
#html.elem("div", attrs: (style: "margin: -2000px; width: 5000px; height: 5000px; background: white"))[Negative margins]
#html.elem("div", attrs: (style: "transform: scale(100); background: white"))[A transform]
#html.elem("div", attrs: (style: "box-shadow: 0 0 0 100vmax white; outline: 100vmax solid white"))[A shadow and an outline]
#html.elem("div", attrs: (style: "position: absolute; inset: -100vh -100vw; pointer-events: none; background: white"))[An overlay clicks pass through]
#html.elem("div", attrs: (style: "width: expression(alert(1)); -moz-binding: url(https://evil.example/x.xml#x)"))[Old IE and Firefox]
#html.elem("div", attrs: (is: "x-evil"))[A customized built-in]
#html.elem("div", attrs: ("data-action": "delete", name: "config", id: "location"))[Data and names]
#html.elem("details", attrs: (open: "open", ontoggle: "window.typstreamPwned = 'ontoggle'"))[Toggle]
#html.elem("div", attrs: (tabindex: "0", autofocus: "autofocus", onfocus: "window.typstreamPwned = 'onfocus'"))[Focus]

#set heading(numbering: "1.")
== Clobbering <document>
A label becomes an id once something references it: @document.
