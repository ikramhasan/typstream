//! Writes a reduced, uncompressed syntect SyntaxSet dump that can replace
//! two-face's `generated/syntaxes-fancy-no-newlines.bin` in a patched copy.
//!   cargo run --release -- <out.bin> [Name,Name,...]   (no names => empty set)
use syntect::parsing::{ParseState, SyntaxSet, SyntaxSetBuilder};

fn main() {
    let args: Vec<String> = std::env::args().collect();
    let out = &args[1];
    let wanted: Vec<String> = args.get(2).map(|s| s.split(',').map(|x| x.to_string()).collect()).unwrap_or_default();
    let full = two_face::syntax::extra_no_newlines();
    let builder = full.into_builder();
    let mut nb = SyntaxSetBuilder::new();
    for def in builder.syntaxes() {
        if def.name == "Plain Text" || wanted.iter().any(|w| w == &def.name) {
            nb.add(def.clone());
        }
    }
    let set: SyntaxSet = nb.build();
    eprintln!("unlinked contexts: {:?}", set.find_unlinked_contexts());
    for s in set.syntaxes() {
        let mut st = ParseState::new(s);
        let ok = st.parse_line("let x = (1, \"two\") // comment { [ ] } <a href=\"x\"> def f(): pass", &set).is_ok();
        eprintln!("{:30} parse ok: {}", s.name, ok);
    }
    syntect::dumps::dump_to_uncompressed_file(&set, out).unwrap();
    eprintln!("wrote {} syntaxes to {}", set.syntaxes().len(), out);
}
