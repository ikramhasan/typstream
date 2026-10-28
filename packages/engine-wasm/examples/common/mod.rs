//! A document compiled natively the way the engine compiles it: fonts from a directory, local packages
//! laid out as `--package-path` does (`namespace/name/version/…`), and `sys.inputs`. For tools in `examples/`.

use std::fs;
use std::path::Path;

use typst::foundations::{Dict, Str, Value};
use typst_layout::PagedDocument;
use typstream_engine_wasm::{
    fonts,
    world::{file_id, MemWorld, MAIN_PATH},
};

pub struct Options<'a> {
    pub main: &'a Path,
    pub fonts: &'a Path,
    pub packages: Option<&'a Path>,
    pub inputs: Vec<(String, String)>,
}

/// Options from `args`: the document, then `--fonts DIR`, `--packages DIR` and `--input k=v`.
pub fn options(
    args: &[String],
) -> (
    std::path::PathBuf,
    std::path::PathBuf,
    Option<std::path::PathBuf>,
    Vec<(String, String)>,
) {
    let mut main = None;
    let mut fonts = "dist/fonts".into();
    let mut packages = None;
    let mut inputs = Vec::new();
    let mut it = args.iter().skip(1);
    while let Some(arg) = it.next() {
        match arg.as_str() {
            "--fonts" => fonts = it.next().unwrap().into(),
            "--packages" => packages = Some(it.next().unwrap().into()),
            "--input" => {
                let (k, v) = it.next().unwrap().split_once('=').unwrap();
                inputs.push((k.into(), v.into()));
            }
            _ => main = Some(arg.into()),
        }
    }
    (main.expect("a document"), fonts, packages, inputs)
}

pub fn compile(o: &Options) -> (MemWorld, Result<PagedDocument, String>) {
    for entry in fs::read_dir(o.fonts).unwrap() {
        let path = entry.unwrap().path();
        if path.extension().is_some_and(|e| e == "ttf" || e == "otf") {
            fonts::add(&fs::read(&path).unwrap());
        }
    }
    let mut world = MemWorld::new();
    if let Some(dir) = o.packages {
        mount(&mut world, dir, dir);
    }
    let mut dict = Dict::new();
    for (k, v) in &o.inputs {
        dict.insert(Str::from(k.as_str()), Value::Str(Str::from(v.as_str())));
    }
    world.set_inputs(dict);
    world.set_source(
        file_id(MAIN_PATH).unwrap(),
        &fs::read_to_string(o.main).unwrap(),
    );
    world.begin_compile();
    // On this thread only: the font store is thread-local (fonts.rs), as in wasm.
    let pool = rayon::ThreadPoolBuilder::new()
        .num_threads(1)
        .use_current_thread()
        .build()
        .unwrap();
    let out = pool.install(|| {
        typst::compile::<PagedDocument>(&world)
            .output
            .map_err(|e| format!("{e:?}"))
    });
    (world, out)
}

fn mount(world: &mut MemWorld, root: &Path, dir: &Path) {
    for entry in fs::read_dir(dir).unwrap() {
        let path = entry.unwrap().path();
        if path.is_dir() {
            mount(world, root, &path);
            continue;
        }
        // namespace/name/version/inner → @namespace/name:version/inner
        let rel = path
            .strip_prefix(root)
            .unwrap()
            .to_string_lossy()
            .to_string();
        let parts: Vec<&str> = rel.splitn(4, '/').collect();
        if parts.len() < 4 {
            continue;
        }
        let vpath = format!("@{}/{}:{}/{}", parts[0], parts[1], parts[2], parts[3]);
        let Some(id) = file_id(&vpath) else { continue };
        let bytes = fs::read(&path).unwrap();
        match String::from_utf8(bytes.clone()) {
            Ok(text) if path.extension().is_some_and(|e| e == "typ") => world.set_source(id, &text),
            _ => world.set_file(id, &bytes),
        }
    }
}
