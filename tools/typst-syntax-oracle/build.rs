//! Copies typst-syntax's lexer source into OUT_DIR so the oracle can expose
//! Typst's real lexer (it's `pub(super)` in the crate). Taken from the pinned
//! dependency itself, so it can't drift from the parser the oracle uses.

use std::{env, fs, path::PathBuf, process::Command};

fn main() {
    let manifest_dir = env::var("CARGO_MANIFEST_DIR").unwrap();
    let out = Command::new(env::var("CARGO").unwrap())
        .args(["metadata", "--format-version", "1", "--locked", "--manifest-path"])
        .arg(PathBuf::from(&manifest_dir).join("Cargo.toml"))
        .output()
        .expect("cargo metadata");
    assert!(out.status.success(), "cargo metadata failed: {}", String::from_utf8_lossy(&out.stderr));
    let meta: serde_json::Value = serde_json::from_slice(&out.stdout).unwrap();
    let manifest = meta["packages"]
        .as_array()
        .unwrap()
        .iter()
        .find(|p| p["name"] == "typst-syntax")
        .and_then(|p| p["manifest_path"].as_str())
        .expect("typst-syntax in cargo metadata");
    let lexer = PathBuf::from(manifest).parent().unwrap().join("src/lexer.rs");
    let source = fs::read_to_string(&lexer).unwrap();
    // The lexer's unit tests use crate-private helpers; they aren't needed here.
    let source = match source.find("#[cfg(test)]") {
        Some(at) => &source[..at],
        None => &source[..],
    };
    fs::write(PathBuf::from(env::var("OUT_DIR").unwrap()).join("lexer.rs"), source).unwrap();
    println!("cargo:rerun-if-changed=Cargo.lock");
    println!("cargo:rerun-if-changed=build.rs");
}
