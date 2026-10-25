"""Attribute wasm code + .rodata bytes to crates from a wasm-ld --Map file
(non-LTO build so every input section keeps its crate's object file).
Usage: python3 tools/attribute.py target/analysis-map/link.map"""
import re, sys, collections
code = collections.Counter(); data = collections.Counter()
sec = None; sub = None
for n, line in enumerate(open(sys.argv[1]), 1):
    parts = line.split(None, 3)
    if len(parts) < 4: continue
    tag = parts[3].strip()
    if parts[0] == '-' and tag in ('CODE', 'DATA'): sec = tag; continue
    if parts[0] == '-' and tag.startswith('CUSTOM'): sec = None; continue
    if sec == 'DATA' and tag in ('.rodata', '.data', '.bss', '.tdata'): sub = tag; continue
    if not (tag.startswith('/') or tag.startswith('<')): continue
    size = int(parts[2], 16)
    m = re.search(r'deps/lib([a-zA-Z0-9_]+)-[0-9a-f]+\.rlib', tag)
    crate = m.group(1) if m else ('typstream_engine' if 'typstream_engine' in tag else ('std' if 'rustlib' in tag else 'linker-internal'))
    if sec == 'CODE': code[crate] += size
    elif sec == 'DATA' and sub == '.rodata': data[crate] += size
tot = collections.Counter(); tot.update(code); tot.update(data)
T = sum(tot.values())
print(f'total code+rodata {T/1e6:.2f} MB (code {sum(code.values())/1e6:.2f} MB, rodata {sum(data.values())/1e6:.2f} MB)\n')
print('| # | crate | code | rodata | total | % |'); print('|---|---|---:|---:|---:|---:|')
for i, (k, v) in enumerate(tot.most_common(25), 1):
    print(f'| {i} | {k} | {code[k]/1e3:.0f} K | {data[k]/1e3:.0f} K | {v/1e3:.0f} K | {100*v/T:.1f}% |')
groups = {
 'Bibliography: hayagriva, citationberg, biblatex, icu_collator(+data), url/idna, quick_xml, unic-langid': ['hayagriva','citationberg','biblatex','icu_collator','icu_collator_data','icu_normalizer','icu_normalizer_data','idna','idna_adapter','url','quick_xml','serde_path_to_error','unic_langid','unic_langid_impl','form_urlencoded'],
 'Syntax highlighting: syntect, two_face, fancy_regex, bincode': ['syntect','two_face','fancy_regex','bincode','plist','yaml_rust'],
 'Hyphenation: hypher': ['hypher'],
 'Wasm plugins: wasmi*, wasmparser': ['wasmi','wasmi_core','wasmi_ir','wasmi_collections','wasmparser','spin','wasm_encoder'],
 'Raster images: image, png, zune_jpeg, gif, image_webp, moxcms, exif, pxfm': ['image','png','zune_jpeg','zune_core','gif','image_webp','moxcms','kamadak_exif','fdeflate','weezl','color_quant','pxfm'],
 'SVG images: usvg, resvg, tiny_skia, roxmltree, svgtypes, fontdb': ['usvg','resvg','tiny_skia','tiny_skia_path','roxmltree','svgtypes','simplecss','imagesize','strict_num','data_url','fontdb'],
 'PDF-as-image: hayro*': ['hayro','hayro_interpret','hayro_syntax','hayro_jbig2','hayro_jpeg2000','hayro_svg','hayro_cmap','hayro_font','hayro_ccitt','hayro_postscript'],
 'PDF export: krilla, typst_pdf, subsetter, write_fonts, pdf_writer': ['krilla','krilla_svg','typst_pdf','subsetter','write_fonts','pdf_writer','xmp_writer','font_types'],
 'Data loading: toml, serde_yaml, csv, ciborium, serde_json': ['toml','toml_edit','toml_parser','toml_datetime','toml_writer','winnow','serde_yaml','unsafe_libyaml','csv','csv_core','ciborium','ciborium_ll','serde_json'],
 'ICU segmenter/properties (line breaking)': ['icu_segmenter','icu_segmenter_data','icu_properties','icu_properties_data','icu_provider','icu_provider_blob','icu_locale_core','icu_collections','zerovec','postcard','potential_utf','tinystr','yoke','zerotrie'],
 'Core compiler: typst_* , comemo, ecow, codex': ['typst_library','typst_layout','typst_eval','typst_realize','typst_syntax','typst_html','typst_svg','typst','comemo','ecow','typst_utils','typst_timing','codex','typst_assets','lipsum'],
 'Text shaping & fonts: rustybuzz, ttf_parser, skrifa, read_fonts': ['rustybuzz','ttf_parser','skrifa','read_fonts'],
 'Regex: regex*, aho_corasick': ['regex','regex_automata','regex_syntax','aho_corasick','memchr'],
}
print('\n| area | code | rodata |'); print('|---|---:|---:|')
for g, cs in groups.items():
    c = sum(code[x] for x in cs); d = sum(data[x] for x in cs)
    print(f'| {g} | {c/1e6:.2f} MB | {d/1e6:.2f} MB |')
