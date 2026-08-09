mod browser_runtime;
mod profile_store;

use profile_store::{
    check_root_health, copy_profile_dir, create_full_profile_backup, create_profile_backup,
    default_browser_path, delete_profile_dir, directory_size, ensure_profile_backups_dir,
    ensure_profile_dir, import_profile_dir, init_root, load_profile_document,
    preview_full_profile_backup, preview_full_profile_restore, repair_root_health,
    restore_full_profile_backup, restore_profile_backup, save_profile_document, BrowserLaunchEvent,
    FullProfileBackupPreview, FullProfileBackupResult, FullProfileRestorePreview,
    ProfileBackupResult, ProfileDocument, ProfileImportCandidate, ProfileMarker, RootHealthReport,
    RootRepairResult, RootStatus,
};
use serde::Serialize;
use std::collections::{BTreeMap, BTreeSet};
use std::net::TcpListener;
use std::path::{Path, PathBuf};
use std::process::Command;
use std::sync::{Mutex, OnceLock};
use std::time::{Instant, SystemTime, UNIX_EPOCH};

const CDP_BIND_ADDRESS: &str = "127.0.0.1";
const CDP_PORT_START: u16 = 19222;
const CDP_PORT_END: u16 = 19321;
const CDP_SNAPSHOT_PROBE_BUDGET_MS: u64 = 750;

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct ChromeStatus {
    available: bool,
    app_path: Option<String>,
}

#[derive(Debug, Eq, PartialEq)]
struct RunningProfileProcess {
    profile_id: String,
    pid: u32,
    debug_port: Option<u16>,
}

#[derive(Debug, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
struct ChromeWindowInfo {
    index: u32,
    title: String,
    x: i32,
    y: i32,
    width: i32,
    height: i32,
    minimized: bool,
}

#[derive(Debug, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
enum BrowserSessionStatus {
    Running,
    Stopped,
}

#[derive(Debug, Eq, PartialEq, Serialize, Clone)]
#[serde(rename_all = "kebab-case")]
enum BrowserSessionCdpStatus {
    Unknown,
    Available,
    MissingPort,
    Failed,
}

#[derive(Debug, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
struct BrowserSessionSnapshot {
    profile_id: String,
    status: BrowserSessionStatus,
    running: bool,
    pid: Option<u32>,
    debug_port: Option<u16>,
    cdp_status: BrowserSessionCdpStatus,
    runtime_error: Option<String>,
    window_count: Option<usize>,
    windows: Vec<ChromeWindowInfo>,
    window_error: Option<String>,
    checked_at: u64,
}

use browser_runtime::{RuntimeTabNavigationResult, TabSnapshot};

#[derive(Debug, Eq, PartialEq)]
struct LaunchCommand {
    program: PathBuf,
    args: Vec<String>,
}

#[cfg(target_os = "macos")]
mod macos_accessibility;

pub fn run() {
    tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![
            default_root_path,
            check_profile_root_health,
            repair_profile_root_health,
            create_profiles_backup,
            restore_profiles_backup,
            preview_full_profiles_backup,
            create_full_profiles_backup,
            preview_full_profiles_restore,
            restore_full_profiles_backup,
            reveal_profile_backups_dir,
            init_profile_root,
            load_profiles,
            save_profiles,
            load_browser_launch_events,
            save_browser_launch_events,
            profile_directory_size,
            detect_chrome,
            open_profile,
            list_running_profiles,
            snapshot_browser_sessions,
            list_runtime_tabs,
            navigate_runtime_tab,
            focus_profile_window,
            quit_profile_browser,
            list_profile_windows,
            set_profile_window_bounds,
            delete_profile_data,
            copy_profile_data,
            import_profile_data,
            scan_profile_import_candidates,
            reveal_path
        ])
        .run(tauri::generate_context!())
        .expect("failed to run MultiChrome");
}

#[tauri::command]
fn default_root_path() -> Result<String, String> {
    let home = dirs::home_dir().ok_or_else(|| "无法定位用户主目录".to_string())?;
    Ok(home
        .join("MultiChromeProfiles")
        .to_string_lossy()
        .to_string())
}

#[tauri::command]
fn check_profile_root_health(root_path: String) -> RootHealthReport {
    check_root_health(&PathBuf::from(root_path))
}

#[tauri::command]
fn repair_profile_root_health(root_path: String) -> Result<RootRepairResult, String> {
    repair_root_health(&PathBuf::from(root_path))
}

#[tauri::command]
fn create_profiles_backup(root_path: String) -> Result<ProfileBackupResult, String> {
    create_profile_backup(&PathBuf::from(root_path))
}

#[tauri::command]
fn restore_profiles_backup(
    root_path: String,
    backup_path: String,
) -> Result<ProfileDocument, String> {
    restore_profile_backup(&PathBuf::from(root_path), &PathBuf::from(backup_path))
}

#[tauri::command]
fn preview_full_profiles_backup(
    root_path: String,
    profile_ids: Vec<String>,
) -> Result<FullProfileBackupPreview, String> {
    preview_full_profile_backup(&PathBuf::from(root_path), &profile_ids)
}

#[tauri::command]
fn create_full_profiles_backup(
    root_path: String,
    profile_ids: Vec<String>,
) -> Result<FullProfileBackupResult, String> {
    create_full_profile_backup(&PathBuf::from(root_path), &profile_ids)
}

#[tauri::command]
fn preview_full_profiles_restore(
    root_path: String,
    backup_path: String,
) -> Result<FullProfileRestorePreview, String> {
    preview_full_profile_restore(&PathBuf::from(root_path), &PathBuf::from(backup_path))
}

#[tauri::command]
fn restore_full_profiles_backup(
    root_path: String,
    backup_path: String,
    overwrite_existing: bool,
) -> Result<ProfileDocument, String> {
    restore_full_profile_backup(
        &PathBuf::from(root_path),
        &PathBuf::from(backup_path),
        overwrite_existing,
    )
}

#[tauri::command]
fn reveal_profile_backups_dir(root_path: String) -> Result<String, String> {
    let path = ensure_profile_backups_dir(&PathBuf::from(root_path))?;
    reveal_path(path.to_string_lossy().to_string())?;
    Ok(path.to_string_lossy().to_string())
}

#[tauri::command]
fn init_profile_root(root_path: String) -> Result<RootStatus, String> {
    init_root(&PathBuf::from(root_path))
}

#[tauri::command]
fn load_profiles(root_path: String) -> Result<ProfileDocument, String> {
    load_profile_document(&PathBuf::from(root_path))
}

#[tauri::command]
fn save_profiles(root_path: String, document: ProfileDocument) -> Result<(), String> {
    save_profile_document(&PathBuf::from(root_path), &document)
}

#[tauri::command]
fn load_browser_launch_events(root_path: String) -> Result<Vec<BrowserLaunchEvent>, String> {
    profile_store::load_browser_launch_events(&PathBuf::from(root_path))
}

#[tauri::command]
fn save_browser_launch_events(
    root_path: String,
    events: Vec<BrowserLaunchEvent>,
) -> Result<(), String> {
    profile_store::save_browser_launch_events(&PathBuf::from(root_path), &events)
}

#[tauri::command]
fn profile_directory_size(path: String) -> Result<u64, String> {
    directory_size(&PathBuf::from(path))
}

#[tauri::command]
fn detect_chrome(browser_path: Option<String>) -> ChromeStatus {
    let app_path = configured_browser_path(browser_path);
    ChromeStatus {
        available: app_path.exists(),
        app_path: app_path
            .exists()
            .then(|| app_path.to_string_lossy().to_string()),
    }
}

#[tauri::command]
fn open_profile(
    root_path: String,
    profile_id: String,
    browser_path: Option<String>,
    launch_url: Option<String>,
) -> Result<String, String> {
    let root_path = PathBuf::from(root_path);
    let profile_dir = ensure_profile_dir(&root_path, &profile_id)?;
    let browser = configured_browser_path(browser_path);
    if !browser.exists() {
        return Err(format!("未检测到浏览器：{}", browser.to_string_lossy()));
    }

    let is_running = is_profile_running(&root_path, &profile_id).unwrap_or(false);
    let debug_port = if is_running {
        None
    } else {
        Some(allocate_debug_port()?)
    };
    let launch_command =
        profile_launch_command(&browser, &profile_dir, launch_url, is_running, debug_port);
    let status = Command::new(&launch_command.program)
        .args(&launch_command.args)
        .status()
        .map_err(|error| error.to_string())?;

    if status.success() {
        Ok(profile_dir.to_string_lossy().to_string())
    } else {
        Err("启动 Google Chrome 失败".to_string())
    }
}

fn is_profile_running(root_path: &Path, profile_id: &str) -> Result<bool, String> {
    let output = Command::new("ps")
        .args(["-axo", "command="])
        .output()
        .map_err(|error| error.to_string())?;

    if !output.status.success() {
        return Err("读取 Chrome 运行状态失败".to_string());
    }

    let stdout = String::from_utf8_lossy(&output.stdout);
    Ok(
        running_profile_ids_from_processes(root_path, stdout.lines())
            .iter()
            .any(|running_profile_id| running_profile_id == profile_id),
    )
}

#[tauri::command]
fn list_running_profiles(root_path: String) -> Result<Vec<String>, String> {
    let output = Command::new("ps")
        .args(["-axo", "command="])
        .output()
        .map_err(|error| error.to_string())?;

    if !output.status.success() {
        return Err("读取 Chrome 运行状态失败".to_string());
    }

    let stdout = String::from_utf8_lossy(&output.stdout);
    Ok(running_profile_ids_from_processes(
        &PathBuf::from(root_path),
        stdout.lines(),
    ))
}

#[tauri::command]
fn snapshot_browser_sessions(
    root_path: String,
    profile_ids: Vec<String>,
    include_windows: Option<bool>,
) -> Result<Vec<BrowserSessionSnapshot>, String> {
    let output = Command::new("ps")
        .args(["-axo", "pid=,command="])
        .output()
        .map_err(|error| error.to_string())?;

    if !output.status.success() {
        return Err("读取 Chrome 会话状态失败".to_string());
    }

    let stdout = String::from_utf8_lossy(&output.stdout);
    Ok(browser_session_snapshots_from_processes(
        &PathBuf::from(root_path),
        &profile_ids,
        stdout.lines(),
        include_windows.unwrap_or(false),
        list_chrome_windows,
        browser_runtime::probe_cdp_version,
        current_time_millis(),
    ))
}

#[tauri::command]
fn list_runtime_tabs(root_path: String, profile_id: String) -> Result<Vec<TabSnapshot>, String> {
    let output = Command::new("ps")
        .args(["-axo", "pid=,command="])
        .output()
        .map_err(|_| "Browser Runtime 不可用".to_string())?;

    if !output.status.success() {
        return Err("Browser Runtime 不可用".to_string());
    }

    let stdout = String::from_utf8_lossy(&output.stdout);
    browser_runtime::runtime_tabs_from_processes(
        &PathBuf::from(root_path),
        &profile_id,
        stdout.lines(),
        browser_runtime::fetch_cdp_tabs,
        current_time_millis(),
    )
}

