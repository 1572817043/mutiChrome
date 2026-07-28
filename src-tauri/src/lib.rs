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
use serde::{Deserialize, Serialize};
use std::collections::{BTreeMap, BTreeSet};
use std::io::{Read, Write};
use std::net::{SocketAddr, TcpListener, TcpStream};
use std::path::{Path, PathBuf};
use std::process::Command;
use std::sync::{Mutex, OnceLock};
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

const CDP_BIND_ADDRESS: &str = "127.0.0.1";
const CDP_PORT_START: u16 = 19222;
const CDP_PORT_END: u16 = 19321;
const CDP_PROBE_TIMEOUT_MS: u64 = 250;
const CDP_SNAPSHOT_PROBE_BUDGET_MS: u64 = 750;
const CDP_LIST_TIMEOUT_MS: u64 = 500;
const CDP_LIST_MAX_BODY_BYTES: usize = 1024 * 1024;
const CDP_NAVIGATE_TIMEOUT_MS: u64 = 1000;

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

#[derive(Debug, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
struct TabSnapshot {
    target_id: String,
    r#type: String,
    url: String,
    title: String,
    web_socket_debugger_url: Option<String>,
    checked_at: u64,
}

#[derive(Debug, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
struct RuntimeTabNavigationResult {
    profile_id: String,
    target_id: String,
    url: String,
    navigated_at: u64,
}

#[derive(Debug, Deserialize)]
struct CdpTargetRaw {
    #[serde(default)]
    id: Option<String>,
    #[serde(default, rename = "type")]
    r#type: Option<String>,
    #[serde(default)]
    url: Option<String>,
    #[serde(default)]
    title: Option<String>,
    #[serde(default, rename = "webSocketDebuggerUrl")]
    web_socket_debugger_url: Option<String>,
}

#[derive(Debug, Eq, PartialEq)]
struct LaunchCommand {
    program: PathBuf,
    args: Vec<String>,
}

#[cfg(target_os = "macos")]
mod macos_accessibility {
    use super::ChromeWindowInfo;
    use core_foundation::base::{CFRelease, CFTypeRef, TCFType};
    use core_foundation::boolean::{CFBoolean, CFBooleanRef};
    use core_foundation::string::{CFString, CFStringRef};
    use libc::{c_void, pid_t};
    use std::os::raw::{c_int, c_long};
    use std::ptr;

    type AXError = c_int;
    type AXUIElementRef = *const c_void;
    type AXValueRef = *const c_void;
    type CFArrayRef = *const c_void;
    type Boolean = u8;

    const AX_ERROR_SUCCESS: AXError = 0;
    const AX_VALUE_CGPOINT_TYPE: c_int = 1;
    const AX_VALUE_CGSIZE_TYPE: c_int = 2;

    #[repr(C)]
    #[derive(Debug, Default, Copy, Clone)]
    struct CGPoint {
        x: f64,
        y: f64,
    }

    #[repr(C)]
    #[derive(Debug, Default, Copy, Clone)]
    struct CGSize {
        width: f64,
        height: f64,
    }

    #[link(name = "ApplicationServices", kind = "framework")]
    extern "C" {
        fn AXUIElementCreateApplication(pid: pid_t) -> AXUIElementRef;
        fn AXUIElementCopyAttributeValue(
            element: AXUIElementRef,
            attribute: CFStringRef,
            value: *mut CFTypeRef,
        ) -> AXError;
        fn AXUIElementSetAttributeValue(
            element: AXUIElementRef,
            attribute: CFStringRef,
            value: CFTypeRef,
        ) -> AXError;
        fn AXUIElementPerformAction(element: AXUIElementRef, action: CFStringRef) -> AXError;
        fn AXValueCreate(value_type: c_int, value_ptr: *const c_void) -> AXValueRef;
        fn AXValueGetValue(value: AXValueRef, value_type: c_int, value_ptr: *mut c_void)
            -> Boolean;
    }

    #[link(name = "CoreFoundation", kind = "framework")]
    extern "C" {
        fn CFArrayGetCount(the_array: CFArrayRef) -> c_long;
        fn CFArrayGetValueAtIndex(the_array: CFArrayRef, index: c_long) -> *const c_void;
    }

    struct OwnedCfType(CFTypeRef);

    impl OwnedCfType {
        fn new(value: CFTypeRef) -> Result<Self, String> {
            if value.is_null() {
                Err("macOS Accessibility 返回空对象".to_string())
            } else {
                Ok(Self(value))
            }
        }

