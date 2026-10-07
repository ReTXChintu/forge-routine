//! Finding Claude Code and Codex on this machine, and running one job on them.
//!
//! The argument lists here mirror the server's own providers exactly
//! (`packages/ai/src/provider/claude-code` and `.../codex`), and are checked
//! against the same expected values in the tests below. Jobs arrive described
//! by meaning — tool, prompt, schema, model — and this file alone decides
//! what command that becomes. Nothing from the server is ever run as a
//! command line, so the connection cannot be used to run anything else.

use std::collections::BTreeMap;
use std::path::{Path, PathBuf};
use std::process::Stdio;
use std::sync::Mutex;
use std::time::Duration;

use serde::{Deserialize, Serialize};
use tokio::io::AsyncWriteExt;
use tokio::process::Command;
use tokio::sync::oneshot;

/// Everything Claude Code can do to a filesystem, denied. Same list as
/// `CLAUDE_CODE_DENIED_TOOLS` on the server.
pub const CLAUDE_CODE_DENIED_TOOLS: &[&str] = &[
    "Bash",
    "BashOutput",
    "KillShell",
    "Read",
    "Write",
    "Edit",
    "NotebookEdit",
    "Glob",
    "Grep",
    "WebFetch",
    "WebSearch",
    "Task",
    "TodoWrite",
];

/// "Use whatever model Codex is configured for" — passes no `-m`.
pub const CODEX_DEFAULT_MODEL: &str = "codex-default";

/// Windows: start the CLI without flashing a console window.
#[cfg(windows)]
const CREATE_NO_WINDOW: u32 = 0x0800_0000;

/// One prompt for one tool, as the server sends it.
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CliJob {
    pub tool: String,
    pub system: Option<String>,
    pub conversation: String,
    pub json_schema: Option<serde_json::Value>,
    pub model: String,
    pub timeout_ms: u64,
}

/// What a run left behind; the server reads its own success out of it.
#[derive(Debug, Clone, Serialize)]
pub struct CliOutcome {
    pub stdout: String,
    pub stderr: String,
    pub code: Option<i32>,
    pub answer: Option<String>,
}

#[derive(Debug, Clone, Serialize, PartialEq)]
pub struct ToolStatus {
    pub available: bool,
    /// The path when found; what was searched when not.
    pub detail: Option<String>,
}

/// Keyed `CLAUDE_CODE` / `CODEX`, the names the server uses.
pub type Tools = BTreeMap<String, ToolStatus>;

// -- Arguments ---------------------------------------------------------------------

/// A model name is passed as its own argument, so it cannot be a flag.
fn check_model(model: &str) -> Result<(), String> {
    let ok = !model.is_empty()
        && model.len() <= 80
        && !model.starts_with('-')
        && model
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || "._:/[]-".contains(c));
    if ok {
        Ok(())
    } else {
        Err(format!("Refusing an unexpected model name: {model:?}"))
    }
}

pub fn claude_code_args(job: &CliJob) -> Result<Vec<String>, String> {
    check_model(&job.model)?;

    let mut args: Vec<String> = vec![
        "-p".into(),
        "--output-format".into(),
        "json".into(),
        "--model".into(),
        job.model.clone(),
        "--disallowedTools".into(),
        CLAUDE_CODE_DENIED_TOOLS.join(","),
    ];
    if let Some(system) = job.system.as_deref().filter(|s| !s.is_empty()) {
        args.push("--system-prompt".into());
        args.push(system.to_string());
    }
    if let Some(schema) = &job.json_schema {
        args.push("--json-schema".into());
        args.push(schema.to_string());
    }
    Ok(args)
}

pub fn codex_args(job: &CliJob, cwd: &Path, answer: &Path, schema: &Path) -> Result<Vec<String>, String> {
    let mut args: Vec<String> = vec![
        "exec".into(),
        "--json".into(),
        "--sandbox".into(),
        "read-only".into(),
        "--ephemeral".into(),
        "--skip-git-repo-check".into(),
        "-C".into(),
        cwd.to_string_lossy().into_owned(),
        "-o".into(),
        answer.to_string_lossy().into_owned(),
    ];
    if job.json_schema.is_some() {
        args.push("--output-schema".into());
        args.push(schema.to_string_lossy().into_owned());
    }
    if !job.model.is_empty() && job.model != CODEX_DEFAULT_MODEL {
        check_model(&job.model)?;
        args.push("-m".into());
        args.push(job.model.clone());
    }
    args.push("-".into());
    Ok(args)
}

