use base64::{engine::general_purpose::STANDARD, Engine as _};
use clipboard_rs::{Clipboard, ClipboardContext};
use serde::Serialize;
use std::panic::{catch_unwind, AssertUnwindSafe};

#[derive(Debug, Serialize)]
struct CustomClipboardPayload {
    format: String,
    size: usize,
    utf8: Option<String>,
    base64: String,
}

fn panic_to_string(panic_payload: Box<dyn std::any::Any + Send>) -> String {
    if let Some(message) = panic_payload.downcast_ref::<&str>() {
        return (*message).to_string();
    }
    if let Some(message) = panic_payload.downcast_ref::<String>() {
        return message.clone();
    }
    "unknown panic".to_string()
}

#[tauri::command]
fn list_clipboard_formats() -> Result<Vec<String>, String> {
    catch_unwind(AssertUnwindSafe(|| {
        let ctx = ClipboardContext::new().map_err(|error| error.to_string())?;
        ctx.available_formats().map_err(|error| error.to_string())
    }))
    .map_err(|panic_payload| format!("Clipboard native panic: {}", panic_to_string(panic_payload)))?
}

#[tauri::command]
fn read_custom_clipboard_format(format: String) -> Result<CustomClipboardPayload, String> {
    catch_unwind(AssertUnwindSafe(|| {
        let ctx = ClipboardContext::new().map_err(|error| error.to_string())?;
        let buffer = ctx.get_buffer(&format).map_err(|error| error.to_string())?;

        Ok(CustomClipboardPayload {
            size: buffer.len(),
            utf8: String::from_utf8(buffer.clone()).ok(),
            base64: STANDARD.encode(buffer),
            format,
        })
    }))
    .map_err(|panic_payload| format!("Clipboard native panic: {}", panic_to_string(panic_payload)))?
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_clipboard_x::init())
        .invoke_handler(tauri::generate_handler![
            list_clipboard_formats,
            read_custom_clipboard_format
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