        fn as_type_ref(&self) -> CFTypeRef {
            self.0
        }

        fn into_raw(mut self) -> CFTypeRef {
            let value = self.0;
            self.0 = ptr::null();
            value
        }
    }

    impl Drop for OwnedCfType {
        fn drop(&mut self) {
            if !self.0.is_null() {
                unsafe {
                    CFRelease(self.0);
                }
            }
        }
    }

    pub fn focus_window(pid: u32) -> Result<(), String> {
        with_first_window(pid, "切换窗口", |app, window| {
            set_bool_attribute(app, "AXFrontmost", true).ok();
            set_bool_attribute(window, "AXMain", true).ok();
            set_bool_attribute(window, "AXFocused", true).ok();
            perform_action(window, "AXRaise", "切换窗口")
        })
    }

    pub fn list_windows(pid: u32) -> Result<Vec<ChromeWindowInfo>, String> {
        let app = create_app_element(pid)?;
        let windows = copy_attribute(app.as_type_ref(), "AXWindows", "检查窗口")?;
        let windows_ref = windows.as_type_ref() as CFArrayRef;
        let count = unsafe { CFArrayGetCount(windows_ref) };
        let mut result = Vec::new();

        for index in 0..count {
            let window = unsafe { CFArrayGetValueAtIndex(windows_ref, index) } as AXUIElementRef;
            if window.is_null() {
                continue;
            }

            let title = string_attribute(window, "AXTitle").unwrap_or_default();
            if title.trim().is_empty() {
                continue;
            }

            let point = point_attribute(window, "AXPosition", "检查窗口")?;
            let size = size_attribute(window, "AXSize", "检查窗口")?;
            let minimized = bool_attribute(window, "AXMinimized").unwrap_or(false);
            result.push(ChromeWindowInfo {
                index: (index + 1) as u32,
                title: title.trim().to_string(),
                x: point.x.round() as i32,
                y: point.y.round() as i32,
                width: size.width.round() as i32,
                height: size.height.round() as i32,
                minimized,
            });
        }

        Ok(result)
    }

    pub fn set_window_bounds(
        pid: u32,
        x: i32,
        y: i32,
        width: i32,
        height: i32,
    ) -> Result<(), String> {
        with_first_window(pid, "平铺窗口", |_, window| {
            set_point_attribute(
                window,
                "AXPosition",
                CGPoint {
                    x: f64::from(x),
                    y: f64::from(y),
                },
                "平铺窗口",
            )?;
            set_size_attribute(
                window,
                "AXSize",
                CGSize {
                    width: f64::from(width),
                    height: f64::from(height),
                },
                "平铺窗口",
            )
        })
    }

    fn with_first_window<T>(
        pid: u32,
        operation: &str,
        action: impl FnOnce(AXUIElementRef, AXUIElementRef) -> Result<T, String>,
    ) -> Result<T, String> {
        let app = create_app_element(pid)?;
        let windows = copy_attribute(app.as_type_ref(), "AXWindows", operation)?;
        let windows_ref = windows.as_type_ref() as CFArrayRef;
        let count = unsafe { CFArrayGetCount(windows_ref) };
        if count <= 0 {
            return Err(format!("{operation}失败：目标 Chrome 没有可操作窗口"));
        }

        let window = unsafe { CFArrayGetValueAtIndex(windows_ref, 0) } as AXUIElementRef;
        if window.is_null() {
            return Err(format!("{operation}失败：目标 Chrome 窗口不可用"));
        }

        action(app.as_type_ref(), window)
    }

    fn create_app_element(pid: u32) -> Result<OwnedCfType, String> {
        let element = unsafe { AXUIElementCreateApplication(pid as pid_t) };
        OwnedCfType::new(element as CFTypeRef)
    }

    fn copy_attribute(
        element: AXUIElementRef,
        attribute: &str,
        operation: &str,
    ) -> Result<OwnedCfType, String> {
        let attribute = CFString::new(attribute);
        let mut value: CFTypeRef = ptr::null();
        let error = unsafe {
            AXUIElementCopyAttributeValue(element, attribute.as_concrete_TypeRef(), &mut value)
        };
        if error != AX_ERROR_SUCCESS {
            return Err(ax_error_message(operation, error));
        }

        OwnedCfType::new(value)
    }

    fn string_attribute(element: AXUIElementRef, attribute: &str) -> Result<String, String> {
        let value = copy_attribute(element, attribute, "检查窗口")?;
        let text = unsafe { CFString::wrap_under_create_rule(value.into_raw() as CFStringRef) };
        Ok(text.to_string())
    }