#[tauri::command]
fn navigate_runtime_tab(
    root_path: String,
    profile_id: String,
    url: String,
) -> Result<RuntimeTabNavigationResult, String> {
    let url = browser_runtime::validate_runtime_navigation_url(&url)?;
    let output = Command::new("ps")
        .args(["-axo", "pid=,command="])
        .output()
        .map_err(|_| "Browser Runtime 不可用".to_string())?;

    if !output.status.success() {
        return Err("Browser Runtime 不可用".to_string());
    }

    let stdout = String::from_utf8_lossy(&output.stdout);
    browser_runtime::navigate_runtime_tab_from_processes(
        &PathBuf::from(root_path),
        &profile_id,
        &url,
        stdout.lines(),
        browser_runtime::fetch_cdp_tabs,
        browser_runtime::send_cdp_page_navigate,
        current_time_millis(),
    )
}

#[tauri::command]
fn focus_profile_window(root_path: String, profile_id: String) -> Result<(), String> {
    let process = running_profile_process_for(&PathBuf::from(root_path), &profile_id)?;
    focus_chrome_process(process.pid)
}

#[tauri::command]
fn quit_profile_browser(root_path: String, profile_id: String) -> Result<(), String> {
    let root_path = PathBuf::from(root_path);
    let process_lines = read_process_lines()?;
    let process = strict_profile_process_for(
        &root_path,
        &profile_id,
        process_lines.iter().map(String::as_str),
    )?;
    let command = quit_profile_process_plan_if_matches(
        &root_path,
        &profile_id,
        process.pid,
        read_process_lines()?.iter().map(String::as_str),
    )?;
    let status = Command::new(&command.program)
        .args(&command.args)
        .status()
        .map_err(|error| error.to_string())?;
    if status.success() {
        Ok(())
    } else {
        Err(format!("退出账号浏览器失败：{}", profile_id))
    }
}

#[tauri::command]
fn list_profile_windows(
    root_path: String,
    profile_id: String,
) -> Result<Vec<ChromeWindowInfo>, String> {
    let process = running_profile_process_for(&PathBuf::from(root_path), &profile_id)?;
    list_chrome_windows(process.pid)
}

#[tauri::command]
fn set_profile_window_bounds(
    root_path: String,
    profile_id: String,
    x: i32,
    y: i32,
    width: i32,
    height: i32,
) -> Result<(), String> {
    let process = running_profile_process_for(&PathBuf::from(root_path), &profile_id)?;
    set_chrome_window_bounds(process.pid, x, y, width, height)
}

fn running_profile_process_for(
    root_path: &Path,
    profile_id: &str,
) -> Result<RunningProfileProcess, String> {
    let output = Command::new("ps")
        .args(["-axo", "pid=,command="])
        .output()
        .map_err(|error| error.to_string())?;

    if !output.status.success() {
        return Err("读取 Chrome 窗口状态失败".to_string());
    }

    let stdout = String::from_utf8_lossy(&output.stdout);
    find_running_profile_process(root_path, profile_id, stdout.lines())
}

fn find_running_profile_process<'a, I>(
    root_path: &Path,
    profile_id: &str,
    process_lines: I,
) -> Result<RunningProfileProcess, String>
where
    I: IntoIterator<Item = &'a str>,
{
    running_profile_processes_from_processes(root_path, process_lines)
        .into_iter()
        .find(|process| process.profile_id == profile_id)
        .ok_or_else(|| "没有找到这个账号的运行窗口，请先打开账号".to_string())
}

fn quit_profile_process_plan(pid: u32) -> LaunchCommand {
    LaunchCommand {
        program: PathBuf::from("/bin/kill"),
        args: vec!["-TERM".to_string(), pid.to_string()],
    }
}

fn read_process_lines() -> Result<Vec<String>, String> {
    let output = Command::new("ps")
        .args(["-axo", "pid=,command="])
        .output()
        .map_err(|error| error.to_string())?;

    if !output.status.success() {
        return Err("读取 Chrome 运行状态失败".to_string());
    }

    Ok(String::from_utf8_lossy(&output.stdout)
        .lines()
        .map(str::to_string)
        .collect())
}

fn strict_profile_process_for<'a, I>(
    root_path: &Path,
    profile_id: &str,
    process_lines: I,
) -> Result<RunningProfileProcess, String>
where
    I: IntoIterator<Item = &'a str>,
{
    let expected_user_data_dir = clean_path_text(
        &root_path
            .join("profiles")
            .join(profile_id)
            .to_string_lossy(),
    );

    process_lines
        .into_iter()
        .filter_map(split_pid_and_command)
        .find_map(|(pid, command)| {
            if !is_strict_main_chrome_process_for_quit(command) {
                return None;
            }
            let user_data_dir = extract_user_data_dir(command)?;
            if clean_path_text(&user_data_dir) != expected_user_data_dir {
                return None;
            }
            Some(RunningProfileProcess {
                profile_id: profile_id.to_string(),
                pid,
                debug_port: extract_remote_debugging_port(command),
            })
        })
        .ok_or_else(|| "没有找到这个账号的匹配运行进程，已取消退出".to_string())
}

fn quit_profile_process_plan_if_matches<'a, I>(
    root_path: &Path,
    profile_id: &str,
    expected_pid: u32,
    process_lines: I,
) -> Result<LaunchCommand, String>
where
    I: IntoIterator<Item = &'a str>,
{
    let process = strict_profile_process_for(root_path, profile_id, process_lines)?;
    if process.pid != expected_pid {
        return Err("没有找到这个账号的匹配运行进程，已取消退出".to_string());
    }
    Ok(quit_profile_process_plan(process.pid))
}

fn is_strict_main_chrome_process_for_quit(command: &str) -> bool {
    if !command.contains("--user-data-dir")
        || command.contains("Google Chrome Helper")
        || command.contains("--type=")
    {
        return false;
    }

    let Some(command_prefix) = command.split("--user-data-dir").next() else {
        return false;
    };
    let executable = command_prefix
        .split(" --")
        .next()
        .unwrap_or(command_prefix)
        .trim();
    executable.contains("Google Chrome.app/Contents/MacOS/Google Chrome")
}

#[tauri::command]
fn delete_profile_data(root_path: String, profile_id: String) -> Result<(), String> {
    delete_profile_dir(&PathBuf::from(root_path), &profile_id)
}

#[tauri::command]
fn copy_profile_data(
    root_path: String,
    source_profile_id: String,
    target_profile_id: String,
) -> Result<(), String> {
    copy_profile_dir(
        &PathBuf::from(root_path),
        &source_profile_id,
        &target_profile_id,
    )
}

#[tauri::command]
fn import_profile_data(
    root_path: String,
    source_path: String,
    target_profile_id: String,
    marker: Option<ProfileMarker>,
) -> Result<(), String> {
    import_profile_dir(
        &PathBuf::from(root_path),
        &PathBuf::from(source_path),
        &target_profile_id,
        marker,
    )
}

#[tauri::command]
fn scan_profile_import_candidates(
    root_path: String,
    source_path: String,
) -> Result<Vec<ProfileImportCandidate>, String> {
    profile_store::scan_profile_import_candidates(
        &PathBuf::from(root_path),
        &PathBuf::from(source_path),
    )
}

fn chrome_launch_args(
    profile_dir: &Path,
    launch_url: Option<String>,
    debug_port: Option<u16>,
) -> Vec<String> {
    let mut args = vec![format!("--user-data-dir={}", profile_dir.to_string_lossy())];
    if let Some(port) = debug_port {
        args.push(format!("--remote-debugging-port={port}"));
        args.push(format!("--remote-debugging-address={CDP_BIND_ADDRESS}"));
    }
    args.push("--no-first-run".to_string());

    if let Some(url) = launch_url.map(|value| value.trim().to_string()) {
        if !url.is_empty() {
            args.push(url);
        }
    }

    args
}

fn profile_launch_command(
    browser: &Path,
    profile_dir: &Path,
    launch_url: Option<String>,
    is_profile_running: bool,
    debug_port: Option<u16>,
) -> LaunchCommand {
    if is_profile_running {
        LaunchCommand {
            program: browser_executable_path(browser),
            args: chrome_launch_args(profile_dir, launch_url, None),
        }
    } else {
        let mut args = vec![
            "-n".to_string(),
            "-a".to_string(),
            browser.to_string_lossy().to_string(),
            "--args".to_string(),
        ];
        args.extend(chrome_launch_args(profile_dir, launch_url, debug_port));

        LaunchCommand {
            program: PathBuf::from("open"),
            args,
        }
    }
}

fn allocate_debug_port() -> Result<u16, String> {
    let _guard = debug_port_allocation_lock()
        .lock()
        .map_err(|_| "Browser Runtime debug port 分配锁不可用".to_string())?;
    find_available_debug_port_in_range(CDP_PORT_START, CDP_PORT_END)
        .ok_or_else(|| "没有可用的 Browser Runtime debug port".to_string())
}

fn debug_port_allocation_lock() -> &'static Mutex<()> {
    static LOCK: OnceLock<Mutex<()>> = OnceLock::new();
    LOCK.get_or_init(|| Mutex::new(()))
}

fn find_available_debug_port_in_range(start: u16, end: u16) -> Option<u16> {
    for port in start..=end {
        if TcpListener::bind((CDP_BIND_ADDRESS, port)).is_ok() {
            return Some(port);
        }
    }

    None
}

fn browser_executable_path(browser: &Path) -> PathBuf {
    if browser
        .extension()
        .is_some_and(|extension| extension == "app")
    {
        let macos_dir = browser.join("Contents").join("MacOS");
        let executable_name = browser
            .file_stem()
            .map(|value| value.to_string_lossy().to_string())
            .filter(|value| !value.trim().is_empty())
            .unwrap_or_else(|| "Google Chrome".to_string());
        let app_name_candidate = macos_dir.join(executable_name);
        if app_name_candidate.exists() {
            return app_name_candidate;
        }

        if let Ok(entries) = std::fs::read_dir(&macos_dir) {
            let mut executable_candidates = entries
                .filter_map(Result::ok)
                .map(|entry| entry.path())
                .filter(|path| path.is_file())
                .collect::<Vec<_>>();
            executable_candidates.sort();
            if let Some(executable) = executable_candidates.into_iter().next() {
                return executable;
            }
        }

        app_name_candidate
    } else {
        browser.to_path_buf()
    }
}

fn running_profile_ids_from_processes<'a, I>(root_path: &Path, process_lines: I) -> Vec<String>
where
    I: IntoIterator<Item = &'a str>,
{
    let profile_root_candidates = profile_root_candidates(root_path);

    let mut profile_ids = BTreeSet::new();
    for line in process_lines {
        if let Some(profile_id) = profile_id_from_process_line(line, &profile_root_candidates) {
            profile_ids.insert(profile_id);
        }
    }

    profile_ids.into_iter().collect()
}