/// Codex has no system-prompt flag, so the instructions lead the input.
pub fn codex_input(job: &CliJob) -> String {
    match job.system.as_deref().filter(|s| !s.is_empty()) {
        Some(system) => format!("{system}\n\n---\n\n{}", job.conversation),
        None => job.conversation.clone(),
    }
}

// -- Running -----------------------------------------------------------------------

/// Runs one job. `Err` means it could not run at all — not found, timed out,
/// cancelled; a run that started and failed comes back as an outcome, so the
/// server can read the CLI's own words.
pub async fn run(job: CliJob, cancel: oneshot::Receiver<()>) -> Result<CliOutcome, String> {
    let timeout = Duration::from_millis(job.timeout_ms.clamp(5_000, 600_000));

    match job.tool.as_str() {
        "CLAUDE_CODE" => {
            let binary = find_claude_code().await?;
            let dir = scratch_dir("forgeroutine-claude-")?;
            let args = claude_code_args(&job)?;
            let (stdout, stderr, code) =
                exec(&binary, &args, job.conversation.clone(), dir.path(), timeout, cancel).await?;
            Ok(CliOutcome { stdout, stderr, code, answer: None })
        }
        "CODEX" => {
            let binary = find_codex().await?;
            let dir = scratch_dir("forgeroutine-codex-")?;
            let answer_path = dir.path().join("answer.txt");
            let schema_path = dir.path().join("schema.json");
            if let Some(schema) = &job.json_schema {
                tokio::fs::write(&schema_path, schema.to_string())
                    .await
                    .map_err(|e| format!("Could not write the schema file: {e}"))?;
            }
            let args = codex_args(&job, dir.path(), &answer_path, &schema_path)?;
            let (stdout, stderr, code) =
                exec(&binary, &args, codex_input(&job), dir.path(), timeout, cancel).await?;
            let answer = tokio::fs::read_to_string(&answer_path).await.ok();
            Ok(CliOutcome { stdout, stderr, code, answer })
        }
        other => Err(format!("Unknown tool {other:?}")),
    }
}

/// An empty directory to run in, removed when dropped: no project for the CLI
/// to discover, and nothing left behind.
fn scratch_dir(prefix: &str) -> Result<tempfile::TempDir, String> {
    tempfile::Builder::new()
        .prefix(prefix)
        .tempdir()
        .map_err(|e| format!("Could not create a working directory: {e}"))
}

/// Never through a shell; prompt over stdin, written while output is read.
async fn exec(
    binary: &Path,
    args: &[String],
    input: String,
    cwd: &Path,
    timeout: Duration,
    cancel: oneshot::Receiver<()>,
) -> Result<(String, String, Option<i32>), String> {
    let mut command = Command::new(binary);
    command
        .args(args)
        .current_dir(cwd)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .kill_on_drop(true);
    #[cfg(windows)]
    command.creation_flags(CREATE_NO_WINDOW);

    let mut child = command
        .spawn()
        .map_err(|e| format!("Could not start {}: {e}", binary.display()))?;

    if let Some(mut stdin) = child.stdin.take() {
        tokio::spawn(async move {
            let _ = stdin.write_all(input.as_bytes()).await;
            let _ = stdin.shutdown().await;
        });
    }

    // Dropping this future drops the child, and `kill_on_drop` ends it.
    let finished = child.wait_with_output();

    tokio::select! {
        result = tokio::time::timeout(timeout, finished) => match result {
            Ok(Ok(output)) => Ok((
                String::from_utf8_lossy(&output.stdout).into_owned(),
                String::from_utf8_lossy(&output.stderr).into_owned(),
                output.status.code(),
            )),
            Ok(Err(e)) => Err(format!("The CLI failed while running: {e}")),
            Err(_) => Err(format!("The CLI did not finish within {}ms", timeout.as_millis())),
        },
        _ = cancel => Err("Cancelled".into()),
    }
}

// -- Finding the CLIs --------------------------------------------------------------

static CLAUDE_CODE_BIN: Mutex<Option<PathBuf>> = Mutex::new(None);
static CODEX_BIN: Mutex<Option<PathBuf>> = Mutex::new(None);

/// Both tools, freshly searched — for the hello and the "Check again" button.
pub async fn detect() -> Tools {
    *CLAUDE_CODE_BIN.lock().unwrap() = None;
    *CODEX_BIN.lock().unwrap() = None;

    let (claude, codex) = tokio::join!(find_claude_code(), find_codex());
    let status = |found: Result<PathBuf, String>| match found {
        Ok(path) => ToolStatus { available: true, detail: Some(path.display().to_string()) },
        Err(reason) => ToolStatus { available: false, detail: Some(reason) },
    };

    let mut tools = Tools::new();
    tools.insert("CLAUDE_CODE".into(), status(claude));
    tools.insert("CODEX".into(), status(codex));
    tools
}