    fn bool_attribute(element: AXUIElementRef, attribute: &str) -> Result<bool, String> {
        let value = copy_attribute(element, attribute, "检查窗口")?;
        let bool_ref = value.as_type_ref() as CFBooleanRef;
        let bool_value = unsafe { CFBoolean::wrap_under_get_rule(bool_ref) };
        Ok(bool::from(bool_value))
    }

    fn point_attribute(
        element: AXUIElementRef,
        attribute: &str,
        operation: &str,
    ) -> Result<CGPoint, String> {
        let value = copy_attribute(element, attribute, operation)?;
        let mut point = CGPoint::default();
        let ok = unsafe {
            AXValueGetValue(
                value.as_type_ref() as AXValueRef,
                AX_VALUE_CGPOINT_TYPE,
                &mut point as *mut CGPoint as *mut c_void,
            )
        };
        if ok == 0 {
            Err(format!("{operation}失败：无法读取窗口位置"))
        } else {
            Ok(point)
        }
    }

    fn size_attribute(
        element: AXUIElementRef,
        attribute: &str,
        operation: &str,
    ) -> Result<CGSize, String> {
        let value = copy_attribute(element, attribute, operation)?;
        let mut size = CGSize::default();
        let ok = unsafe {
            AXValueGetValue(
                value.as_type_ref() as AXValueRef,
                AX_VALUE_CGSIZE_TYPE,
                &mut size as *mut CGSize as *mut c_void,
            )
        };
        if ok == 0 {
            Err(format!("{operation}失败：无法读取窗口大小"))
        } else {
            Ok(size)
        }
    }

    fn set_bool_attribute(
        element: AXUIElementRef,
        attribute: &str,
        value: bool,
    ) -> Result<(), String> {
        let attribute = CFString::new(attribute);
        let value = CFBoolean::from(value);
        let error = unsafe {
            AXUIElementSetAttributeValue(
                element,
                attribute.as_concrete_TypeRef(),
                value.as_CFTypeRef(),
            )
        };
        if error == AX_ERROR_SUCCESS {
            Ok(())
        } else {
            Err(ax_error_message("切换窗口", error))
        }
    }

    fn set_point_attribute(
        element: AXUIElementRef,
        attribute: &str,
        point: CGPoint,
        operation: &str,
    ) -> Result<(), String> {
        let attribute = CFString::new(attribute);
        let value = unsafe {
            AXValueCreate(
                AX_VALUE_CGPOINT_TYPE,
                &point as *const CGPoint as *const c_void,
            )
        };
        let value = OwnedCfType::new(value as CFTypeRef)?;
        let error = unsafe {
            AXUIElementSetAttributeValue(
                element,
                attribute.as_concrete_TypeRef(),
                value.as_type_ref(),
            )
        };
        if error == AX_ERROR_SUCCESS {
            Ok(())
        } else {
            Err(ax_error_message(operation, error))
        }
    }

    fn set_size_attribute(
        element: AXUIElementRef,
        attribute: &str,
        size: CGSize,
        operation: &str,
    ) -> Result<(), String> {
        let attribute = CFString::new(attribute);
        let value = unsafe {
            AXValueCreate(
                AX_VALUE_CGSIZE_TYPE,
                &size as *const CGSize as *const c_void,
            )
        };
        let value = OwnedCfType::new(value as CFTypeRef)?;
        let error = unsafe {
            AXUIElementSetAttributeValue(
                element,
                attribute.as_concrete_TypeRef(),
                value.as_type_ref(),
            )
        };
        if error == AX_ERROR_SUCCESS {
            Ok(())
        } else {
            Err(ax_error_message(operation, error))
        }
    }

    fn perform_action(
        element: AXUIElementRef,
        action: &str,
        operation: &str,
    ) -> Result<(), String> {
        let action = CFString::new(action);
        let error = unsafe { AXUIElementPerformAction(element, action.as_concrete_TypeRef()) };
        if error == AX_ERROR_SUCCESS {
            Ok(())
        } else {
            Err(ax_error_message(operation, error))
        }
    }

    fn ax_error_message(operation: &str, error: AXError) -> String {
        match error {
            -25211 => format!(
                "{operation}失败：MultiChrome 没有辅助功能权限，请在系统设置 > 隐私与安全性 > 辅助功能 中允许 MultiChrome 控制电脑"
            ),
            -25204 => format!("{operation}失败：macOS 暂时无法完成窗口操作（AX error {error}）"),
            -25205 => format!("{operation}失败：目标窗口不支持该操作（AX error {error}）"),
            _ => format!("{operation}失败：macOS Accessibility 返回错误 {error}"),
        }
    }
}

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
        probe_cdp_version,
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
    runtime_tabs_from_processes(
        &PathBuf::from(root_path),
        &profile_id,
        stdout.lines(),
        fetch_cdp_tabs,
        current_time_millis(),
    )
}