fn running_profile_processes_from_processes<'a, I>(
    root_path: &Path,
    process_lines: I,
) -> Vec<RunningProfileProcess>
where
    I: IntoIterator<Item = &'a str>,
{
    let profile_root_candidates = profile_root_candidates(root_path);
    let mut profile_processes = BTreeMap::new();

    for line in process_lines {
        let Some((pid, command)) = split_pid_and_command(line) else {
            continue;
        };
        let Some(profile_id) = profile_id_from_process_line(command, &profile_root_candidates)
        else {
            continue;
        };
        profile_processes
            .entry(profile_id)
            .or_insert_with(|| RunningProfileProcess {
                profile_id: String::new(),
                pid,
                debug_port: extract_remote_debugging_port(command),
            });
    }

    profile_processes
        .into_iter()
        .map(|(profile_id, process)| RunningProfileProcess {
            profile_id,
            pid: process.pid,
            debug_port: process.debug_port,
        })
        .collect()
}

#[derive(Debug, Eq, PartialEq)]
struct CdpProbeResult {
    status: BrowserSessionCdpStatus,
    runtime_error: Option<String>,
    elapsed_ms: u64,
}

fn browser_session_snapshots_from_processes<'a, I, F, P>(
    root_path: &Path,
    profile_ids: &[String],
    process_lines: I,
    include_windows: bool,
    list_windows: F,
    mut probe_cdp: P,
    checked_at: u64,
) -> Vec<BrowserSessionSnapshot>
where
    I: IntoIterator<Item = &'a str>,
    F: FnMut(u32) -> Result<Vec<ChromeWindowInfo>, String>,
    P: FnMut(u16) -> Result<(), String>,
{
    browser_session_snapshots_from_processes_with_budget(
        root_path,
        profile_ids,
        process_lines,
        include_windows,
        list_windows,
        |port| {
            let started_at = Instant::now();
            match probe_cdp(port) {
                Ok(()) => CdpProbeResult {
                    status: BrowserSessionCdpStatus::Available,
                    runtime_error: None,
                    elapsed_ms: elapsed_millis(started_at),
                },
                Err(error) => CdpProbeResult {
                    status: BrowserSessionCdpStatus::Failed,
                    runtime_error: Some(browser_runtime::short_cdp_probe_error(&error)),
                    elapsed_ms: elapsed_millis(started_at),
                },
            }
        },
        checked_at,
        CDP_SNAPSHOT_PROBE_BUDGET_MS,
    )
}

fn browser_session_snapshots_from_processes_with_budget<'a, I, F, P>(
    root_path: &Path,
    profile_ids: &[String],
    process_lines: I,
    include_windows: bool,
    mut list_windows: F,
    mut probe_cdp: P,
    checked_at: u64,
    cdp_probe_budget_ms: u64,
) -> Vec<BrowserSessionSnapshot>
where
    I: IntoIterator<Item = &'a str>,
    F: FnMut(u32) -> Result<Vec<ChromeWindowInfo>, String>,
    P: FnMut(u16) -> CdpProbeResult,
{
    let running_processes: BTreeMap<String, RunningProfileProcess> =
        running_profile_processes_from_processes(root_path, process_lines)
            .into_iter()
            .map(|process| (process.profile_id.clone(), process))
            .collect();
    let mut cdp_probe_elapsed_ms = 0;

    profile_ids
        .iter()
        .map(|profile_id| {
            let Some(process) = running_processes.get(profile_id) else {
                return BrowserSessionSnapshot {
                    profile_id: profile_id.to_string(),
                    status: BrowserSessionStatus::Stopped,
                    running: false,
                    pid: None,
                    debug_port: None,
                    cdp_status: BrowserSessionCdpStatus::Unknown,
                    runtime_error: None,
                    window_count: Some(0),
                    windows: vec![],
                    window_error: None,
                    checked_at,
                };
            };
            let (cdp_status, runtime_error) = cdp_status_for_process(
                process.debug_port,
                &mut probe_cdp,
                &mut cdp_probe_elapsed_ms,
                cdp_probe_budget_ms,
            );

            if !include_windows {
                return BrowserSessionSnapshot {
                    profile_id: profile_id.to_string(),
                    status: BrowserSessionStatus::Running,
                    running: true,
                    pid: Some(process.pid),
                    debug_port: process.debug_port,
                    cdp_status,
                    runtime_error,
                    window_count: None,
                    windows: vec![],
                    window_error: None,
                    checked_at,
                };
            }

            match list_windows(process.pid) {
                Ok(windows) => {
                    let window_count = windows.len();
                    BrowserSessionSnapshot {
                        profile_id: profile_id.to_string(),
                        status: BrowserSessionStatus::Running,
                        running: true,
                        pid: Some(process.pid),
                        debug_port: process.debug_port,
                        cdp_status,
                        runtime_error,
                        window_count: Some(window_count),
                        windows,
                        window_error: None,
                        checked_at,
                    }
                }
                Err(error) => BrowserSessionSnapshot {
                    profile_id: profile_id.to_string(),
                    status: BrowserSessionStatus::Running,
                    running: true,
                    pid: Some(process.pid),
                    debug_port: process.debug_port,
                    cdp_status,
                    runtime_error,
                    window_count: None,
                    windows: vec![],
                    window_error: Some(error),
                    checked_at,
                },
            }
        })
        .collect()
}

fn cdp_status_for_process<P>(
    debug_port: Option<u16>,
    probe_cdp: &mut P,
    cdp_probe_elapsed_ms: &mut u64,
    cdp_probe_budget_ms: u64,
) -> (BrowserSessionCdpStatus, Option<String>)
where
    P: FnMut(u16) -> CdpProbeResult,
{
    let Some(port) = debug_port else {
        return (BrowserSessionCdpStatus::MissingPort, None);
    };

    if cdp_probe_elapsed_ms.saturating_add(browser_runtime::CDP_PROBE_TIMEOUT_MS)
        > cdp_probe_budget_ms
    {
        return (BrowserSessionCdpStatus::Unknown, None);
    }

    let result = probe_cdp(port);
    *cdp_probe_elapsed_ms = cdp_probe_elapsed_ms.saturating_add(result.elapsed_ms);
    (result.status, result.runtime_error)
}

fn elapsed_millis(started_at: Instant) -> u64 {
    started_at.elapsed().as_millis().min(u128::from(u64::MAX)) as u64
}

fn profile_root_candidates(root_path: &Path) -> Vec<String> {
    let profile_root = root_path.join("profiles");
    let mut candidates = vec![clean_path_text(&profile_root.to_string_lossy())];
    if let Ok(canonical_profile_root) = std::fs::canonicalize(&profile_root) {
        let canonical = clean_path_text(&canonical_profile_root.to_string_lossy());
        if !candidates.contains(&canonical) {
            candidates.push(canonical);
        }
    }

    candidates
}

fn profile_id_from_process_line(line: &str, profile_root_candidates: &[String]) -> Option<String> {
    if !is_main_chrome_process(line) {
        return None;
    }

    let user_data_dir = extract_user_data_dir(line)?;
    let mut user_data_candidates = vec![clean_path_text(&user_data_dir)];
    if let Ok(canonical_user_data_dir) = std::fs::canonicalize(&user_data_dir) {
        let canonical = clean_path_text(&canonical_user_data_dir.to_string_lossy());
        if !user_data_candidates.contains(&canonical) {
            user_data_candidates.push(canonical);
        }
    }

    for profile_root_candidate in profile_root_candidates {
        if let Some(profile_id) = user_data_candidates
            .iter()
            .find_map(|candidate| profile_id_from_user_data_dir(candidate, profile_root_candidate))
        {
            return Some(profile_id);
        }
    }

    None
}

fn split_pid_and_command(line: &str) -> Option<(u32, &str)> {
    let trimmed = line.trim_start();
    let pid_end = trimmed.find(char::is_whitespace)?;
    let pid = trimmed[..pid_end].parse().ok()?;
    let command = trimmed[pid_end..].trim_start();
    if command.is_empty() {
        None
    } else {
        Some((pid, command))
    }
}

fn focus_chrome_process(pid: u32) -> Result<(), String> {
    focus_chrome_process_impl(pid)
}

fn list_chrome_windows(pid: u32) -> Result<Vec<ChromeWindowInfo>, String> {
    list_chrome_windows_impl(pid)
}

fn set_chrome_window_bounds(
    pid: u32,
    x: i32,
    y: i32,
    width: i32,
    height: i32,
) -> Result<(), String> {
    set_chrome_window_bounds_impl(pid, x, y, width, height)
}

#[cfg(target_os = "macos")]
fn focus_chrome_process_impl(pid: u32) -> Result<(), String> {
    macos_accessibility::focus_window(pid)
}

#[cfg(not(target_os = "macos"))]
fn focus_chrome_process_impl(_pid: u32) -> Result<(), String> {
    Err("当前系统暂不支持窗口切换".to_string())
}

#[cfg(target_os = "macos")]
fn list_chrome_windows_impl(pid: u32) -> Result<Vec<ChromeWindowInfo>, String> {
    macos_accessibility::list_windows(pid)
}

#[cfg(not(target_os = "macos"))]
fn list_chrome_windows_impl(_pid: u32) -> Result<Vec<ChromeWindowInfo>, String> {
    Err("当前系统暂不支持窗口检查".to_string())
}

#[cfg(target_os = "macos")]
fn set_chrome_window_bounds_impl(
    pid: u32,
    x: i32,
    y: i32,
    width: i32,
    height: i32,
) -> Result<(), String> {
    macos_accessibility::set_window_bounds(pid, x, y, width, height)
}

#[cfg(not(target_os = "macos"))]
fn set_chrome_window_bounds_impl(
    _pid: u32,
    _x: i32,
    _y: i32,
    _width: i32,
    _height: i32,
) -> Result<(), String> {
    Err("当前系统暂不支持窗口平铺".to_string())
}

fn is_main_chrome_process(line: &str) -> bool {
    line.contains("Google Chrome")
        && line.contains("--user-data-dir")
        && !line.contains("Google Chrome Helper")
        && !line.contains("--type=")
}

fn extract_user_data_dir(line: &str) -> Option<String> {
    for marker in ["--user-data-dir=", "--user-data-dir "] {
        let Some(start) = line.find(marker) else {
            continue;
        };
        let rest = &line[start + marker.len()..];
        let end = rest.find(" --").unwrap_or(rest.len());
        let cleaned = rest[..end]
            .trim()
            .trim_matches('"')
            .trim_matches('\'')
            .to_string();
        if !cleaned.is_empty() {
            return Some(cleaned);
        }
    }

    None
}

fn extract_remote_debugging_port(line: &str) -> Option<u16> {
    for marker in ["--remote-debugging-port=", "--remote-debugging-port "] {
        let Some(start) = line.find(marker) else {
            continue;
        };
        let rest = &line[start + marker.len()..];
        let end = rest.find(" --").unwrap_or(rest.len());
        let cleaned = rest[..end].trim().trim_matches('"').trim_matches('\'');
        if let Ok(port) = cleaned.parse::<u16>() {
            return Some(port);
        }
    }

    None
}