/// Only a success is remembered: a CLI installed later should still be found.
async fn cached(
    slot: &'static Mutex<Option<PathBuf>>,
    search: fn() -> Result<PathBuf, String>,
) -> Result<PathBuf, String> {
    if let Some(path) = slot.lock().unwrap().clone() {
        return Ok(path);
    }
    let found = tokio::task::spawn_blocking(search)
        .await
        .map_err(|e| format!("The search failed: {e}"))??;
    *slot.lock().unwrap() = Some(found.clone());
    Ok(found)
}

pub async fn find_claude_code() -> Result<PathBuf, String> {
    cached(&CLAUDE_CODE_BIN, search_claude_code).await
}

pub async fn find_codex() -> Result<PathBuf, String> {
    cached(&CODEX_BIN, search_codex).await
}

fn env_path(name: &str) -> Option<PathBuf> {
    std::env::var(name).ok().map(|v| v.trim().to_string()).filter(|v| !v.is_empty()).map(PathBuf::from)
}

fn home() -> Option<PathBuf> {
    env_path("USERPROFILE").or_else(|| env_path("HOME"))
}

fn path_dirs() -> Vec<PathBuf> {
    std::env::var_os("PATH").map(|p| std::env::split_paths(&p).collect()).unwrap_or_default()
}

fn shown(dirs: &[PathBuf]) -> String {
    dirs.iter().take(8).map(|d| d.display().to_string()).collect::<Vec<_>>().join(", ")
}

fn search_claude_code() -> Result<PathBuf, String> {
    if let Some(configured) = env_path("CLAUDE_CODE_BIN") {
        return Ok(configured);
    }

    let mut dirs = path_dirs();
    if cfg!(windows) {
        dirs.extend(env_path("NVM_SYMLINK"));
        dirs.extend(env_path("APPDATA").map(|d| d.join("npm")));
        dirs.extend(env_path("ProgramFiles").map(|d| d.join("nodejs")));
    } else {
        dirs.extend(["/usr/local/bin", "/usr/bin", "/opt/homebrew/bin"].map(PathBuf::from));
    }
    if let Some(home) = home() {
        dirs.push(home.join(".local").join("bin"));
        dirs.push(home.join(".claude").join("local"));
    }

    for dir in &dirs {
        if let Some(found) = claude_in(dir) {
            return Ok(found);
        }
    }

    Err(format!(
        "Claude Code was not found. Install it and sign in, or set CLAUDE_CODE_BIN to its full path. Looked in: {}.",
        shown(&dirs)
    ))
}

fn claude_in(dir: &Path) -> Option<PathBuf> {
    if !cfg!(windows) {
        let direct = dir.join("claude");
        return direct.is_file().then_some(direct);
    }

    let exe = dir.join("claude.exe");
    if exe.is_file() {
        return Some(exe);
    }

    // npm's .cmd shim cannot be run without a shell, but it names the real
    // executable, which can.
    let shim = dir.join("claude.cmd");
    let target = shim_target(&shim)?;
    target.is_file().then_some(target)
}

/// The executable an npm `.cmd` shim calls: `"%dp0%\node_modules\...\claude.exe" %*`.
fn shim_target(shim: &Path) -> Option<PathBuf> {
    let contents = std::fs::read_to_string(shim).ok()?;
    let start = contents.find("\"%dp0%")? + "\"%dp0%".len();
    let rest = &contents[start..];
    let end = rest.to_ascii_lowercase().find(".exe\"")? + ".exe".len();
    let relative = rest[..end].trim_start_matches(['\\', '/']);
    let mut path = shim.parent()?.to_path_buf();
    for part in relative.split(['\\', '/']).filter(|p| !p.is_empty()) {
        path.push(part);
    }
    Some(path)
}