#[tauri::command]
fn navigate_runtime_tab(
    root_path: String,
    profile_id: String,
    url: String,
) -> Result<RuntimeTabNavigationResult, String> {
    let url = validate_runtime_navigation_url(&url)?;
    let output = Command::new("ps")
        .args(["-axo", "pid=,command="])
        .output()
        .map_err(|_| "Browser Runtime 不可用".to_string())?;

    if !output.status.success() {
        return Err("Browser Runtime 不可用".to_string());
    }

    let stdout = String::from_utf8_lossy(&output.stdout);
    navigate_runtime_tab_from_processes(
        &PathBuf::from(root_path),
        &profile_id,
        &url,
        stdout.lines(),
        fetch_cdp_tabs,
        send_cdp_page_navigate,
        current_time_millis(),
    )
}

#[tauri::command]
fn focus_profile_window(root_path: String, profile_id: String) -> Result<(), String> {
    let process = running_profile_process_for(&PathBuf::from(root_path), &profile_id)?;
    focus_chrome_process(process.pid)
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
    let Some(process) = running_profile_processes_from_processes(root_path, stdout.lines())
        .into_iter()
        .find(|process| process.profile_id == profile_id)
    else {
        return Err("没有找到这个账号的运行窗口，请先打开账号".to_string());
    };

    Ok(process)
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
                    runtime_error: Some(short_cdp_probe_error(&error)),
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

fn runtime_tabs_from_processes<'a, I, F>(
    root_path: &Path,
    profile_id: &str,
    process_lines: I,
    mut fetch_tabs: F,
    checked_at: u64,
) -> Result<Vec<TabSnapshot>, String>
where
    I: IntoIterator<Item = &'a str>,
    F: FnMut(u16) -> Result<Vec<CdpTargetRaw>, String>,
{
    let Some(process) = running_profile_processes_from_processes(root_path, process_lines)
        .into_iter()
        .find(|process| process.profile_id == profile_id)
    else {
        return Err("该账号未运行".to_string());
    };

    let Some(port) = process.debug_port else {
        return Err("该账号需要关闭后重新打开以启用 Browser Runtime".to_string());
    };

    let targets = fetch_tabs(port).map_err(|_| "Browser Runtime 不可用".to_string())?;
    Ok(targets
        .into_iter()
        .filter_map(|target| tab_snapshot_from_cdp_target(target, checked_at))
        .collect())
}

fn validate_runtime_navigation_url(url: &str) -> Result<String, String> {
    let url = url.trim();
    let parsed =
        url::Url::parse(url).map_err(|_| "请输入有效的 http:// 或 https:// URL".to_string())?;
    if !matches!(parsed.scheme(), "http" | "https") || parsed.host().is_none() {
        return Err("请输入有效的 http:// 或 https:// URL".to_string());
    }

    Ok(url.to_string())
}

fn navigate_runtime_tab_from_processes<'a, I, F, N>(
    root_path: &Path,
    profile_id: &str,
    url: &str,
    process_lines: I,
    mut fetch_tabs: F,
    mut navigate_page: N,
    navigated_at: u64,
) -> Result<RuntimeTabNavigationResult, String>
where
    I: IntoIterator<Item = &'a str>,
    F: FnMut(u16) -> Result<Vec<CdpTargetRaw>, String>,
    N: FnMut(&str, &str) -> Result<(), String>,
{
    let url = validate_runtime_navigation_url(url)?;
    let Some(process) = running_profile_processes_from_processes(root_path, process_lines)
        .into_iter()
        .find(|process| process.profile_id == profile_id)
    else {
        return Err("该账号未运行".to_string());
    };
    let Some(port) = process.debug_port else {
        return Err("该账号需要关闭后重新打开以启用 Browser Runtime".to_string());
    };

    let targets = fetch_tabs(port).map_err(|_| "Browser Runtime 不可用".to_string())?;
    let mut found_page = false;
    let target = targets
        .into_iter()
        .find(|target| {
            if target.r#type.as_deref() != Some("page") {
                return false;
            }
            found_page = true;
            target
                .web_socket_debugger_url
                .as_deref()
                .is_some_and(|value| !value.trim().is_empty())
        })
        .ok_or_else(|| {
            if found_page {
                "找到 page 标签页，但都缺少 WebSocket 调试地址".to_string()
            } else {
                "未找到可导航的 page 标签页".to_string()
            }
        })?;
    let target_id = target
        .id
        .filter(|value| !value.trim().is_empty())
        .ok_or_else(|| "第一个 page 标签页缺少 targetId".to_string())?;
    let web_socket_debugger_url = target
        .web_socket_debugger_url
        .ok_or_else(|| "找到 page 标签页，但都缺少 WebSocket 调试地址".to_string())?;

    navigate_page(&web_socket_debugger_url, &url).map_err(|_| "CDP 导航失败".to_string())?;

    Ok(RuntimeTabNavigationResult {
        profile_id: profile_id.to_string(),
        target_id,
        url,
        navigated_at,
    })
}