fn profile_id_from_user_data_dir(user_data_dir: &str, profile_root: &str) -> Option<String> {
    let profile_root = clean_path_text(profile_root);
    let user_data_dir = clean_path_text(user_data_dir);
    let prefix = format!("{profile_root}/");
    let rest = user_data_dir.strip_prefix(&prefix)?;
    let profile_id = rest.split('/').next()?.trim();
    if profile_id.is_empty() {
        None
    } else {
        Some(profile_id.to_string())
    }
}

fn clean_path_text(path: &str) -> String {
    path.trim().trim_end_matches('/').to_string()
}

fn current_time_millis() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_millis().min(u128::from(u64::MAX)) as u64)
        .unwrap_or(0)
}

fn configured_browser_path(browser_path: Option<String>) -> PathBuf {
    let cleaned = browser_path.unwrap_or_default().trim().to_string();
    if cleaned.is_empty() {
        PathBuf::from(default_browser_path())
    } else {
        PathBuf::from(cleaned)
    }
}

#[tauri::command]
fn reveal_path(path: String) -> Result<(), String> {
    let status = Command::new("open")
        .arg(path)
        .status()
        .map_err(|error| error.to_string())?;

    if status.success() {
        Ok(())
    } else {
        Err("打开目录失败".to_string())
    }
}

#[cfg(test)]
mod tests {
    use super::browser_runtime::*;
    use super::*;
    use std::io::{Read, Write};
    use std::net::TcpListener;
    use std::net::TcpStream;
    use std::path::Path;
    use std::thread;
    use std::time::Duration;

    struct SlowHandshakeStream {
        inner: TcpStream,
        chunk_size: usize,
        delay: Duration,
    }

    struct SlowWebSocketResponseStream {
        inner: TcpStream,
        handshake_written: bool,
        chunk_size: usize,
        delay: Duration,
    }

    impl Read for SlowHandshakeStream {
        fn read(&mut self, buffer: &mut [u8]) -> std::io::Result<usize> {
            self.inner.read(buffer)
        }
    }

    impl Write for SlowHandshakeStream {
        fn write(&mut self, buffer: &[u8]) -> std::io::Result<usize> {
            thread::sleep(self.delay);
            self.inner
                .write(&buffer[..buffer.len().min(self.chunk_size)])
        }

        fn flush(&mut self) -> std::io::Result<()> {
            self.inner.flush()
        }
    }

    impl Read for SlowWebSocketResponseStream {
        fn read(&mut self, buffer: &mut [u8]) -> std::io::Result<usize> {
            self.inner.read(buffer)
        }
    }

    impl Write for SlowWebSocketResponseStream {
        fn write(&mut self, buffer: &[u8]) -> std::io::Result<usize> {
            if !self.handshake_written {
                self.inner.write_all(buffer)?;
                self.handshake_written = true;
                return Ok(buffer.len());
            }

            thread::sleep(self.delay);
            self.inner
                .write(&buffer[..buffer.len().min(self.chunk_size)])
        }

        fn flush(&mut self) -> std::io::Result<()> {
            self.inner.flush()
        }
    }

    #[test]
    fn chrome_launch_args_pass_profile_dir_as_switch_value() {
        let profile_dir = Path::new("/Users/a0000/MultiChromeProfiles/profiles/account-001");

        assert_eq!(
            chrome_launch_args(profile_dir, None, None),
            vec![
                "--user-data-dir=/Users/a0000/MultiChromeProfiles/profiles/account-001".to_string(),
                "--no-first-run".to_string()
            ]
        );
    }

    #[test]
    fn chrome_launch_args_appends_url_when_provided() {
        let profile_dir = Path::new("/Users/a0000/MultiChromeProfiles/profiles/account-001");

        assert_eq!(
            chrome_launch_args(profile_dir, Some("https://galxe.com".to_string()), None),
            vec![
                "--user-data-dir=/Users/a0000/MultiChromeProfiles/profiles/account-001".to_string(),
                "--no-first-run".to_string(),
                "https://galxe.com".to_string()
            ]
        );
    }

    #[test]
    fn chrome_launch_args_put_debug_port_near_profile_dir() {
        let profile_dir = Path::new("/Users/a0000/MultiChromeProfiles/profiles/account-001");

        assert_eq!(
            chrome_launch_args(
                profile_dir,
                Some("chrome://newtab/".to_string()),
                Some(19222)
            ),
            vec![
                "--user-data-dir=/Users/a0000/MultiChromeProfiles/profiles/account-001".to_string(),
                "--remote-debugging-port=19222".to_string(),
                "--remote-debugging-address=127.0.0.1".to_string(),
                "--no-first-run".to_string(),
                "chrome://newtab/".to_string()
            ]
        );
    }

    #[test]
    fn profile_launch_command_uses_new_app_instance_when_profile_is_not_running() {
        let profile_dir = Path::new("/Users/a0000/MultiChromeProfiles/profiles/account-001");
        let browser = Path::new("/Applications/Google Chrome.app");

        assert_eq!(
            profile_launch_command(
                browser,
                profile_dir,
                Some("chrome://newtab/".to_string()),
                false,
                Some(19222)
            ),
            LaunchCommand {
                program: PathBuf::from("open"),
                args: vec![
                    "-n".to_string(),
                    "-a".to_string(),
                    "/Applications/Google Chrome.app".to_string(),
                    "--args".to_string(),
                    "--user-data-dir=/Users/a0000/MultiChromeProfiles/profiles/account-001"
                        .to_string(),
                    "--remote-debugging-port=19222".to_string(),
                    "--remote-debugging-address=127.0.0.1".to_string(),
                    "--no-first-run".to_string(),
                    "chrome://newtab/".to_string()
                ]
            }
        );

        let args = profile_launch_command(
            browser,
            profile_dir,
            Some("chrome://newtab/".to_string()),
            false,
            Some(19222),
        )
        .args;
        let args_index = args.iter().position(|arg| arg == "--args").unwrap();
        let port_index = args
            .iter()
            .position(|arg| arg == "--remote-debugging-port=19222")
            .unwrap();
        let address_index = args
            .iter()
            .position(|arg| arg == "--remote-debugging-address=127.0.0.1")
            .unwrap();
        assert!(port_index > args_index);
        assert!(address_index > args_index);
    }

    #[test]
    fn profile_launch_command_reuses_existing_profile_process_for_new_tab() {
        let profile_dir = Path::new("/Users/a0000/MultiChromeProfiles/profiles/account-001");
        let browser = Path::new("/Applications/Google Chrome.app");

        assert_eq!(
            profile_launch_command(
                browser,
                profile_dir,
                Some("chrome://newtab/".to_string()),
                true,
                None
            ),
            LaunchCommand {
                program: PathBuf::from(
                    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
                ),
                args: vec![
                    "--user-data-dir=/Users/a0000/MultiChromeProfiles/profiles/account-001"
                        .to_string(),
                    "--no-first-run".to_string(),
                    "chrome://newtab/".to_string()
                ]
            }
        );
    }

    #[test]
    fn browser_executable_path_falls_back_to_macos_bundle_file() {
        let app_dir = std::env::temp_dir().join(format!(
            "multichrome-fake-browser-{}.app",
            std::process::id()
        ));
        let macos_dir = app_dir.join("Contents").join("MacOS");
        let executable = macos_dir.join("Actual Browser");
        let _ = std::fs::remove_dir_all(&app_dir);
        std::fs::create_dir_all(&macos_dir).expect("create fake app bundle");
        std::fs::write(&executable, "").expect("create fake app executable");

        assert_eq!(browser_executable_path(&app_dir), executable);

        let _ = std::fs::remove_dir_all(&app_dir);
    }

    #[test]
    fn configured_browser_path_uses_default_for_empty_input() {
        assert_eq!(
            configured_browser_path(Some("  ".to_string())),
            PathBuf::from("/Applications/Google Chrome.app")
        );
    }

    #[test]
    fn debug_port_allocation_skips_occupied_ports() {
        let Some((occupied_listener, occupied_port, available_port)) = consecutive_test_ports()
        else {
            panic!("没有找到可用于测试的连续端口");
        };

        assert_eq!(
            find_available_debug_port_in_range(occupied_port, available_port),
            Some(available_port)
        );
        drop(occupied_listener);
    }

    #[test]
    fn debug_port_allocation_returns_none_when_range_is_exhausted() {
        let listener = std::net::TcpListener::bind(("127.0.0.1", 0)).unwrap();
        let occupied_port = listener.local_addr().unwrap().port();

        assert_eq!(
            find_available_debug_port_in_range(occupied_port, occupied_port),
            None
        );
    }

    fn consecutive_test_ports() -> Option<(std::net::TcpListener, u16, u16)> {
        for occupied_port in 20000..20100 {
            let Ok(occupied_listener) = std::net::TcpListener::bind(("127.0.0.1", occupied_port))
            else {
                continue;
            };
            let available_port = occupied_port + 1;
            if let Ok(available_listener) =
                std::net::TcpListener::bind(("127.0.0.1", available_port))
            {
                drop(available_listener);
                return Some((occupied_listener, occupied_port, available_port));
            }
        }

        None
    }

    #[test]
    fn running_profile_ids_from_processes_matches_main_chrome_processes() {
        let root = Path::new("/Users/a0000/MultiChromeProfiles");
        let lines = [
            "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome --user-data-dir=/Users/a0000/MultiChromeProfiles/profiles/account-001 --no-first-run",
            "/Applications/Google Chrome.app/Contents/Frameworks/Google Chrome Framework.framework/Helpers/Google Chrome Helper.app/Contents/MacOS/Google Chrome Helper --type=renderer --user-data-dir=/Users/a0000/MultiChromeProfiles/profiles/account-002",
            "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome --user-data-dir=/Users/a0000/MultiChromeProfiles/profiles/account-001 --no-first-run",
            "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome --user-data-dir=/Users/a0000/MultiChromeProfiles/profiles/account-003 --no-first-run https://galxe.com",
        ];

        assert_eq!(
            running_profile_ids_from_processes(root, lines),
            vec!["account-001".to_string(), "account-003".to_string()]
        );
    }

