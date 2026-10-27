#set heading(numbering: "1.")

= Further reading

// Links whose targets run script or load something. The HTML sanitizer and the
// paged view's link filter keep only http(s), mailto and in-document links,
// reading the URL as browsers do (leading spaces and controls stripped, tabs
// and newlines removed, any case).

- #link("javascript:alert(document.domain)")[Answer key]
- #link("JaVaScRiPt:alert(1)")[Mixed case]
- #link("java\tscript:alert(1)")[A tab inside]
- #link(" \njava\nscript:alert(1)")[Leading space, newlines inside]
- #link("vbscript:msgbox(1)")[VBScript]
- #link("data:text/html,<script>alert(1)</script>")[A data URL]
- #link("data:text/html;base64,PHNjcmlwdD5hbGVydCgxKTwvc2NyaXB0Pg==")[A base64 data URL]
- #link("file:///etc/passwd")[A file]
- #link("blob:https://example.com/0")[A blob]
- #link("//evil.example/phish")[Protocol-relative]
- #link("intent://evil.example#Intent;scheme=https;end")[An Android intent]

These stay: #link("https://typst.app/docs")[the Typst docs], #link("mailto:teacher@example.com")[the teacher]
and @further.

= Answers <further>