fn send_cdp_page_navigate(web_socket_url: &str, url: &str) -> Result<(), String> {
    send_cdp_page_navigate_with_timeout(
        web_socket_url,
        url,
        Duration::from_millis(CDP_NAVIGATE_TIMEOUT_MS),
    )
}

fn send_cdp_page_navigate_with_timeout(
    web_socket_url: &str,
    url: &str,
    timeout: Duration,
) -> Result<(), String> {
    let parsed = url::Url::parse(web_socket_url).map_err(|_| "CDP 连接失败".to_string())?;
    if parsed.scheme() != "ws" {
        return Err("CDP 连接失败".to_string());
    }
    let port = parsed
        .port_or_known_default()
        .ok_or_else(|| "CDP 连接失败".to_string())?;
    let address = match parsed.host_str() {
        Some("127.0.0.1") | Some("localhost") => SocketAddr::from(([127, 0, 0, 1], port)),
        Some("::1") => SocketAddr::from(([0, 0, 0, 0, 0, 0, 0, 1], port)),
        _ => return Err("CDP 连接失败".to_string()),
    };

    let started_at = Instant::now();
    let stream = TcpStream::connect_timeout(&address, timeout)
        .map_err(|error| clean_cdp_navigation_io_error(&error, started_at, timeout, true))?;
    stream
        .set_nonblocking(true)
        .map_err(|_| "CDP 连接失败".to_string())?;
    let mut socket = complete_cdp_websocket_handshake(web_socket_url, stream, started_at, timeout)?;
    if let Err(error) = write_cdp_page_navigate_command(&mut socket, url, started_at, timeout) {
        best_effort_close_cdp_websocket(&mut socket, started_at, timeout);
        return Err(error);
    }

    let result = loop {
        if let Err(error) = remaining_cdp_navigation_timeout(started_at, timeout) {
            break Err(error);
        }
        let message = match socket.read() {
            Ok(message) => message,
            Err(error) if is_cdp_would_block(&error) => {
                if let Err(error) = wait_for_cdp_io_retry(started_at, timeout) {
                    break Err(error);
                }
                continue;
            }
            Err(tungstenite::Error::Io(error)) => {
                break Err(clean_cdp_navigation_io_error(
                    &error, started_at, timeout, false,
                ));
            }
            Err(_) => break Err("CDP 导航失败".to_string()),
        };
        let tungstenite::Message::Text(text) = message else {
            continue;
        };
        let payload: serde_json::Value = match serde_json::from_str(text.as_str()) {
            Ok(payload) => payload,
            Err(_) => break Err("CDP 导航失败".to_string()),
        };
        if payload.get("id").and_then(serde_json::Value::as_u64) != Some(1) {
            continue;
        }
        if payload.get("error").is_some() {
            break Err("CDP 导航失败".to_string());
        }
        if let Some(result) = payload.get("result") {
            if result
                .get("errorText")
                .and_then(serde_json::Value::as_str)
                .is_some_and(|value| !value.is_empty())
            {
                break Err("CDP 导航失败".to_string());
            }
            break Ok(());
        }
        break Err("CDP 导航失败".to_string());
    };

    best_effort_close_cdp_websocket(&mut socket, started_at, timeout);
    result
}

fn best_effort_close_cdp_websocket(
    socket: &mut tungstenite::WebSocket<TcpStream>,
    started_at: Instant,
    timeout: Duration,
) {
    if remaining_cdp_navigation_timeout(started_at, timeout).is_ok() {
        let _ = socket.close(None);
        let _ = socket.flush();
    }
}

