//! Fonts, shared by every `Engine` in the wasm instance (PLAN §6.4): faces
//! added with their bytes, and lazy faces registered from their `FontInfo`
//! alone. A lazy face is in the font book, so Typst selects it by family and
//! for fallback (by coverage) as if it were loaded; `World::font` then has no
//! bytes to give, records that the compile wanted it, and Typst moves on to
//! the next family or shapes tofu. JS fetches the file and `load`s it, and the
//! next compile uses it.

use std::cell::RefCell;
use std::collections::HashMap;
use std::sync::Arc;

use typst::foundations::Bytes;
use typst::text::{Font, FontBook, FontInfo};
use typst::utils::LazyHash;

enum Slot {
    Loaded(Font),
    /// A face of the lazy file with this id.
    Lazy(u32),
}

struct LazyFile {
    /// Index of its first face in `slots`; its faces are consecutive.
    first: usize,
    infos: Vec<FontInfo>,
}

#[derive(Default)]
struct Store {
    /// Indexed like `slots`. Replaced, not mutated, so a world's snapshot of it
    /// stays valid and comemo sees a new book only when faces were added.
    book: Arc<LazyHash<FontBook>>,
    slots: Vec<Slot>,
    lazy: Vec<LazyFile>,
    /// Face counts of the files added with bytes, by content hash: adding the
    /// same file again adds nothing.
    added: HashMap<u128, u32>,
    /// Ids of the files registered lazily, by their info's hash: registering
    /// the same info again returns the same id.
    registered: HashMap<u128, u32>,
}

thread_local! {
    // Wasm has one thread; this is the instance's font set.
    static STORE: RefCell<Store> = RefCell::new(Store::default());
}

impl Store {
    fn push(&mut self, faces: impl IntoIterator<Item = (FontInfo, Slot)>) {
        let mut book = (**self.book).clone();
        for (info, slot) in faces {
            book.push(info);
            self.slots.push(slot);
        }
        self.book = Arc::new(LazyHash::new(book));
    }
}

/// Adds every face in a font file (a TTC has several) and returns how many it
/// has. A file added before is not added again.
pub fn add(bytes: &[u8]) -> u32 {
    let hash = typst::utils::hash128(bytes);
    STORE.with_borrow_mut(|store| {
        if let Some(&count) = store.added.get(&hash) {
            return count;
        }
        let fonts: Vec<Font> = Font::iter(Bytes::new(bytes.to_vec())).collect();
        let count = fonts.len() as u32;
        store.push(
            fonts
                .into_iter()
                .map(|font| (font.info().clone(), Slot::Loaded(font))),
        );
        store.added.insert(hash, count);
        count
    })
}

/// The `FontInfo` of every face in a font file, as JSON: what `register` takes.
pub fn info(bytes: &[u8]) -> String {
    let infos: Vec<FontInfo> = FontInfo::iter(bytes).collect();
    serde_json::to_string(&infos).unwrap_or_default()
}

/// Registers a font file's faces from `info`'s JSON without their bytes.
/// Returns the file's id for `load`; the same info gets the same id.
pub fn register(info: &str) -> Result<u32, String> {
    let hash = typst::utils::hash128(info);
    if let Some(id) = STORE.with_borrow(|store| store.registered.get(&hash).copied()) {
        return Ok(id);
    }
    let infos: Vec<FontInfo> =
        serde_json::from_str(info).map_err(|e| format!("invalid font info: {e}"))?;
    if infos.is_empty() {
        return Err("invalid font info: no faces".into());
    }
    STORE.with_borrow_mut(|store| {
        let id = store.lazy.len() as u32;
        store.lazy.push(LazyFile {
            first: store.slots.len(),
            infos: infos.clone(),
        });
        store.push(infos.into_iter().map(|info| (info, Slot::Lazy(id))));
        store.registered.insert(hash, id);
        Ok(id)
    })
}

/// Gives a registered file its bytes. They must be the file its info came
/// from; loading a file twice is a no-op.
pub fn load(id: u32, bytes: &[u8]) -> Result<(), String> {
    STORE.with_borrow_mut(|store| {
        let file = store
            .lazy
            .get(id as usize)
            .ok_or_else(|| format!("no font registered with id {id}"))?;
        if matches!(store.slots[file.first], Slot::Loaded(_)) {
            return Ok(());
        }
        let fonts: Vec<Font> = Font::iter(Bytes::new(bytes.to_vec())).collect();
        let infos: Vec<&FontInfo> = fonts.iter().map(|f| f.info()).collect();
        if infos.len() != file.infos.len() || infos.iter().zip(&file.infos).any(|(a, b)| *a != b) {
            let family = &file.infos[0].family;
            return Err(format!(
                "the bytes for font {id} ({family}) aren't the file it was registered with"
            ));
        }
        let first = file.first;
        for (i, font) in fonts.into_iter().enumerate() {
            store.slots[first + i] = Slot::Loaded(font);
        }
        Ok(())
    })
}

/// The current font book.
pub fn book() -> Arc<LazyHash<FontBook>> {
    STORE.with_borrow(|store| store.book.clone())
}

/// The face at `index` in the book: `Ok(None)` past its end, `Err(id)` when it
/// belongs to lazy file `id` whose bytes haven't been loaded.
pub fn font(index: usize) -> Result<Option<Font>, u32> {
    STORE.with_borrow(|store| match store.slots.get(index) {
        Some(Slot::Loaded(font)) => Ok(Some(font.clone())),
        Some(Slot::Lazy(id)) => Err(*id),
        None => Ok(None),
    })
}