    #[test]
    fn running_profile_processes_from_processes_returns_main_pids() {
        let root = Path::new("/Users/a0000/MultiChromeProfiles");
        let lines = [
            "  1201 /Applications/Google Chrome.app/Contents/MacOS/Google Chrome --user-data-dir=/Users/a0000/MultiChromeProfiles/profiles/account-001 --remote-debugging-port=19222 --remote-debugging-address=127.0.0.1 --no-first-run",
            "  1202 /Applications/Google Chrome.app/Contents/Frameworks/Google Chrome Framework.framework/Helpers/Google Chrome Helper.app/Contents/MacOS/Google Chrome Helper --type=renderer --user-data-dir=/Users/a0000/MultiChromeProfiles/profiles/account-001",
            "  1301 /Applications/Google Chrome.app/Contents/MacOS/Google Chrome --user-data-dir=/Users/a0000/MultiChromeProfiles/profiles/account-002 --no-first-run",
            "  1302 /Applications/Google Chrome.app/Contents/MacOS/Google Chrome --user-data-dir=/Users/a0000/MultiChromeProfiles/profiles/account-002 --no-first-run https://galxe.com",
            "not-a-pid /Applications/Google Chrome.app/Contents/MacOS/Google Chrome --user-data-dir=/Users/a0000/MultiChromeProfiles/profiles/account-003",
        ];

        assert_eq!(
            running_profile_processes_from_processes(root, lines),
            vec![
                RunningProfileProcess {
                    profile_id: "account-001".to_string(),
                    pid: 1201,
                    debug_port: Some(19222)
                },
                RunningProfileProcess {
                    profile_id: "account-002".to_string(),
                    pid: 1301,
                    debug_port: None
                }
            ]
        );
    }

    #[test]
    fn quit_profile_process_plan_targets_only_matching_profile_pid() {
        let root = Path::new("/Users/a0000/MultiChromeProfiles");
        let lines = [
            "  1201 /Applications/Google Chrome.app/Contents/MacOS/Google Chrome --user-data-dir=/Users/a0000/MultiChromeProfiles/profiles/account-001 --no-first-run",
            "  1301 /Applications/Google Chrome.app/Contents/MacOS/Google Chrome --user-data-dir=/Users/a0000/MultiChromeProfiles/profiles/account-002 --no-first-run",
        ];
        let process = running_profile_processes_from_processes(root, lines)
            .into_iter()
            .find(|process| process.profile_id == "account-002")
            .expect("matching profile process");

        assert_eq!(quit_profile_process_plan(process.pid), LaunchCommand {
            program: PathBuf::from("/bin/kill"),
            args: vec!["-TERM".to_string(), "1301".to_string()]
        });
    }

    #[test]
    fn strict_quit_match_requires_exact_profile_user_data_dir() {
        let root = Path::new("/root");
        let lines = [
            "  1201 /Applications/Google Chrome.app/Contents/MacOS/Google Chrome --user-data-dir=/root/profiles/account-001/nested --no-first-run",
            "  1202 /Applications/Google Chrome.app/Contents/MacOS/Google Chrome --user-data-dir=/root/profiles/account-001-copy --no-first-run",
            "  1203 /Applications/Google Chrome.app/Contents/MacOS/Google Chrome --user-data-dir=/root/profiles/account-001 --no-first-run",
        ];

        assert_eq!(
            strict_profile_process_for(root, "account-001", lines).unwrap(),
            RunningProfileProcess {
                profile_id: "account-001".to_string(),
                pid: 1203,
                debug_port: None
            }
        );
    }

    #[test]
    fn strict_quit_match_rejects_fake_command_with_exact_user_data_dir() {
        let root = Path::new("/root");
        let lines = [
            "  1201 /usr/bin/python fake Google Chrome --user-data-dir=/root/profiles/account-001",
            "  1202 /tmp/Fake.app/Contents/MacOS/FakeChrome --user-data-dir=/root/profiles/account-001",
            "  1203 /Applications/Google Chrome.app/Contents/MacOS/Google Chrome --user-data-dir=/root/profiles/account-001 --no-first-run",
        ];

        assert_eq!(
            strict_profile_process_for(root, "account-001", lines).unwrap().pid,
            1203
        );
        assert!(!is_strict_main_chrome_process_for_quit(
            lines[0].split_once(' ').unwrap().1
        ));
        assert!(!is_strict_main_chrome_process_for_quit(
            lines[1].split_once(' ').unwrap().1
        ));
        assert!(is_strict_main_chrome_process_for_quit(
            lines[2].split_once(' ').unwrap().1
        ));
    }

    #[test]
    fn quit_plan_rechecks_pid_and_strict_profile_before_term() {
        let root = Path::new("/root");
        let changed_lines = [
            "  1203 /Applications/Google Chrome.app/Contents/MacOS/Google Chrome --user-data-dir=/root/profiles/other-account --no-first-run",
        ];

        assert_eq!(
            quit_profile_process_plan_if_matches(root, "account-001", 1203, changed_lines)
                .unwrap_err(),
            "没有找到这个账号的匹配运行进程，已取消退出"
        );
    }

    #[test]
    fn find_running_profile_process_reports_missing_profile() {
        let root = Path::new("/Users/a0000/MultiChromeProfiles");
        let lines = [
            "  1201 /Applications/Google Chrome.app/Contents/MacOS/Google Chrome --user-data-dir=/Users/a0000/MultiChromeProfiles/profiles/account-001 --no-first-run",
        ];

        assert_eq!(
            find_running_profile_process(root, "account-999", lines).unwrap_err(),
            "没有找到这个账号的运行窗口，请先打开账号"
        );
    }

    #[test]
    fn extract_remote_debugging_port_supports_equals_and_space_forms() {
        assert_eq!(
            extract_remote_debugging_port(
                "Google Chrome --remote-debugging-port=19222 --user-data-dir=/tmp/profile"
            ),
            Some(19222)
        );
        assert_eq!(
            extract_remote_debugging_port(
                "Google Chrome --remote-debugging-port 19223 --user-data-dir=/tmp/profile"
            ),
            Some(19223)
        );
        assert_eq!(
            extract_remote_debugging_port(
                "Google Chrome --remote-debugging-port=not-a-port --user-data-dir=/tmp/profile"
            ),
            None
        );
    }

    #[test]
    fn browser_session_snapshots_keep_running_state_when_window_scan_fails() {
        let root = Path::new("/Users/a0000/MultiChromeProfiles");
        let lines = [
            "  1201 /Applications/Google Chrome.app/Contents/MacOS/Google Chrome --user-data-dir=/Users/a0000/MultiChromeProfiles/profiles/account-001 --no-first-run",
        ];

        assert_eq!(
            browser_session_snapshots_from_processes(
                root,
                &["account-001".to_string(), "account-002".to_string()],
                lines,
                true,
                |_| Err("辅助功能权限不足".to_string()),
                |_| Ok(()),
                1000
            ),
            vec![
                BrowserSessionSnapshot {
                    profile_id: "account-001".to_string(),
                    status: BrowserSessionStatus::Running,
                    running: true,
                    pid: Some(1201),
                    debug_port: None,
                    cdp_status: BrowserSessionCdpStatus::MissingPort,
                    runtime_error: None,
                    window_count: None,
                    windows: vec![],
                    window_error: Some("辅助功能权限不足".to_string()),
                    checked_at: 1000
                },
                BrowserSessionSnapshot {
                    profile_id: "account-002".to_string(),
                    status: BrowserSessionStatus::Stopped,
                    running: false,
                    pid: None,
                    debug_port: None,
                    cdp_status: BrowserSessionCdpStatus::Unknown,
                    runtime_error: None,
                    window_count: Some(0),
                    windows: vec![],
                    window_error: None,
                    checked_at: 1000
                }
            ]
        );
    }

    #[test]
    fn browser_session_snapshots_skip_window_scan_in_lightweight_mode() {
        let root = Path::new("/Users/a0000/MultiChromeProfiles");
        let lines = [
            "  1201 /Applications/Google Chrome.app/Contents/MacOS/Google Chrome --user-data-dir=/Users/a0000/MultiChromeProfiles/profiles/account-001 --no-first-run",
        ];
        let mut window_scan_count = 0;

        let snapshots = browser_session_snapshots_from_processes(
            root,
            &["account-001".to_string(), "account-002".to_string()],
            lines,
            false,
            |_| {
                window_scan_count += 1;
                Ok(vec![ChromeWindowInfo {
                    index: 1,
                    title: "New Tab".to_string(),
                    x: 0,
                    y: 0,
                    width: 800,
                    height: 600,
                    minimized: false,
                }])
            },
            |_| Ok(()),
            1000,
        );

        assert_eq!(window_scan_count, 0);
        assert_eq!(
            snapshots,
            vec![
                BrowserSessionSnapshot {
                    profile_id: "account-001".to_string(),
                    status: BrowserSessionStatus::Running,
                    running: true,
                    pid: Some(1201),
                    debug_port: None,
                    cdp_status: BrowserSessionCdpStatus::MissingPort,
                    runtime_error: None,
                    window_count: None,
                    windows: vec![],
                    window_error: None,
                    checked_at: 1000
                },
                BrowserSessionSnapshot {
                    profile_id: "account-002".to_string(),
                    status: BrowserSessionStatus::Stopped,
                    running: false,
                    pid: None,
                    debug_port: None,
                    cdp_status: BrowserSessionCdpStatus::Unknown,
                    runtime_error: None,
                    window_count: Some(0),
                    windows: vec![],
                    window_error: None,
                    checked_at: 1000
                }
            ]
        );
    }

    #[test]
    fn browser_session_snapshots_report_window_count_when_scanned() {
        let root = Path::new("/Users/a0000/MultiChromeProfiles");
        let lines = [
            "  1201 /Applications/Google Chrome.app/Contents/MacOS/Google Chrome --user-data-dir=/Users/a0000/MultiChromeProfiles/profiles/account-001 --no-first-run",
        ];

        let snapshots = browser_session_snapshots_from_processes(
            root,
            &["account-001".to_string()],
            lines,
            true,
            |_| {
                Ok(vec![
                    ChromeWindowInfo {
                        index: 1,
                        title: "New Tab".to_string(),
                        x: 0,
                        y: 0,
                        width: 800,
                        height: 600,
                        minimized: false,
                    },
                    ChromeWindowInfo {
                        index: 2,
                        title: "Galxe".to_string(),
                        x: 10,
                        y: 20,
                        width: 900,
                        height: 700,
                        minimized: false,
                    },
                ])
            },
            |_| Ok(()),
            1000,
        );

        assert_eq!(snapshots[0].window_count, Some(2));
    }

    #[test]
    fn browser_session_snapshots_report_cdp_available_and_failed() {
        let root = Path::new("/Users/a0000/MultiChromeProfiles");
        let lines = [
            "  1201 /Applications/Google Chrome.app/Contents/MacOS/Google Chrome --user-data-dir=/Users/a0000/MultiChromeProfiles/profiles/account-001 --remote-debugging-port=19222 --remote-debugging-address=127.0.0.1 --no-first-run",
            "  1301 /Applications/Google Chrome.app/Contents/MacOS/Google Chrome --user-data-dir=/Users/a0000/MultiChromeProfiles/profiles/account-002 --remote-debugging-port 19223 --remote-debugging-address=127.0.0.1 --no-first-run",
        ];

        let snapshots = browser_session_snapshots_from_processes(
            root,
            &["account-001".to_string(), "account-002".to_string()],
            lines,
            false,
            |_| Ok(vec![]),
            |port| {
                if port == 19222 {
                    Ok(())
                } else {
                    Err("CDP 连接失败".to_string())
                }
            },
            1000,
        );

        assert_eq!(snapshots[0].debug_port, Some(19222));
        assert_eq!(snapshots[0].cdp_status, BrowserSessionCdpStatus::Available);
        assert_eq!(snapshots[0].runtime_error, None);
        assert_eq!(snapshots[1].debug_port, Some(19223));
        assert_eq!(snapshots[1].cdp_status, BrowserSessionCdpStatus::Failed);
        assert_eq!(snapshots[1].runtime_error, Some("CDP 连接失败".to_string()));
    }