fn write_cdp_page_navigate_command(
    socket: &mut tungstenite::WebSocket<TcpStream>,
    url: &str,
    started_at: Instant,
    timeout: Duration,
) -> Result<(), String> {
    remaining_cdp_navigation_timeout(started_at, timeout)?;
    let message = tungstenite::Message::Text(
        serde_json::json!({
            "id": 1,
            "method": "Page.navigate",
            "params": {
                "url": url
            }
        })
        .to_string()
        .into(),
    );
    match socket.write(message) {
        Ok(()) => {}
        Err(error) if is_cdp_would_block(&error) => {}
        Err(_) => return Err("CDP 导航失败".to_string()),
    }

    loop {
        remaining_cdp_navigation_timeout(started_at, timeout)?;
        match socket.flush() {
            Ok(()) => return Ok(()),
            Err(error) if is_cdp_would_block(&error) => {
                wait_for_cdp_io_retry(started_at, timeout)?;
            }
            Err(_) => return Err("CDP 导航失败".to_string()),
        }
    }
}

fn complete_cdp_websocket_handshake(
    web_socket_url: &str,
    stream: TcpStream,
    started_at: Instant,
    timeout: Duration,
) -> Result<tungstenite::WebSocket<TcpStream>, String> {
    let mut handshake = match tungstenite::client(web_socket_url, stream) {
        Ok((socket, _)) => {
            remaining_cdp_navigation_timeout(started_at, timeout)?;
            return Ok(socket);
        }
        Err(tungstenite::HandshakeError::Interrupted(handshake)) => handshake,
        Err(tungstenite::HandshakeError::Failure(error)) => {
            return Err(clean_cdp_handshake_error(error, started_at, timeout));
        }
    };

    loop {
        let remaining = remaining_cdp_navigation_timeout(started_at, timeout)?;
        std::thread::sleep(remaining.min(Duration::from_millis(1)));
        match handshake.handshake() {
            Ok((socket, _)) => {
                remaining_cdp_navigation_timeout(started_at, timeout)?;
                return Ok(socket);
            }
            Err(tungstenite::HandshakeError::Interrupted(next_handshake)) => {
                handshake = next_handshake;
            }
            Err(tungstenite::HandshakeError::Failure(error)) => {
                return Err(clean_cdp_handshake_error(error, started_at, timeout));
            }
        }
    }
}

fn wait_for_cdp_io_retry(started_at: Instant, timeout: Duration) -> Result<(), String> {
    let remaining = remaining_cdp_navigation_timeout(started_at, timeout)?;
    std::thread::sleep(remaining.min(Duration::from_millis(1)));
    Ok(())
}

fn is_cdp_would_block(error: &tungstenite::Error) -> bool {
    matches!(
        error,
        tungstenite::Error::Io(io_error)
            if io_error.kind() == std::io::ErrorKind::WouldBlock
    )
}

fn clean_cdp_handshake_error(
    error: tungstenite::Error,
    started_at: Instant,
    timeout: Duration,
) -> String {
    if started_at.elapsed() >= timeout
        || matches!(
            error,
            tungstenite::Error::Io(ref io_error)
                if matches!(
                    io_error.kind(),
                    std::io::ErrorKind::TimedOut | std::io::ErrorKind::WouldBlock
                )
        )
    {
        "CDP 导航超时".to_string()
    } else {
        "CDP 连接失败".to_string()
    }
}

fn remaining_cdp_navigation_timeout(
    started_at: Instant,
    timeout: Duration,
) -> Result<Duration, String> {
    timeout
        .checked_sub(started_at.elapsed())
        .filter(|duration| !duration.is_zero())
        .ok_or_else(|| "CDP 导航超时".to_string())
}

fn clean_cdp_navigation_io_error(
    error: &std::io::Error,
    started_at: Instant,
    timeout: Duration,
    connecting: bool,
) -> String {
    if matches!(
        error.kind(),
        std::io::ErrorKind::TimedOut | std::io::ErrorKind::WouldBlock
    ) || started_at.elapsed() >= timeout
    {
        return "CDP 导航超时".to_string();
    }
    if connecting {
        "CDP 连接失败".to_string()
    } else {
        "CDP 导航失败".to_string()
    }
}

