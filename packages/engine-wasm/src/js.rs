//! Small helpers for building plain JS objects.

use wasm_bindgen::prelude::*;

#[wasm_bindgen]
extern "C" {
    #[wasm_bindgen(js_namespace = performance, js_name = now)]
    pub fn perf_now() -> f64;
}

pub fn set(obj: &js_sys::Object, key: &str, value: impl Into<JsValue>) {
    // Setting a property on a fresh plain object can't fail.
    let _ = js_sys::Reflect::set(obj, &JsValue::from_str(key), &value.into());
}

pub fn string_array<'a>(items: impl Iterator<Item = &'a str>) -> js_sys::Array {
    items.map(JsValue::from_str).collect()
}