    #[test]
    fn browser_session_snapshots_skip_cdp_probe_after_budget() {
        let root = Path::new("/Users/a0000/MultiChromeProfiles");
        let lines = [
            "  1201 /Applications/Google Chrome.app/Contents/MacOS/Google Chrome --user-data-dir=/Users/a0000/MultiChromeProfiles/profiles/account-001 --remote-debugging-port=19222 --no-first-run",
            "  1301 /Applications/Google Chrome.app/Contents/MacOS/Google Chrome --user-data-dir=/Users/a0000/MultiChromeProfiles/profiles/account-002 --remote-debugging-port=19223 --no-first-run",
        ];
        let mut probe_count = 0;

        let snapshots = browser_session_snapshots_from_processes_with_budget(
            root,
            &["account-001".to_string(), "account-002".to_string()],
            lines,
            false,
            |_| Ok(vec![]),
            |port| {
                probe_count += 1;
                CdpProbeResult {
                    status: BrowserSessionCdpStatus::Available,
                    runtime_error: None,
                    elapsed_ms: if port == 19222 { 751 } else { 1 },
                }
            },
            1000,
            750,
        );

        assert_eq!(probe_count, 1);
        assert_eq!(snapshots[0].cdp_status, BrowserSessionCdpStatus::Available);
        assert_eq!(snapshots[1].cdp_status, BrowserSessionCdpStatus::Unknown);
        assert_eq!(snapshots[1].runtime_error, None);
    }

    #[test]
    fn browser_session_snapshots_skip_cdp_probe_when_remaining_budget_is_too_short() {
        let root = Path::new("/Users/a0000/MultiChromeProfiles");
        let lines = [
            "  1201 /Applications/Google Chrome.app/Contents/MacOS/Google Chrome --user-data-dir=/Users/a0000/MultiChromeProfiles/profiles/account-001 --remote-debugging-port=19222 --no-first-run",
            "  1301 /Applications/Google Chrome.app/Contents/MacOS/Google Chrome --user-data-dir=/Users/a0000/MultiChromeProfiles/profiles/account-002 --remote-debugging-port=19223 --no-first-run",
        ];
        let mut probe_count = 0;

        let snapshots = browser_session_snapshots_from_processes_with_budget(
            root,
            &["account-001".to_string(), "account-002".to_string()],
            lines,
            false,
            |_| Ok(vec![]),
            |_| {
                probe_count += 1;
                CdpProbeResult {
                    status: BrowserSessionCdpStatus::Available,
                    runtime_error: None,
                    elapsed_ms: 600,
                }
            },
            1000,
            750,
        );

        assert_eq!(probe_count, 1);
        assert_eq!(snapshots[0].cdp_status, BrowserSessionCdpStatus::Available);
        assert_eq!(snapshots[1].cdp_status, BrowserSessionCdpStatus::Unknown);
    }

    #[test]
    fn browser_session_cdp_status_serializes_as_kebab_case() {
        assert_eq!(
            serde_json::to_string(&BrowserSessionCdpStatus::MissingPort).unwrap(),
            "\"missing-port\""
        );
    }

    #[test]
    fn runtime_tabs_from_processes_returns_page_targets() {
        let root = Path::new("/Users/a0000/MultiChromeProfiles");
        let lines = [
            "  1201 /Applications/Google Chrome.app/Contents/MacOS/Google Chrome --user-data-dir=/Users/a0000/MultiChromeProfiles/profiles/account-001 --remote-debugging-port=19222 --remote-debugging-address=127.0.0.1 --no-first-run",
        ];

        let tabs = runtime_tabs_from_processes(
            root,
            "account-001",
            lines,
            |port| {
                assert_eq!(port, 19222);
                Ok(vec![
                    CdpTargetRaw {
                        id: Some("page-1".to_string()),
                        r#type: Some("page".to_string()),
                        url: Some("chrome://newtab/".to_string()),
                        title: Some("New Tab".to_string()),
                        web_socket_debugger_url: Some(
                            "ws://127.0.0.1:19222/devtools/page/page-1".to_string(),
                        ),
                    },
                    CdpTargetRaw {
                        id: Some("worker-1".to_string()),
                        r#type: Some("service_worker".to_string()),
                        url: Some("chrome-extension://worker".to_string()),
                        title: Some("Worker".to_string()),
                        web_socket_debugger_url: None,
                    },
                ])
            },
            1000,
        )
        .unwrap();

        assert_eq!(
            tabs,
            vec![TabSnapshot {
                target_id: "page-1".to_string(),
                r#type: "page".to_string(),
                url: "chrome://newtab/".to_string(),
                title: "New Tab".to_string(),
                web_socket_debugger_url: Some(
                    "ws://127.0.0.1:19222/devtools/page/page-1".to_string()
                ),
                checked_at: 1000,
            }]
        );
    }

    #[test]
    fn runtime_tabs_from_processes_reports_stopped_profile() {
        let error = runtime_tabs_from_processes(
            Path::new("/Users/a0000/MultiChromeProfiles"),
            "account-001",
            std::iter::empty::<&str>(),
            |_| Ok(vec![]),
            1000,
        )
        .unwrap_err();

        assert_eq!(error, "该账号未运行");
    }

    #[test]
    fn runtime_tabs_from_processes_reports_missing_debug_port() {
        let root = Path::new("/Users/a0000/MultiChromeProfiles");
        let lines = [
            "  1201 /Applications/Google Chrome.app/Contents/MacOS/Google Chrome --user-data-dir=/Users/a0000/MultiChromeProfiles/profiles/account-001 --no-first-run",
        ];

        let error = runtime_tabs_from_processes(root, "account-001", lines, |_| Ok(vec![]), 1000)
            .unwrap_err();

        assert_eq!(error, "该账号需要关闭后重新打开以启用 Browser Runtime");
    }

    #[test]
    fn runtime_tabs_from_processes_reports_unavailable_runtime() {
        let root = Path::new("/Users/a0000/MultiChromeProfiles");
        let lines = [
            "  1201 /Applications/Google Chrome.app/Contents/MacOS/Google Chrome --user-data-dir=/Users/a0000/MultiChromeProfiles/profiles/account-001 --remote-debugging-port=19222 --remote-debugging-address=127.0.0.1 --no-first-run",
        ];

        let error = runtime_tabs_from_processes(
            root,
            "account-001",
            lines,
            |_| Err("CDP 探测超时".to_string()),
            1000,
        )
        .unwrap_err();

        assert_eq!(error, "Browser Runtime 不可用");
    }

    #[test]
    fn validate_runtime_navigation_url_allows_only_http_and_https() {
        assert_eq!(
            validate_runtime_navigation_url("https://example.com/path").unwrap(),
            "https://example.com/path"
        );
        assert_eq!(
            validate_runtime_navigation_url("http://localhost:3000").unwrap(),
            "http://localhost:3000"
        );

        for value in [
            "",
            "   ",
            "example.com",
            "ftp://example.com",
            "file:///tmp/test.html",
            "javascript:alert(1)",
        ] {
            assert_eq!(
                validate_runtime_navigation_url(value).unwrap_err(),
                "请输入有效的 http:// 或 https:// URL"
            );
        }
    }

    #[test]
    fn navigate_runtime_tab_from_processes_reports_missing_debug_port() {
        let root = Path::new("/Users/a0000/MultiChromeProfiles");
        let lines = [
            "  1201 /Applications/Google Chrome.app/Contents/MacOS/Google Chrome --user-data-dir=/Users/a0000/MultiChromeProfiles/profiles/account-001 --no-first-run",
        ];

        let error = navigate_runtime_tab_from_processes(
            root,
            "account-001",
            "https://example.com",
            lines,
            |_| Ok(vec![]),
            |_, _| Ok(()),
            1000,
        )
        .unwrap_err();

        assert_eq!(error, "该账号需要关闭后重新打开以启用 Browser Runtime");
    }

    #[test]
    fn navigate_runtime_tab_from_processes_reports_stopped_profile() {
        let error = navigate_runtime_tab_from_processes(
            Path::new("/Users/a0000/MultiChromeProfiles"),
            "account-001",
            "https://example.com",
            std::iter::empty::<&str>(),
            |_| Ok(vec![]),
            |_, _| Ok(()),
            1000,
        )
        .unwrap_err();

        assert_eq!(error, "该账号未运行");
    }

    #[test]
    fn navigate_runtime_tab_from_processes_rejects_invalid_url_before_cdp() {
        let root = Path::new("/Users/a0000/MultiChromeProfiles");
        let lines = [
            "  1201 /Applications/Google Chrome.app/Contents/MacOS/Google Chrome --user-data-dir=/Users/a0000/MultiChromeProfiles/profiles/account-001 --remote-debugging-port=19222 --remote-debugging-address=127.0.0.1 --no-first-run",
        ];
        let mut fetch_count = 0;

        let error = navigate_runtime_tab_from_processes(
            root,
            "account-001",
            "chrome://settings",
            lines,
            |_| {
                fetch_count += 1;
                Ok(vec![])
            },
            |_, _| Ok(()),
            1000,
        )
        .unwrap_err();

        assert_eq!(error, "请输入有效的 http:// 或 https:// URL");
        assert_eq!(fetch_count, 0);
    }

    #[test]
    fn navigate_runtime_tab_from_processes_reports_missing_page_tab() {
        let root = Path::new("/Users/a0000/MultiChromeProfiles");
        let lines = [
            "  1201 /Applications/Google Chrome.app/Contents/MacOS/Google Chrome --user-data-dir=/Users/a0000/MultiChromeProfiles/profiles/account-001 --remote-debugging-port=19222 --remote-debugging-address=127.0.0.1 --no-first-run",
        ];

        let error = navigate_runtime_tab_from_processes(
            root,
            "account-001",
            "https://example.com",
            lines,
            |_| {
                Ok(vec![CdpTargetRaw {
                    id: Some("worker-1".to_string()),
                    r#type: Some("service_worker".to_string()),
                    url: Some("chrome-extension://worker".to_string()),
                    title: Some("Worker".to_string()),
                    web_socket_debugger_url: None,
                }])
            },
            |_, _| Ok(()),
            1000,
        )
        .unwrap_err();

        assert_eq!(error, "未找到可导航的 page 标签页");
    }