fn tab_snapshot_from_cdp_target(target: CdpTargetRaw, checked_at: u64) -> Option<TabSnapshot> {
    if target.r#type.as_deref() != Some("page") {
        return None;
    }

    let target_id = target.id?.trim().to_string();
    if target_id.is_empty() {
        return None;
    }

    Some(TabSnapshot {
        target_id,
        r#type: "page".to_string(),
        url: target.url.unwrap_or_default(),
        title: target.title.unwrap_or_default(),
        web_socket_debugger_url: target
            .web_socket_debugger_url
            .filter(|value| !value.trim().is_empty()),
        checked_at,
    })
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

    if cdp_probe_elapsed_ms.saturating_add(CDP_PROBE_TIMEOUT_MS) > cdp_probe_budget_ms {
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

fn fetch_cdp_tabs(port: u16) -> Result<Vec<CdpTargetRaw>, String> {
    let timeout = Duration::from_millis(CDP_LIST_TIMEOUT_MS);
    let address = SocketAddr::from(([127, 0, 0, 1], port));
    let started_at = Instant::now();
    let mut stream = TcpStream::connect_timeout(&address, timeout)
        .map_err(|error| short_cdp_probe_error(&error.to_string()))?;
    let remaining_timeout = remaining_cdp_timeout(started_at, CDP_LIST_TIMEOUT_MS)?;
    stream
        .set_read_timeout(Some(remaining_timeout))
        .map_err(|_| "CDP 连接失败".to_string())?;
    stream
        .set_write_timeout(Some(remaining_timeout))
        .map_err(|_| "CDP 连接失败".to_string())?;
    stream
        .write_all(
            b"GET /json/list HTTP/1.1\r\nHost: 127.0.0.1\r\nAccept: application/json\r\nConnection: close\r\n\r\n",
        )
        .map_err(|error| short_cdp_probe_error(&error.to_string()))?;

    let body = read_cdp_list_response_body(&mut stream, started_at)?;
    serde_json::from_slice::<Vec<CdpTargetRaw>>(&body).map_err(|_| "CDP 连接失败".to_string())
}

fn probe_cdp_version(port: u16) -> Result<(), String> {
    let timeout = Duration::from_millis(CDP_PROBE_TIMEOUT_MS);
    let address = SocketAddr::from(([127, 0, 0, 1], port));
    let started_at = Instant::now();
    let mut stream = TcpStream::connect_timeout(&address, timeout)
        .map_err(|error| short_cdp_probe_error(&error.to_string()))?;
    let remaining_timeout = remaining_cdp_probe_timeout(started_at)?;
    stream
        .set_read_timeout(Some(remaining_timeout))
        .map_err(|_| "CDP 连接失败".to_string())?;
    stream
        .set_write_timeout(Some(remaining_timeout))
        .map_err(|_| "CDP 连接失败".to_string())?;
    stream
        .write_all(b"GET /json/version HTTP/1.1\r\nHost: 127.0.0.1\r\nConnection: close\r\n\r\n")
        .map_err(|error| short_cdp_probe_error(&error.to_string()))?;

    stream
        .set_read_timeout(Some(remaining_cdp_probe_timeout(started_at)?))
        .map_err(|_| "CDP 连接失败".to_string())?;
    let status_line = read_http_status_line(&mut stream)?;
    if status_line.starts_with("HTTP/1.1 200") || status_line.starts_with("HTTP/1.0 200") {
        Ok(())
    } else {
        Err("CDP 连接失败".to_string())
    }
}

fn remaining_cdp_probe_timeout(started_at: Instant) -> Result<Duration, String> {
    remaining_cdp_timeout(started_at, CDP_PROBE_TIMEOUT_MS)
}

fn remaining_cdp_timeout(started_at: Instant, timeout_ms: u64) -> Result<Duration, String> {
    Duration::from_millis(timeout_ms)
        .checked_sub(started_at.elapsed())
        .filter(|duration| !duration.is_zero())
        .ok_or_else(|| "CDP 探测超时".to_string())
}

fn read_cdp_list_response_body(
    stream: &mut TcpStream,
    started_at: Instant,
) -> Result<Vec<u8>, String> {
    let mut response = Vec::new();
    let mut buffer = [0_u8; 4096];
    let header_end = loop {
        stream
            .set_read_timeout(Some(remaining_cdp_timeout(
                started_at,
                CDP_LIST_TIMEOUT_MS,
            )?))
            .map_err(|_| "CDP 连接失败".to_string())?;
        let bytes_read = stream
            .read(&mut buffer)
            .map_err(|error| short_cdp_probe_error(&error.to_string()))?;
        if bytes_read == 0 {
            return Err("CDP 连接失败".to_string());
        }
        response.extend_from_slice(&buffer[..bytes_read]);
        if response.len() > CDP_LIST_MAX_BODY_BYTES {
            return Err("CDP 连接失败".to_string());
        }
        if let Some(index) = find_header_end(&response) {
            break index;
        }
    };

    let headers = String::from_utf8_lossy(&response[..header_end]);
    if !is_http_ok(&headers) || uses_chunked_transfer(&headers) {
        return Err("CDP 连接失败".to_string());
    }

    let content_length = cdp_content_length(&headers)?;
    if content_length.is_some_and(|length| length > CDP_LIST_MAX_BODY_BYTES) {
        return Err("CDP 连接失败".to_string());
    }

    let mut body = response[header_end + 4..].to_vec();
    if let Some(content_length) = content_length {
        while body.len() < content_length {
            stream
                .set_read_timeout(Some(remaining_cdp_timeout(
                    started_at,
                    CDP_LIST_TIMEOUT_MS,
                )?))
                .map_err(|_| "CDP 连接失败".to_string())?;
            let bytes_read = stream
                .read(&mut buffer)
                .map_err(|error| short_cdp_probe_error(&error.to_string()))?;
            if bytes_read == 0 {
                return Err("CDP 连接失败".to_string());
            }
            body.extend_from_slice(&buffer[..bytes_read]);
            if body.len() > CDP_LIST_MAX_BODY_BYTES {
                return Err("CDP 连接失败".to_string());
            }
        }
        body.truncate(content_length);
        return Ok(body);
    }

    loop {
        if body.len() > CDP_LIST_MAX_BODY_BYTES {
            return Err("CDP 连接失败".to_string());
        }
        stream
            .set_read_timeout(Some(remaining_cdp_timeout(
                started_at,
                CDP_LIST_TIMEOUT_MS,
            )?))
            .map_err(|_| "CDP 连接失败".to_string())?;
        let bytes_read = match stream.read(&mut buffer) {
            Ok(bytes_read) => bytes_read,
            Err(error) => return Err(short_cdp_probe_error(&error.to_string())),
        };
        if bytes_read == 0 {
            return Ok(body);
        }
        body.extend_from_slice(&buffer[..bytes_read]);
    }
}

fn find_header_end(response: &[u8]) -> Option<usize> {
    response.windows(4).position(|window| window == b"\r\n\r\n")
}

fn is_http_ok(headers: &str) -> bool {
    headers
        .lines()
        .next()
        .and_then(|line| line.split_whitespace().nth(1))
        == Some("200")
}

fn uses_chunked_transfer(headers: &str) -> bool {
    headers.lines().any(|line| {
        line.to_ascii_lowercase().starts_with("transfer-encoding:")
            && line.to_ascii_lowercase().contains("chunked")
    })
}

fn cdp_content_length(headers: &str) -> Result<Option<usize>, String> {
    let Some(line) = headers
        .lines()
        .find(|line| line.to_ascii_lowercase().starts_with("content-length:"))
    else {
        return Ok(None);
    };

    line.split_once(':')
        .and_then(|(_, value)| value.trim().parse::<usize>().ok())
        .map(Some)
        .ok_or_else(|| "CDP 连接失败".to_string())
}

fn read_http_status_line(stream: &mut TcpStream) -> Result<String, String> {
    let mut response = Vec::new();
    let mut buffer = [0_u8; 64];

    loop {
        let bytes_read = stream
            .read(&mut buffer)
            .map_err(|error| short_cdp_probe_error(&error.to_string()))?;
        if bytes_read == 0 {
            break;
        }
        response.extend_from_slice(&buffer[..bytes_read]);
        if response.windows(2).any(|window| window == b"\r\n") || response.len() >= 512 {
            break;
        }
    }

    let response_text = String::from_utf8_lossy(&response);
    Ok(response_text
        .split("\r\n")
        .next()
        .unwrap_or_default()
        .to_string())
}

fn short_cdp_probe_error(error: &str) -> String {
    let lower = error.to_lowercase();
    if lower.contains("timed out") || lower.contains("timeout") || lower.contains("超时") {
        "CDP 探测超时".to_string()
    } else {
        "CDP 连接失败".to_string()
    }
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
    use super::*;
    use std::io::{Read, Write};
    use std::net::TcpListener;
    use std::path::Path;
    use std::thread;

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
        let listener = TcpListener::bind((CDP_BIND_ADDRESS, 0)).unwrap();
        let port = listener.local_addr().unwrap().port();
        let handle = thread::spawn(move || {
            let (mut stream, _) = listener.accept().unwrap();
            let mut request = [0_u8; 256];
            let _ = stream.read(&mut request);
            stream.write_all(response.as_bytes()).unwrap();
        });

        (port, handle)
    }
}
