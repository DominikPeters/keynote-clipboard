use base64::{engine::general_purpose::STANDARD, Engine as _};
use clipboard_rs::{Clipboard, ClipboardContext};
use serde::Serialize;
use std::fs;
use std::panic::{catch_unwind, AssertUnwindSafe};
use std::path::PathBuf;
use std::process::Command;
use std::time::{SystemTime, UNIX_EPOCH};

#[derive(Debug, Serialize)]
struct CustomClipboardPayload {
    format: String,
    size: usize,
    utf8: Option<String>,
    base64: String,
}

#[derive(Debug, Serialize)]
#[serde(tag = "status", rename_all = "snake_case")]
enum CompileTikzResponse {
    Success { pdf_base64: String, log_tail: String },
    Error { message: String, log_tail: String },
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

fn tail_lines(content: &str, max_lines: usize) -> String {
    let lines: Vec<&str> = content.lines().collect();
    if lines.len() <= max_lines {
        return content.to_string();
    }

    lines[lines.len() - max_lines..].join("\n")
}

fn relevant_latex_log_excerpt(content: &str, context_before: usize, context_after: usize) -> Option<String> {
    let lines: Vec<&str> = content.lines().collect();
    if lines.is_empty() {
        return None;
    }

    let marker_index = lines.iter().position(|line| {
        let trimmed = line.trim_start();
        trimmed.starts_with('!')
            || line.contains("LaTeX Error")
            || line.contains("Unicode character")
            || line.contains("Emergency stop")
    })?;

    let start = marker_index.saturating_sub(context_before);
    let end = (marker_index + context_after + 1).min(lines.len());
    Some(lines[start..end].join("\n"))
}

fn create_compile_dir() -> Result<PathBuf, String> {
    let mut dir = std::env::temp_dir();
    let ts = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_err(|error| error.to_string())?
        .as_nanos();
    dir.push(format!("keynote-clipboard-tikz-{}-{}", std::process::id(), ts));
    fs::create_dir_all(&dir).map_err(|error| error.to_string())?;
    Ok(dir)
}

fn compile_tikz_to_pdf_impl(tikz: &str) -> CompileTikzResponse {
    let run = || -> Result<CompileTikzResponse, String> {
        let compile_dir = create_compile_dir()?;
        let tex_path = compile_dir.join("preview.tex");
        let pdf_path = compile_dir.join("preview.pdf");

        let write_result = fs::write(&tex_path, tikz).map_err(|error| error.to_string());
        if let Err(error) = write_result {
            let _ = fs::remove_dir_all(&compile_dir);
            return Err(error);
        }

        let output = Command::new("pdflatex")
            .args([
                "-interaction=nonstopmode",
                "-halt-on-error",
                "-file-line-error",
                "preview.tex",
            ])
            .current_dir(&compile_dir)
            .output();

        let response = match output {
            Ok(output) => {
                let mut log = String::from_utf8_lossy(&output.stdout).to_string();
                let stderr = String::from_utf8_lossy(&output.stderr);
                if !stderr.is_empty() {
                    if !log.is_empty() {
                        log.push('\n');
                    }
                    log.push_str(&stderr);
                }
                let log_tail = tail_lines(&log, 40);

                if !output.status.success() {
                    let excerpt =
                        relevant_latex_log_excerpt(&log, 2, 6).unwrap_or_else(|| log_tail.clone());
                    CompileTikzResponse::Error {
                        message: format!(
                            "pdflatex failed with exit code {:?}.\n{}",
                            output.status.code(),
                            excerpt
                        ),
                        log_tail,
                    }
                } else {
                    match fs::read(&pdf_path) {
                        Ok(pdf_bytes) => CompileTikzResponse::Success {
                            pdf_base64: STANDARD.encode(pdf_bytes),
                            log_tail,
                        },
                        Err(error) => CompileTikzResponse::Error {
                            message: format!("pdflatex completed but PDF was not produced: {}", error),
                            log_tail,
                        },
                    }
                }
            }
            Err(error) => CompileTikzResponse::Error {
                message: format!("Failed to execute pdflatex: {}", error),
                log_tail: String::new(),
            },
        };

        let _ = fs::remove_dir_all(&compile_dir);
        Ok(response)
    };

    run().unwrap_or_else(|error| CompileTikzResponse::Error {
        message: error,
        log_tail: String::new(),
    })
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

#[tauri::command]
fn is_pdflatex_available() -> Result<bool, String> {
    catch_unwind(AssertUnwindSafe(|| {
        let available = Command::new("pdflatex").arg("--version").output().is_ok();
        Ok(available)
    }))
    .map_err(|panic_payload| format!("System command panic: {}", panic_to_string(panic_payload)))?
}

#[tauri::command]
fn compile_tikz_to_pdf(tikz: String) -> Result<CompileTikzResponse, String> {
    catch_unwind(AssertUnwindSafe(|| Ok(compile_tikz_to_pdf_impl(&tikz))))
        .map_err(|panic_payload| format!("TikZ compile panic: {}", panic_to_string(panic_payload)))?
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_clipboard_x::init())
        .invoke_handler(tauri::generate_handler![
            list_clipboard_formats,
            read_custom_clipboard_format,
            is_pdflatex_available,
            compile_tikz_to_pdf
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

#[cfg(test)]
mod tests {
    use super::{
        compile_tikz_to_pdf_impl, is_pdflatex_available, relevant_latex_log_excerpt, tail_lines,
        CompileTikzResponse,
    };

    #[test]
    fn tail_lines_keeps_last_lines() {
        let value = "a\nb\nc\nd\n";
        let tail = tail_lines(value, 2);
        assert_eq!(tail, "c\nd");
    }

    #[test]
    fn relevant_latex_log_excerpt_extracts_unicode_error_context() {
        let log = "line1\nline2\n! LaTeX Error: Unicode character \u{200b} (U+200B)\nline4\nline5\n";
        let excerpt = relevant_latex_log_excerpt(log, 1, 2).expect("expected excerpt");
        assert!(excerpt.contains("Unicode character"));
        assert!(excerpt.contains("line2"));
        assert!(excerpt.contains("line4"));
    }

    #[test]
    fn pdflatex_availability_does_not_panic() {
        let available = is_pdflatex_available();
        assert!(available.is_ok());
    }

    #[test]
    fn invalid_tikz_returns_structured_error_or_skips_when_missing_pdflatex() {
        let available = is_pdflatex_available().unwrap_or(false);
        if !available {
            return;
        }

        let invalid = r#"\documentclass[tikz]{standalone}
\usepackage{tikz}
\begin{document}
\begin{tikzpicture}
\thisisnotavalidcommand
\end{tikzpicture}
\end{document}
"#;

        match compile_tikz_to_pdf_impl(invalid) {
            CompileTikzResponse::Success { .. } => panic!("expected invalid tikz to fail"),
            CompileTikzResponse::Error { message, log_tail } => {
                assert!(!message.is_empty());
                assert!(!log_tail.is_empty());
            }
        }
    }
}