    #[test]
    fn navigate_runtime_tab_from_processes_skips_page_tabs_without_websocket() {
        let root = Path::new("/Users/a0000/MultiChromeProfiles");
        let lines = [
            "  1201 /Applications/Google Chrome.app/Contents/MacOS/Google Chrome --user-data-dir=/Users/a0000/MultiChromeProfiles/profiles/account-001 --remote-debugging-port=19222 --remote-debugging-address=127.0.0.1 --no-first-run",
        ];
        let mut navigated = None;

        let result = navigate_runtime_tab_from_processes(
            root,
            "account-001",
            "https://example.com",
            lines,
            |_| {
                Ok(vec![
                    CdpTargetRaw {
                        id: Some("page-1".to_string()),
                        r#type: Some("page".to_string()),
                        url: Some("chrome://newtab/".to_string()),
                        title: Some("New Tab".to_string()),
                        web_socket_debugger_url: None,
                    },
                    CdpTargetRaw {
                        id: Some("page-2".to_string()),
                        r#type: Some("page".to_string()),
                        url: Some("https://example.org".to_string()),
                        title: Some("Example".to_string()),
                        web_socket_debugger_url: Some(
                            "ws://127.0.0.1:19222/devtools/page/page-2".to_string(),
                        ),
                    },
                ])
            },
            |web_socket_url, url| {
                navigated = Some((web_socket_url.to_string(), url.to_string()));
                Ok(())
            },
            1000,
        )
        .unwrap();

        assert_eq!(result.target_id, "page-2");
        assert_eq!(
            navigated,
            Some((
                "ws://127.0.0.1:19222/devtools/page/page-2".to_string(),
                "https://example.com".to_string()
            ))
        );
    }

    #[test]
    fn navigate_runtime_tab_from_processes_reports_when_all_page_tabs_lack_websocket() {
        let root = Path::new("/Users/a0000/MultiChromeProfiles");
        let lines = [
            "  1201 /Applications/Google Chrome.app/Contents/MacOS/Google Chrome --user-data-dir=/Users/a0000/MultiChromeProfiles/profiles/account-001 --remote-debugging-port=19222 --remote-debugging-address=127.0.0.1 --no-first-run",
        ];

        let error = navigate_runtime_tab_from_processes(
            root,
            "account-001",
            "https://example.com",
            lines,
            |_| {
                Ok(vec![
                    CdpTargetRaw {
                        id: Some("page-1".to_string()),
                        r#type: Some("page".to_string()),
                        url: Some("chrome://newtab/".to_string()),
                        title: Some("New Tab".to_string()),
                        web_socket_debugger_url: None,
                    },
                    CdpTargetRaw {
                        id: Some("page-2".to_string()),
                        r#type: Some("page".to_string()),
                        url: Some("https://example.org".to_string()),
                        title: Some("Example".to_string()),
                        web_socket_debugger_url: Some("   ".to_string()),
                    },
                ])
            },
            |_, _| Ok(()),
            1000,
        )
        .unwrap_err();

        assert_eq!(error, "找到 page 标签页，但都缺少 WebSocket 调试地址");
    }

    #[test]
    fn navigate_runtime_tab_from_processes_navigates_first_page_tab() {
        let root = Path::new("/Users/a0000/MultiChromeProfiles");
        let lines = [
            "  1201 /Applications/Google Chrome.app/Contents/MacOS/Google Chrome --user-data-dir=/Users/a0000/MultiChromeProfiles/profiles/account-001 --remote-debugging-port=19222 --remote-debugging-address=127.0.0.1 --no-first-run",
        ];
        let mut navigated = None;

        let result = navigate_runtime_tab_from_processes(
            root,
            "account-001",
            "https://example.com/dashboard",
            lines,
            |port| {
                assert_eq!(port, 19222);
                Ok(vec![CdpTargetRaw {
                    id: Some("page-1".to_string()),
                    r#type: Some("page".to_string()),
                    url: Some("chrome://newtab/".to_string()),
                    title: Some("New Tab".to_string()),
                    web_socket_debugger_url: Some(
                        "ws://127.0.0.1:19222/devtools/page/page-1".to_string(),
                    ),
                }])
            },
            |web_socket_url, url| {
                navigated = Some((web_socket_url.to_string(), url.to_string()));
                Ok(())
            },
            1000,
        )
        .unwrap();

        assert_eq!(
            navigated,
            Some((
                "ws://127.0.0.1:19222/devtools/page/page-1".to_string(),
                "https://example.com/dashboard".to_string()
            ))
        );
        assert_eq!(
            result,
            RuntimeTabNavigationResult {
                profile_id: "account-001".to_string(),
                target_id: "page-1".to_string(),
                url: "https://example.com/dashboard".to_string(),
                navigated_at: 1000,
            }
        );
    }

    #[test]
    fn navigate_runtime_tab_from_processes_does_not_leak_websocket_url() {
        let root = Path::new("/Users/a0000/MultiChromeProfiles");
        let lines = [
            "  1201 /Applications/Google Chrome.app/Contents/MacOS/Google Chrome --user-data-dir=/Users/a0000/MultiChromeProfiles/profiles/account-001 --remote-debugging-port=19222 --remote-debugging-address=127.0.0.1 --no-first-run",
        ];
        let secret_web_socket_url =
            "ws://127.0.0.1:19222/devtools/page/secret-page-target".to_string();

        let error = navigate_runtime_tab_from_processes(
            root,
            "account-001",
            "https://example.com",
            lines,
            |_| {
                Ok(vec![CdpTargetRaw {
                    id: Some("page-1".to_string()),
                    r#type: Some("page".to_string()),
                    url: Some("chrome://newtab/".to_string()),
                    title: Some("New Tab".to_string()),
                    web_socket_debugger_url: Some(secret_web_socket_url.clone()),
                }])
            },
            |web_socket_url, _| Err(format!("连接 {web_socket_url} 失败")),
            1000,
        )
        .unwrap_err();

        assert_eq!(error, "CDP 导航失败");
        assert!(!error.contains("ws://"));
        assert!(!error.contains("secret-page-target"));
    }

    #[test]
    fn runtime_tab_navigation_result_serializes_as_camel_case() {
        let value = serde_json::to_value(RuntimeTabNavigationResult {
            profile_id: "account-001".to_string(),
            target_id: "page-1".to_string(),
            url: "https://example.com".to_string(),
            navigated_at: 1000,
        })
        .unwrap();

        assert_eq!(
            value,
            serde_json::json!({
                "profileId": "account-001",
                "targetId": "page-1",
                "url": "https://example.com",
                "navigatedAt": 1000
            })
        );
    }

    #[test]
    fn send_cdp_page_navigate_sends_command_and_accepts_success_response() {
        let listener = TcpListener::bind((CDP_BIND_ADDRESS, 0)).unwrap();
        let port = listener.local_addr().unwrap().port();
        let handle = thread::spawn(move || {
            let (stream, _) = listener.accept().unwrap();
            let mut socket = tungstenite::accept(stream).unwrap();
            let request = socket.read().unwrap();
            let payload: serde_json::Value =
                serde_json::from_str(request.to_text().unwrap()).unwrap();
            assert_eq!(
                payload,
                serde_json::json!({
                    "id": 1,
                    "method": "Page.navigate",
                    "params": {
                        "url": "https://example.com/dashboard"
                    }
                })
            );
            socket
                .send(tungstenite::Message::Text(
                    serde_json::json!({
                        "id": 1,
                        "result": {
                            "frameId": "frame-1"
                        }
                    })
                    .to_string()
                    .into(),
                ))
                .unwrap();
            assert!(matches!(
                socket.read(),
                Err(tungstenite::Error::ConnectionClosed)
                    | Err(tungstenite::Error::Protocol(_))
                    | Ok(tungstenite::Message::Close(_))
            ));
        });

        send_cdp_page_navigate_with_timeout(
            &format!("ws://127.0.0.1:{port}/devtools/page/page-1"),
            "https://example.com/dashboard",
            Duration::from_millis(500),
        )
        .unwrap();
        handle.join().unwrap();
    }

    #[test]
    fn send_cdp_page_navigate_rejects_secure_websocket_url() {
        let error = send_cdp_page_navigate_with_timeout(
            "wss://127.0.0.1:9222/devtools/page/page-1",
            "https://example.com",
            Duration::from_millis(25),
        )
        .unwrap_err();

        assert_eq!(error, "CDP 连接失败");
    }

    #[test]
    fn send_cdp_page_navigate_rejects_non_loopback_websocket_url() {
        let error = send_cdp_page_navigate_with_timeout(
            "ws://192.168.1.1:9222/devtools/page/page-1",
            "https://example.com",
            Duration::from_millis(25),
        )
        .unwrap_err();

        assert_eq!(error, "CDP 连接失败");
    }

    #[test]
    fn send_cdp_page_navigate_reports_clean_protocol_error() {
        let listener = TcpListener::bind((CDP_BIND_ADDRESS, 0)).unwrap();
        let port = listener.local_addr().unwrap().port();
        let handle = thread::spawn(move || {
            let (stream, _) = listener.accept().unwrap();
            let mut socket = tungstenite::accept(stream).unwrap();
            let _ = socket.read().unwrap();
            socket
                .send(tungstenite::Message::Text(
                    serde_json::json!({
                        "id": 1,
                        "error": {
                            "code": -32000,
                            "message": "Cannot navigate target ws://127.0.0.1/secret"
                        }
                    })
                    .to_string()
                    .into(),
                ))
                .unwrap();
        });
        let web_socket_url = format!("ws://127.0.0.1:{port}/devtools/page/secret-target");

        let error = send_cdp_page_navigate_with_timeout(
            &web_socket_url,
            "https://example.com",
            Duration::from_millis(500),
        )
        .unwrap_err();
        handle.join().unwrap();

        assert_eq!(error, "CDP 导航失败");
        assert!(!error.contains("ws://"));
        assert!(!error.contains("secret-target"));
    }

    #[test]
    fn send_cdp_page_navigate_reports_navigation_error_text() {
        let listener = TcpListener::bind((CDP_BIND_ADDRESS, 0)).unwrap();
        let port = listener.local_addr().unwrap().port();
        let handle = thread::spawn(move || {
            let (stream, _) = listener.accept().unwrap();
            let mut socket = tungstenite::accept(stream).unwrap();
            let _ = socket.read().unwrap();
            socket
                .send(tungstenite::Message::Text(
                    serde_json::json!({
                        "id": 1,
                        "result": {
                            "frameId": "frame-1",
                            "errorText": "net::ERR_NAME_NOT_RESOLVED"
                        }
                    })
                    .to_string()
                    .into(),
                ))
                .unwrap();
        });

        let error = send_cdp_page_navigate_with_timeout(
            &format!("ws://127.0.0.1:{port}/devtools/page/page-1"),
            "https://does-not-resolve.invalid",
            Duration::from_millis(500),
        )
        .unwrap_err();
        handle.join().unwrap();

        assert_eq!(error, "CDP 导航失败");
    }

