//! The in-memory `World`: virtual files and fonts given as bytes. No packages,
//! network or filesystem; everything a document can read was put here by JS.

use std::collections::HashMap;

use typst::diag::{FileError, FileResult};
use typst::foundations::{Bytes, Datetime, Dict, Duration};
use typst::syntax::{FileId, RootedPath, Source, VirtualPath, VirtualRoot};
use typst::text::{Font, FontBook};
use typst::utils::LazyHash;
use typst::{Feature, Library, LibraryExt, World};

/// The entry point. It always exists (empty until `set_source`).
pub const MAIN_PATH: &str = "/main.typ";

/// Interns a virtual path such as `/main.typ` or `/img/a.png`.
pub fn file_id(path: &str) -> Option<FileId> {
    let vpath = VirtualPath::new(path).ok()?;
    Some(RootedPath::new(VirtualRoot::Project, vpath).intern())
}

/// The virtual path of a file id, with a leading slash.
pub fn file_path(id: FileId) -> String {
    id.get().vpath().get_with_slash().to_string()
}

fn build_library(inputs: Dict) -> LazyHash<Library> {
    // `Feature::Html` makes the HTML target available; it doesn't affect paged output.
    LazyHash::new(
        Library::builder()
            .with_inputs(inputs)
            .with_features([Feature::Html].into_iter().collect())
            .build(),
    )
}

pub struct MemWorld {
    library: LazyHash<Library>,
    book: LazyHash<FontBook>,
    fonts: Vec<Font>,
    main: FileId,
    /// Kept across compiles and updated with `Source::replace`, so the
    /// incremental reparser and comemo can reuse work.
    sources: HashMap<FileId, Source>,
    files: HashMap<FileId, Bytes>,
}

impl MemWorld {
    pub fn new() -> Self {
        let main = file_id(MAIN_PATH).unwrap();
        let mut sources = HashMap::new();
        sources.insert(main, Source::new(main, String::new()));
        MemWorld {
            library: build_library(Dict::new()),
            book: LazyHash::new(FontBook::new()),
            fonts: Vec::new(),
            main,
            sources,
            files: HashMap::new(),
        }
    }

    /// Adds every face in a font file (a TTC has several). Returns how many.
    pub fn add_font(&mut self, bytes: &[u8]) -> u32 {
        let mut added = 0;
        for font in Font::iter(Bytes::new(bytes.to_vec())) {
            self.fonts.push(font);
            added += 1;
        }
        // The book is indexed like `fonts`, so rebuild it rather than patch it.
        self.book = LazyHash::new(FontBook::from_fonts(self.fonts.iter()));
        added
    }

    pub fn set_source(&mut self, id: FileId, text: &str) {
        match self.sources.get_mut(&id) {
            Some(source) => {
                source.replace(text);
            }
            None => {
                self.sources.insert(id, Source::new(id, text.to_string()));
            }
        }
    }

    pub fn set_file(&mut self, id: FileId, bytes: &[u8]) {
        self.files.insert(id, Bytes::new(bytes.to_vec()));
    }

    /// Removes a source or binary file. The main source can't be removed.
    pub fn remove_file(&mut self, id: FileId) {
        if id != self.main {
            self.sources.remove(&id);
        }
        self.files.remove(&id);
    }

    pub fn set_inputs(&mut self, inputs: Dict) {
        // An unchanged dict hashes the same, so comemo still hits.
        self.library = build_library(inputs);
    }

    /// Converts a UTF-8 byte offset in a file to UTF-16 code units, the unit
    /// of JS string indices. Binary files are converted when the bytes before
    /// the offset are valid UTF-8 (data files such as JSON or CSV).
    pub fn utf16_offset(&self, id: FileId, byte: usize) -> Option<usize> {
        if let Some(source) = self.sources.get(&id) {
            return source.lines().byte_to_utf16(byte);
        }
        let head = self.files.get(&id)?.as_slice().get(..byte)?;
        Some(std::str::from_utf8(head).ok()?.encode_utf16().count())
    }
}

fn not_found(id: FileId) -> FileError {
    FileError::NotFound(id.get().vpath().get_with_slash().into())
}

impl World for MemWorld {
    fn library(&self) -> &LazyHash<Library> {
        &self.library
    }

    fn book(&self) -> &LazyHash<FontBook> {
        &self.book
    }

    fn main(&self) -> FileId {
        self.main
    }

    fn source(&self, id: FileId) -> FileResult<Source> {
        self.sources.get(&id).cloned().ok_or_else(|| not_found(id))
    }

    fn file(&self, id: FileId) -> FileResult<Bytes> {
        if let Some(bytes) = self.files.get(&id) {
            return Ok(bytes.clone());
        }
        match self.sources.get(&id) {
            Some(source) => Ok(Bytes::from_string(source.text().to_string())),
            None => Err(not_found(id)),
        }
    }

    fn font(&self, index: usize) -> Option<Font> {
        self.fonts.get(index).cloned()
    }

    /// Like the Typst CLI: the local date without an offset, else the UTC date
    /// shifted by it.
    fn today(&self, offset: Option<Duration>) -> Option<Datetime> {
        let now = js_sys::Date::new_0();
        let (year, month, day) = match offset {
            None => (now.get_full_year(), now.get_month(), now.get_date()),
            Some(offset) => {
                let ms = now.get_time() + offset.seconds() * 1000.0;
                let shifted = js_sys::Date::new(&ms.into());
                (
                    shifted.get_utc_full_year(),
                    shifted.get_utc_month(),
                    shifted.get_utc_date(),
                )
            }
        };
        // JS months are 0-based.
        Datetime::from_ymd(year as i32, month as u8 + 1, day as u8)
    }
}
