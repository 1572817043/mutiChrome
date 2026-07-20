mod profile_store;

use profile_store::{
    check_root_health, copy_profile_dir, create_full_profile_backup, create_profile_backup,
    default_browser_path, delete_profile_dir, directory_size, ensure_profile_backups_dir,
    ensure_profile_dir, import_profile_dir, init_root, load_profile_document,
    preview_full_profile_backup, preview_full_profile_restore, repair_root_health,
    restore_full_profile_backup, restore_profile_backup, save_profile_document,
    FullProfileBackupPreview, FullProfileBackupResult, FullProfileRestorePreview,
    ProfileBackupResult, ProfileDocument, ProfileImportCandidate, ProfileMarker, RootHealthReport,
    RootRepairResult, RootStatus,
};
use serde::Serialize;
use std::collections::{BTreeMap, BTreeSet};
use std::path::{Path, PathBuf};
use std::process::Command;

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
            profile_directory_size,
            detect_chrome,
            open_profile,
            list_running_profiles,
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
    let launch_command = profile_launch_command(&browser, &profile_dir, launch_url, is_running);
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

fn chrome_launch_args(profile_dir: &Path, launch_url: Option<String>) -> Vec<String> {
    let mut args = vec![
        format!("--user-data-dir={}", profile_dir.to_string_lossy()),
        "--no-first-run".to_string(),
    ];

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
) -> LaunchCommand {
    if is_profile_running {
        LaunchCommand {
            program: browser_executable_path(browser),
            args: chrome_launch_args(profile_dir, launch_url),
        }
    } else {
        let mut args = vec![
            "-n".to_string(),
            "-a".to_string(),
            browser.to_string_lossy().to_string(),
            "--args".to_string(),
        ];
        args.extend(chrome_launch_args(profile_dir, launch_url));

        LaunchCommand {
            program: PathBuf::from("open"),
            args,
        }
    }
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
        profile_processes.entry(profile_id).or_insert(pid);
    }

    profile_processes
        .into_iter()
        .map(|(profile_id, pid)| RunningProfileProcess { profile_id, pid })
        .collect()
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
    use std::path::Path;

    #[test]
    fn chrome_launch_args_pass_profile_dir_as_switch_value() {
        let profile_dir = Path::new("/Users/a0000/MultiChromeProfiles/profiles/account-001");

        assert_eq!(
            chrome_launch_args(profile_dir, None),
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
            chrome_launch_args(profile_dir, Some("https://galxe.com".to_string())),
            vec![
                "--user-data-dir=/Users/a0000/MultiChromeProfiles/profiles/account-001".to_string(),
                "--no-first-run".to_string(),
                "https://galxe.com".to_string()
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
                false
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
                    "--no-first-run".to_string(),
                    "chrome://newtab/".to_string()
                ]
            }
        );
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
                true
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
            "  1201 /Applications/Google Chrome.app/Contents/MacOS/Google Chrome --user-data-dir=/Users/a0000/MultiChromeProfiles/profiles/account-001 --no-first-run",
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
                    pid: 1201
                },
                RunningProfileProcess {
                    profile_id: "account-002".to_string(),
                    pid: 1301
                }
            ]
        );
    }
}