    #[test]
    fn send_cdp_page_navigate_times_out_waiting_for_response() {
        let listener = TcpListener::bind((CDP_BIND_ADDRESS, 0)).unwrap();
        let port = listener.local_addr().unwrap().port();
        let handle = thread::spawn(move || {
            let (stream, _) = listener.accept().unwrap();
            let mut socket = tungstenite::accept(stream).unwrap();
            let _ = socket.read().unwrap();
            thread::sleep(Duration::from_millis(100));
        });

        let error = send_cdp_page_navigate_with_timeout(
            &format!("ws://127.0.0.1:{port}/devtools/page/page-1"),
            "https://example.com",
            Duration::from_millis(25),
        )
        .unwrap_err();
        handle.join().unwrap();

        assert_eq!(error, "CDP 导航超时");
    }

    #[test]
    fn send_cdp_page_navigate_enforces_total_timeout_during_slow_handshake() {
        let listener = TcpListener::bind((CDP_BIND_ADDRESS, 0)).unwrap();
        let port = listener.local_addr().unwrap().port();
        let handle = thread::spawn(move || {
            let (stream, _) = listener.accept().unwrap();
            let slow_stream = SlowHandshakeStream {
                inner: stream,
                chunk_size: 16,
                delay: Duration::from_millis(15),
            };
            if let Ok(mut socket) = tungstenite::accept(slow_stream) {
                let _ = socket.read();
            }
        });
        let timeout = Duration::from_millis(30);
        let started_at = Instant::now();

        let error = send_cdp_page_navigate_with_timeout(
            &format!("ws://127.0.0.1:{port}/devtools/page/page-1"),
            "https://example.com",
            timeout,
        )
        .unwrap_err();
        let elapsed = started_at.elapsed();
        handle.join().unwrap();

        assert_eq!(error, "CDP 导航超时");
        assert!(
            elapsed < Duration::from_millis(100),
            "慢握手超过总 timeout 后才返回：{elapsed:?}"
        );
    }

    #[test]
    fn send_cdp_page_navigate_enforces_total_timeout_during_slow_response() {
        let listener = TcpListener::bind((CDP_BIND_ADDRESS, 0)).unwrap();
        let port = listener.local_addr().unwrap().port();
        let handle = thread::spawn(move || {
            let (stream, _) = listener.accept().unwrap();
            let slow_stream = SlowWebSocketResponseStream {
                inner: stream,
                handshake_written: false,
                chunk_size: 4,
                delay: Duration::from_millis(10),
            };
            if let Ok(mut socket) = tungstenite::accept(slow_stream) {
                let _ = socket.read();
                let _ = socket.send(tungstenite::Message::Text(
                    serde_json::json!({
                        "id": 1,
                        "result": {
                            "frameId": "frame-1"
                        }
                    })
                    .to_string()
                    .into(),
                ));
            }
        });
        let timeout = Duration::from_millis(30);
        let started_at = Instant::now();

        let error = send_cdp_page_navigate_with_timeout(
            &format!("ws://127.0.0.1:{port}/devtools/page/page-1"),
            "https://example.com",
            timeout,
        )
        .unwrap_err();
        let elapsed = started_at.elapsed();
        handle.join().unwrap();

        assert_eq!(error, "CDP 导航超时");
        assert!(
            elapsed < Duration::from_millis(100),
            "慢响应超过总 timeout 后才返回：{elapsed:?}"
        );
    }

    #[test]
    fn runtime_tab_snapshot_serializes_as_camel_case() {
        let value = serde_json::to_value(TabSnapshot {
            target_id: "page-1".to_string(),
            r#type: "page".to_string(),
            url: "chrome://newtab/".to_string(),
            title: "New Tab".to_string(),
            web_socket_debugger_url: None,
            checked_at: 1000,
        })
        .unwrap();

        assert_eq!(
            value,
            serde_json::json!({
                "targetId": "page-1",
                "type": "page",
                "url": "chrome://newtab/",
                "title": "New Tab",
                "webSocketDebuggerUrl": null,
                "checkedAt": 1000
            })
        );
    }

    #[test]
    fn tab_snapshot_from_cdp_target_skips_blank_target_id() {
        let tab = tab_snapshot_from_cdp_target(
            CdpTargetRaw {
                id: Some("   ".to_string()),
                r#type: Some("page".to_string()),
                url: Some("chrome://newtab/".to_string()),
                title: Some("New Tab".to_string()),
                web_socket_debugger_url: Some("ws://127.0.0.1/devtools/page/page-1".to_string()),
            },
            1000,
        );

        assert_eq!(tab, None);
    }

    #[test]
    fn tab_snapshot_from_cdp_target_omits_blank_websocket_url() {
        let tab = tab_snapshot_from_cdp_target(
            CdpTargetRaw {
                id: Some("page-1".to_string()),
                r#type: Some("page".to_string()),
                url: None,
                title: None,
                web_socket_debugger_url: Some("   ".to_string()),
            },
            1000,
        )
        .unwrap();

        assert_eq!(tab.url, "");
        assert_eq!(tab.title, "");
        assert_eq!(tab.web_socket_debugger_url, None);
    }

    #[test]
    fn fetch_cdp_tabs_sends_host_header_with_port() {
        let (port, handle, request_rx) = serve_cdp_response_and_capture_request(
            "HTTP/1.1 200 OK\r\nContent-Length: 2\r\nConnection: close\r\n\r\n[]".to_string(),
        );

        let targets = fetch_cdp_tabs(port).unwrap();
        let request = request_rx
            .recv_timeout(Duration::from_secs(1))
            .expect("capture CDP request");
        handle.join().unwrap();

        assert!(targets.is_empty());
        let host_lines = request
            .lines()
            .filter(|line| line.to_ascii_lowercase().starts_with("host:"))
            .collect::<Vec<_>>();
        assert_eq!(
            host_lines,
            vec![format!("Host: 127.0.0.1:{port}")],
            "CDP /json/list request should include exactly one dynamic Host header, got: {request:?}"
        );
    }

    #[test]
    fn fetch_cdp_tabs_reads_json_list_response() {
        let body = r#"[{"id":"page-1","type":"page","url":"chrome://newtab/","title":"New Tab","webSocketDebuggerUrl":"ws://127.0.0.1/devtools/page/page-1"}]"#;
        let (port, handle) = serve_cdp_response(format!(
            "HTTP/1.1 200 OK\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}",
            body.len(),
            body
        ));

        let targets = fetch_cdp_tabs(port).unwrap();
        handle.join().unwrap();

        assert_eq!(targets.len(), 1);
        assert_eq!(targets[0].id.as_deref(), Some("page-1"));
        assert_eq!(targets[0].r#type.as_deref(), Some("page"));
        assert_eq!(
            targets[0].web_socket_debugger_url.as_deref(),
            Some("ws://127.0.0.1/devtools/page/page-1")
        );
    }

    #[test]
    fn fetch_cdp_tabs_reads_response_without_content_length() {
        let (port, handle) =
            serve_cdp_response("HTTP/1.1 200 OK\r\nConnection: close\r\n\r\n[]".to_string());

        let targets = fetch_cdp_tabs(port).unwrap();
        handle.join().unwrap();

        assert_eq!(targets.len(), 0);
    }

    #[test]
    fn fetch_cdp_tabs_reports_connection_refused() {
        let listener = TcpListener::bind((CDP_BIND_ADDRESS, 0)).unwrap();
        let port = listener.local_addr().unwrap().port();
        drop(listener);

        assert_eq!(fetch_cdp_tabs(port).unwrap_err(), "CDP 连接失败");
    }

    #[test]
    fn fetch_cdp_tabs_rejects_non_ok_status() {
        let (port, handle) = serve_cdp_response(
            "HTTP/1.1 404 Not Found\r\nContent-Length: 2\r\nConnection: close\r\n\r\n[]"
                .to_string(),
        );

        let error = fetch_cdp_tabs(port).unwrap_err();
        handle.join().unwrap();

        assert_eq!(error, "CDP 连接失败");
    }

    #[test]
    fn fetch_cdp_tabs_rejects_chunked_response() {
        let (port, handle) = serve_cdp_response(
            "HTTP/1.1 200 OK\r\nTransfer-Encoding: chunked\r\nConnection: close\r\n\r\n2\r\n[]\r\n0\r\n\r\n"
                .to_string(),
        );

        let error = fetch_cdp_tabs(port).unwrap_err();
        handle.join().unwrap();

        assert_eq!(error, "CDP 连接失败");
    }

    #[test]
    fn fetch_cdp_tabs_rejects_invalid_json() {
        let body = "<html>not json</html>";
        let (port, handle) = serve_cdp_response(format!(
            "HTTP/1.1 200 OK\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}",
            body.len(),
            body
        ));

        let error = fetch_cdp_tabs(port).unwrap_err();
        handle.join().unwrap();

        assert_eq!(error, "CDP 连接失败");
    }

    #[test]
    fn fetch_cdp_tabs_rejects_oversized_content_length() {
        let (port, handle) = serve_cdp_response(format!(
            "HTTP/1.1 200 OK\r\nContent-Length: {}\r\nConnection: close\r\n\r\n",
            CDP_LIST_MAX_BODY_BYTES + 1
        ));

        let error = fetch_cdp_tabs(port).unwrap_err();
        handle.join().unwrap();

        assert_eq!(error, "CDP 连接失败");
    }

    #[test]
    fn fetch_cdp_tabs_rejects_invalid_content_length() {
        let (port, handle) = serve_cdp_response(
            "HTTP/1.1 200 OK\r\nContent-Length: nope\r\nConnection: close\r\n\r\n[]".to_string(),
        );

        let error = fetch_cdp_tabs(port).unwrap_err();
        handle.join().unwrap();

        assert_eq!(error, "CDP 连接失败");
    }

    fn serve_cdp_response(response: String) -> (u16, thread::JoinHandle<()>) {
        let (port, handle, _) = serve_cdp_response_and_capture_request(response);
        (port, handle)
    }

    fn serve_cdp_response_and_capture_request(
        response: String,
    ) -> (
        u16,
        thread::JoinHandle<()>,
        std::sync::mpsc::Receiver<String>,
    ) {
        let listener = TcpListener::bind((CDP_BIND_ADDRESS, 0)).unwrap();
        let port = listener.local_addr().unwrap().port();
        let (request_tx, request_rx) = std::sync::mpsc::channel();
        let handle = thread::spawn(move || {
            let (mut stream, _) = listener.accept().unwrap();
            stream
                .set_read_timeout(Some(Duration::from_millis(100)))
                .unwrap();
            let mut request = Vec::new();
            let mut chunk = [0_u8; 256];
            while request.len() < 8192 && !request.windows(4).any(|window| window == b"\r\n\r\n") {
                match stream.read(&mut chunk) {
                    Ok(0) => break,
                    Ok(byte_count) => request.extend_from_slice(&chunk[..byte_count]),
                    Err(error)
                        if matches!(
                            error.kind(),
                            std::io::ErrorKind::WouldBlock | std::io::ErrorKind::TimedOut
                        ) =>
                    {
                        break;
                    }
                    Err(_) => break,
                }
            }
            let request = String::from_utf8_lossy(&request).to_string();
            let _ = request_tx.send(request);
            stream.write_all(response.as_bytes()).unwrap();
        });

        (port, handle, request_rx)
    }
}