fn search_codex() -> Result<PathBuf, String> {
    if let Some(configured) = env_path("CODEX_BIN") {
        return Ok(configured);
    }

    // The CLI bundled inside the Codex desktop app. Its folder carries the
    // app's version and the folder above it cannot be listed, so Windows is
    // asked where the package is installed.
    #[cfg(windows)]
    if let Some(bundled) = codex_from_desktop_app() {
        if bundled.is_file() {
            return Ok(bundled);
        }
    }

    let mut dirs = path_dirs();
    if let Some(home) = home() {
        dirs.push(home.join(".local").join("bin"));
    }
    if !cfg!(windows) {
        dirs.extend(["/usr/local/bin", "/opt/homebrew/bin"].map(PathBuf::from));
    }

    let name = if cfg!(windows) { "codex.exe" } else { "codex" };
    for dir in &dirs {
        let candidate = dir.join(name);
        if candidate.is_file() {
            return Ok(candidate);
        }
    }

    Err(format!(
        "Codex was not found. Install the Codex app or CLI and sign in, or set CODEX_BIN to its full path. Looked in: {}.",
        shown(&dirs)
    ))
}

#[cfg(windows)]
fn codex_from_desktop_app() -> Option<PathBuf> {
    use std::os::windows::process::CommandExt;

    let output = std::process::Command::new("powershell.exe")
        .args([
            "-NoProfile",
            "-NonInteractive",
            "-Command",
            "(Get-AppxPackage OpenAI.Codex).InstallLocation",
        ])
        .creation_flags(CREATE_NO_WINDOW)
        .output()
        .ok()?;
    let location = String::from_utf8_lossy(&output.stdout).trim().to_string();
    (!location.is_empty()).then(|| PathBuf::from(location).join("app").join("resources").join("codex.exe"))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn job(tool: &str, model: &str) -> CliJob {
        CliJob {
            tool: tool.into(),
            system: Some("S".into()),
            conversation: "Q".into(),
            json_schema: Some(serde_json::json!({ "type": "object" })),
            model: model.into(),
            timeout_ms: 1,
        }
    }

    /// The same expected list as `claude-code.test.ts`.
    #[test]
    fn claude_code_args_match_the_server() {
        let args = claude_code_args(&job("CLAUDE_CODE", "haiku")).unwrap();
        assert_eq!(
            args,
            vec![
                "-p", "--output-format", "json", "--model", "haiku",
                "--disallowedTools", &CLAUDE_CODE_DENIED_TOOLS.join(","),
                "--system-prompt", "S", "--json-schema", "{\"type\":\"object\"}",
            ]
        );
    }

    /// The same expected list as `codex.test.ts`.
    #[test]
    fn codex_args_match_the_server() {
        let args = codex_args(&job("CODEX", "gpt-5"), Path::new("C"), Path::new("A"), Path::new("S")).unwrap();
        assert_eq!(
            args,
            vec![
                "exec", "--json", "--sandbox", "read-only", "--ephemeral", "--skip-git-repo-check",
                "-C", "C", "-o", "A", "--output-schema", "S", "-m", "gpt-5", "-",
            ]
        );
        assert_eq!(codex_input(&job("CODEX", "x")), "S\n\n---\n\nQ");
    }

    #[test]
    fn codex_default_model_passes_no_flag() {
        let args = codex_args(&job("CODEX", CODEX_DEFAULT_MODEL), Path::new("C"), Path::new("A"), Path::new("S")).unwrap();
        assert!(!args.contains(&"-m".to_string()));
    }

    #[test]
    fn a_model_name_cannot_smuggle_in_a_flag() {
        assert!(claude_code_args(&job("CLAUDE_CODE", "--dangerously-skip-permissions")).is_err());
        assert!(claude_code_args(&job("CLAUDE_CODE", "haiku; rm -rf /")).is_err());
        assert!(codex_args(&job("CODEX", "-c"), Path::new("C"), Path::new("A"), Path::new("S")).is_err());
        assert!(claude_code_args(&job("CLAUDE_CODE", "claude-sonnet-4-5[1m]")).is_ok());
    }

    #[test]
    fn reads_the_real_executable_out_of_an_npm_shim() {
        let dir = tempfile::tempdir().unwrap();
        let shim = dir.path().join("claude.cmd");
        std::fs::write(
            &shim,
            "@ECHO off\r\n\"%dp0%\\node_modules\\@anthropic-ai\\claude-code\\bin\\claude.exe\"   %*\r\n",
        )
        .unwrap();
        let target = shim_target(&shim).unwrap();
        assert!(target.ends_with(Path::new("node_modules/@anthropic-ai/claude-code/bin/claude.exe")));
        assert!(target.starts_with(dir.path()));
    }

    #[tokio::test]
    async fn an_unknown_tool_is_refused() {
        let (_tx, rx) = oneshot::channel();
        assert!(run(job("BASH", "x"), rx).await.is_err());
    }
}
