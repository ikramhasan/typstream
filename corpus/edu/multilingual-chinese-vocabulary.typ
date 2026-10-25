#set page(margin: 2cm)
#set text(lang: "zh", region: "cn", size: 12pt)
#set par(justify: true, first-line-indent: (amount: 2em, all: true))

#let vocab = (
  ("学校", "xuéxiào", "school"),
  ("老师", "lǎoshī", "teacher"),
  ("学生", "xuéshēng", "student"),
  ("朋友", "péngyǒu", "friend"),
  ("图书馆", "túshūguǎn", "library"),
  ("作业", "zuòyè", "homework"),
  ("考试", "kǎoshì", "exam"),
  ("喜欢", "xǐhuān", "to like"),
)

#align(center)[#text(18pt)[*第三课：我的学校*] \ #text(11pt)[Lesson 3: My School · HSK 1–2]]

== 生词 Vocabulary

#table(
  columns: (auto, 1fr, 1fr, 1fr),
  align: (center, center, left, left),
  table.header([*\#*], [*汉字*], [*拼音*], [*English*]),
  ..vocab.enumerate(start: 1).map(((i, (hz, py, en))) => ([#i], text(14pt)[#hz], [#py], [#en])).flatten(),
)

== 课文 Text

我叫李明，我是学生。我的学校很大，有一个很漂亮的图书馆。我每天八点去学校，下午四点回家。

我最喜欢的老师是王老师，她教我们中文。我的朋友小红也很喜欢她。明天我们有考试，所以今天晚上我要做很多作业。

== 练习 Exercises

+ 用拼音写出下面的词：学校、朋友、考试。
+ 回答问题：李明几点去学校？
+ 翻译成英文："我的学校很大。"
+ 选择正确的词填空：我每天在 #box(width: 3em, stroke: (bottom: 0.4pt)) 看书。（学校 / 图书馆 / 作业）

#v(1em)
#text(size: 10pt)[日本語の例：学校（がっこう）。한국어 예시: 학교.]
