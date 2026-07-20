use serde::{Deserialize, Serialize};
use std::collections::{HashMap, HashSet};
use std::fs;
use std::path::{Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ProfileDocument {
    pub version: u8,
    #[serde(default)]
    pub settings: AppSettings,
    pub profiles: Vec<StoredProfile>,
    #[serde(default)]
    pub projects: Vec<StoredProject>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AppSettings {
    pub browser_path: String,
    #[serde(default)]
    pub favorite_urls: Vec<String>,
    #[serde(default)]
    pub recent_urls: Vec<String>,
    #[serde(default)]
    pub url_library: Vec<StoredUrlLibraryItem>,
    #[serde(default = "default_theme")]
    pub theme: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StoredUrlLibraryItem {
    pub id: String,
    pub name: String,
    pub url: String,
    #[serde(default)]
    pub tags: Vec<String>,
    #[serde(default)]
    pub notes: String,
    #[serde(default)]
    pub created_at: String,
    #[serde(default)]
    pub updated_at: String,
}

impl Default for AppSettings {
    fn default() -> Self {
        Self {
            browser_path: default_browser_path(),
            favorite_urls: Vec::new(),
            recent_urls: Vec::new(),
            url_library: Vec::new(),
            theme: default_theme(),
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StoredProfile {
    pub id: String,
    pub name: String,
    pub tags: Vec<String>,
    pub notes: String,
    pub status: String,
    #[serde(default)]
    pub account_platforms: Vec<StoredAccountPlatform>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub accent_color: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub import_source: Option<StoredProfileImportSource>,
    pub created_at: String,
    pub updated_at: String,
    pub last_opened_at: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StoredProfileImportSource {
    pub profile_uid: String,
    pub source_path: String,
    pub source_folder_name: String,
    pub imported_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StoredAccountPlatform {
    pub id: String,
    pub platform: String,
    pub login_url: String,
    pub username: String,
    pub notes: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StoredProject {
    pub id: String,
    pub name: String,
    pub url: String,
    #[serde(default)]
    pub urls: Vec<StoredProjectUrl>,
    pub notes: String,
    pub profile_ids: Vec<String>,
    pub interval_seconds: u8,
    pub created_at: String,
    pub updated_at: String,
    pub last_opened_at: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StoredProjectUrl {
    pub id: String,
    pub name: String,
    pub url: String,
    pub notes: String,
}

#[derive(Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RootStatus {
    pub root_exists: bool,
    pub writable: bool,
    pub profile_count: usize,
}

#[derive(Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProfileBackupResult {
    pub path: String,
    pub profile_count: usize,
}

#[derive(Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FullProfileBackupResult {
    pub path: String,
    pub profile_count: usize,
    pub profile_ids: Vec<String>,
    pub total_bytes: u64,
}

#[derive(Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FullProfileBackupPreview {
    pub destination_dir: String,
    pub profile_count: usize,
    pub profile_ids: Vec<String>,
    pub total_bytes: u64,
}

#[derive(Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FullProfileRestorePreview {
    pub path: String,
    pub profile_count: usize,
    pub profile_ids: Vec<String>,
    pub new_profile_ids: Vec<String>,
    pub overwrite_profile_ids: Vec<String>,
    pub total_bytes: u64,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct FullProfileBackupManifest {
    schema_version: u8,
    app: String,
    backup_type: String,
    created_at_ms: u128,
    profile_count: usize,
    profile_ids: Vec<String>,
    total_bytes: u64,
}

#[derive(Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RootHealthReport {
    pub root_path: String,
    pub summary: RootHealthSummary,
    pub issues: Vec<RootHealthIssue>,
}

#[derive(Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RootHealthSummary {
    pub profile_count: usize,
    pub warning_count: usize,
    pub error_count: usize,
}

#[derive(Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RootHealthIssue {
    pub severity: RootHealthSeverity,
    pub code: String,
    pub title: String,
    pub detail: String,
    pub path: Option<String>,
    pub profile_id: Option<String>,
}

#[derive(Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum RootHealthSeverity {
    Warning,
    Error,
}

#[derive(Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RootRepairResult {
    pub repaired_count: usize,
    pub actions: Vec<RootRepairAction>,
    pub health: RootHealthReport,
}

#[derive(Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RootRepairAction {
    pub code: String,
    pub title: String,
    pub detail: String,
    pub path: Option<String>,
    pub profile_id: Option<String>,
}

#[derive(Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProfileImportCandidate {
    pub path: String,
    pub folder_name: String,
    pub suggested_name: String,
    pub suggested_tags: Vec<String>,
    pub suggested_notes: String,
    pub size_bytes: u64,
    pub confidence: ProfileImportConfidence,
    pub evidence: Vec<String>,
    pub skipped_reason: Option<String>,
    pub profile_uid: Option<String>,
    pub duplicate_profile_id: Option<String>,
    pub duplicate_profile_name: Option<String>,
    pub duplicate_reason: Option<String>,
}

#[derive(Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum ProfileImportConfidence {
    Ready,
    Suspicious,
    Skipped,
}

struct IndexedProfileMeta {
    name: String,
    tags: Vec<String>,
    notes: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProfileMarker {
    pub schema_version: u8,
    pub app: String,
    pub profile_uid: String,
    pub profile_id: String,
    pub name: String,
    pub source_path: String,
    pub source_folder_name: String,
    pub imported_at: String,
}

#[derive(Clone)]
struct DuplicateProfileMeta {
    id: String,
    name: String,
}

pub fn init_root(root: &Path) -> Result<RootStatus, String> {
    fs::create_dir_all(root.join("app-data")).map_err(|error| error.to_string())?;
    fs::create_dir_all(root.join("profiles")).map_err(|error| error.to_string())?;

    let document_path = root.join("app-data/profiles.json");
    if !document_path.exists() {
        let document = ProfileDocument {
            version: 1,
            settings: AppSettings::default(),
            profiles: Vec::new(),
            projects: Vec::new(),
        };
        let json = serde_json::to_string_pretty(&document).map_err(|error| error.to_string())?;
        fs::write(&document_path, format!("{json}\n")).map_err(|error| error.to_string())?;
    }

    let document = read_document(&document_path)?;
    Ok(RootStatus {
        root_exists: root.exists(),
        writable: can_write(root),
        profile_count: document.profiles.len(),
    })
}

pub fn directory_size(path: &Path) -> Result<u64, String> {
    let metadata = fs::symlink_metadata(path).map_err(|error| error.to_string())?;
    if metadata.is_file() {
        return Ok(metadata.len());
    }
    if !metadata.is_dir() {
        return Ok(0);
    }

    let mut total = 0;
    for entry in fs::read_dir(path).map_err(|error| error.to_string())? {
        let entry = entry.map_err(|error| error.to_string())?;
        total += directory_size(&entry.path())?;
    }

    Ok(total)
}

pub fn load_profile_document(root: &Path) -> Result<ProfileDocument, String> {
    read_document(&document_path(root))
}

pub fn create_profile_backup(root: &Path) -> Result<ProfileBackupResult, String> {
    let document = load_profile_document(root)?;
    let backups_dir = ensure_profile_backups_dir(root)?;
    let backup_path = backups_dir.join(format!("profiles-{}.json", timestamp_millis()));
    let json = serde_json::to_string_pretty(&document).map_err(|error| error.to_string())?;
    fs::write(&backup_path, format!("{json}\n")).map_err(|error| error.to_string())?;

    Ok(ProfileBackupResult {
        path: backup_path.to_string_lossy().to_string(),
        profile_count: document.profiles.len(),
    })
}

pub fn restore_profile_backup(root: &Path, backup_path: &Path) -> Result<ProfileDocument, String> {
    let document = read_document(backup_path)?;
    save_profile_document(root, &document)?;
    Ok(document)
}

pub fn create_full_profile_backup(
    root: &Path,
    requested_profile_ids: &[String],
) -> Result<FullProfileBackupResult, String> {
    let document = load_profile_document(root)?;
    let selected_profiles = select_profiles_for_backup(&document, requested_profile_ids)?;
    let profile_ids = selected_profiles
        .iter()
        .map(|profile| profile.id.clone())
        .collect::<Vec<_>>();
    let backup_document = filtered_document_for_profiles(&document, &profile_ids);
    let backup_path =
        ensure_profile_backups_dir(root)?.join(format!("full-profiles-{}", timestamp_millis()));

    fs::create_dir_all(backup_path.join("profiles")).map_err(|error| error.to_string())?;
    for profile_id in &profile_ids {
        let source = safe_profile_dir(root, profile_id)?;
        let destination = backup_path.join("profiles").join(profile_id);
        copy_directory(&source, &destination)?;
    }

    let json = serde_json::to_string_pretty(&backup_document).map_err(|error| error.to_string())?;
    fs::write(backup_path.join("profiles.json"), format!("{json}\n"))
        .map_err(|error| error.to_string())?;

    let total_bytes_before_manifest = directory_size(&backup_path)?;
    let manifest = FullProfileBackupManifest {
        schema_version: 1,
        app: "MultiChrome".to_string(),
        backup_type: "full-profile-directory".to_string(),
        created_at_ms: timestamp_millis(),
        profile_count: profile_ids.len(),
        profile_ids: profile_ids.clone(),
        total_bytes: total_bytes_before_manifest,
    };
    let manifest_json =
        serde_json::to_string_pretty(&manifest).map_err(|error| error.to_string())?;
    fs::write(
        backup_path.join("manifest.json"),
        format!("{manifest_json}\n"),
    )
    .map_err(|error| error.to_string())?;
    let total_bytes = directory_size(&backup_path)?;

    Ok(FullProfileBackupResult {
        path: backup_path.to_string_lossy().to_string(),
        profile_count: profile_ids.len(),
        profile_ids,
        total_bytes,
    })
}

pub fn preview_full_profile_backup(
    root: &Path,
    requested_profile_ids: &[String],
) -> Result<FullProfileBackupPreview, String> {
    let document = load_profile_document(root)?;
    let selected_profiles = select_profiles_for_backup(&document, requested_profile_ids)?;
    let profile_ids = selected_profiles
        .iter()
        .map(|profile| profile.id.clone())
        .collect::<Vec<_>>();
    let mut total_bytes = 0;

    for profile_id in &profile_ids {
        total_bytes += directory_size(&safe_profile_dir(root, profile_id)?)?;
    }

    Ok(FullProfileBackupPreview {
        destination_dir: root.join("app-data/backups").to_string_lossy().to_string(),
        profile_count: profile_ids.len(),
        profile_ids,
        total_bytes,
    })
}

pub fn preview_full_profile_restore(
    root: &Path,
    backup_path: &Path,
) -> Result<FullProfileRestorePreview, String> {
    let backup_dir = resolve_full_profile_backup_dir(backup_path)?;
    let backup_document = read_full_profile_backup_document(&backup_dir)?;
    let current_document = load_profile_document(root)?;
    let current_ids = current_document
        .profiles
        .iter()
        .map(|profile| profile.id.as_str())
        .collect::<HashSet<_>>();
    let profile_ids = backup_document
        .profiles
        .iter()
        .map(|profile| profile.id.clone())
        .collect::<Vec<_>>();
    let mut new_profile_ids = Vec::new();
    let mut overwrite_profile_ids = Vec::new();

    for profile_id in &profile_ids {
        validate_full_backup_profile_dir(&backup_dir, profile_id)?;
        if current_ids.contains(profile_id.as_str()) {
            overwrite_profile_ids.push(profile_id.clone());
        } else {
            new_profile_ids.push(profile_id.clone());
        }
    }

    Ok(FullProfileRestorePreview {
        path: backup_dir.to_string_lossy().to_string(),
        profile_count: profile_ids.len(),
        profile_ids,
        new_profile_ids,
        overwrite_profile_ids,
        total_bytes: directory_size(&backup_dir)?,
    })
}

pub fn restore_full_profile_backup(
    root: &Path,
    backup_path: &Path,
    overwrite_existing: bool,
) -> Result<ProfileDocument, String> {
    let backup_dir = resolve_full_profile_backup_dir(backup_path)?;
    let backup_document = read_full_profile_backup_document(&backup_dir)?;
    let current_document = load_profile_document(root)?;

    for profile in &backup_document.profiles {
        validate_full_backup_profile_dir(&backup_dir, &profile.id)?;
        let target = safe_profile_dir(root, &profile.id)?;
        if target.exists() && !directory_is_empty(&target)? && !overwrite_existing {
            return Err(format!("目标账号 {} 已存在，需要确认覆盖", profile.id));
        }
    }

    for profile in &backup_document.profiles {
        let source = backup_dir.join("profiles").join(&profile.id);
        let target = safe_profile_dir(root, &profile.id)?;
        replace_profile_directory(&source, &target)?;
    }

    let merged_document = merge_restored_document(current_document, backup_document);
    save_profile_document(root, &merged_document)?;
    Ok(merged_document)
}

fn select_profiles_for_backup(
    document: &ProfileDocument,
    requested_profile_ids: &[String],
) -> Result<Vec<StoredProfile>, String> {
    let requested_ids = requested_profile_ids
        .iter()
        .map(|profile_id| profile_id.trim().to_string())
        .filter(|profile_id| !profile_id.is_empty())
        .collect::<Vec<_>>();

    for profile_id in &requested_ids {
        validate_profile_id(profile_id)?;
    }

    let selected_profiles = if requested_ids.is_empty() {
        document.profiles.clone()
    } else {
        let requested = requested_ids.iter().cloned().collect::<HashSet<_>>();
        document
            .profiles
            .iter()
            .filter(|profile| requested.contains(&profile.id))
            .cloned()
            .collect::<Vec<_>>()
    };

    if selected_profiles.is_empty() {
        Err("没有可备份的账号".to_string())
    } else {
        Ok(selected_profiles)
    }
}

fn filtered_document_for_profiles(
    document: &ProfileDocument,
    profile_ids: &[String],
) -> ProfileDocument {
    let selected = profile_ids.iter().cloned().collect::<HashSet<_>>();
    let profiles = document
        .profiles
        .iter()
        .filter(|profile| selected.contains(&profile.id))
        .cloned()
        .collect::<Vec<_>>();
    let projects = document
        .projects
        .iter()
        .filter_map(|project| {
            let mut cloned = project.clone();
            cloned
                .profile_ids
                .retain(|profile_id| selected.contains(profile_id));
            (!cloned.profile_ids.is_empty() || project.profile_ids.is_empty()).then_some(cloned)
        })
        .collect::<Vec<_>>();

    ProfileDocument {
        version: 1,
        settings: document.settings.clone(),
        profiles,
        projects,
    }
}

fn resolve_full_profile_backup_dir(backup_path: &Path) -> Result<PathBuf, String> {
    let metadata = fs::symlink_metadata(backup_path).map_err(|error| error.to_string())?;
    if metadata.is_dir() {
        return Ok(backup_path.to_path_buf());
    }

    let parent = backup_path
        .parent()
        .ok_or_else(|| "完整备份路径无效".to_string())?;
    Ok(parent.to_path_buf())
}

fn read_full_profile_backup_document(backup_dir: &Path) -> Result<ProfileDocument, String> {
    if !backup_dir.join("manifest.json").is_file() {
        return Err("未找到完整备份 manifest.json".to_string());
    }
    let document = read_document(&backup_dir.join("profiles.json"))?;
    if document.profiles.is_empty() {
        return Err("完整备份里没有账号".to_string());
    }
    Ok(document)
}

fn validate_full_backup_profile_dir(backup_dir: &Path, profile_id: &str) -> Result<(), String> {
    validate_profile_id(profile_id)?;
    let path = backup_dir.join("profiles").join(profile_id);
    if path.is_dir() {
        Ok(())
    } else {
        Err(format!("完整备份缺少账号目录：{profile_id}"))
    }
}

fn replace_profile_directory(source: &Path, target: &Path) -> Result<(), String> {
    let parent = target
        .parent()
        .ok_or_else(|| "目标 profile 路径无效".to_string())?;
    fs::create_dir_all(parent).map_err(|error| error.to_string())?;
    let file_name = target
        .file_name()
        .and_then(|name| name.to_str())
        .ok_or_else(|| "目标 profile 路径无效".to_string())?;
    let staging = parent.join(format!("{file_name}.restore-tmp-{}", timestamp_millis()));

    if staging.exists() {
        fs::remove_dir_all(&staging).map_err(|error| error.to_string())?;
    }

    match copy_directory(source, &staging).and_then(|_| {
        if target.exists() {
            fs::remove_dir_all(target).map_err(|error| error.to_string())?;
        }
        fs::rename(&staging, target).map_err(|error| error.to_string())
    }) {
        Ok(()) => Ok(()),
        Err(error) => {
            if staging.exists() {
                let _ = fs::remove_dir_all(&staging);
            }
            Err(error)
        }
    }
}

fn merge_restored_document(
    current_document: ProfileDocument,
    backup_document: ProfileDocument,
) -> ProfileDocument {
    let restored_profile_ids = backup_document
        .profiles
        .iter()
        .map(|profile| profile.id.clone())
        .collect::<HashSet<_>>();
    let mut profiles = current_document
        .profiles
        .into_iter()
        .filter(|profile| !restored_profile_ids.contains(&profile.id))
        .collect::<Vec<_>>();
    profiles.extend(backup_document.profiles);

    let existing_profile_ids = profiles
        .iter()
        .map(|profile| profile.id.clone())
        .collect::<HashSet<_>>();
    let restored_project_ids = backup_document
        .projects
        .iter()
        .map(|project| project.id.clone())
        .collect::<HashSet<_>>();
    let mut projects = current_document
        .projects
        .into_iter()
        .filter(|project| !restored_project_ids.contains(&project.id))
        .collect::<Vec<_>>();
    projects.extend(backup_document.projects.into_iter().map(|mut project| {
        project
            .profile_ids
            .retain(|profile_id| existing_profile_ids.contains(profile_id));
        project
    }));

    ProfileDocument {
        version: 1,
        settings: current_document.settings,
        profiles,
        projects,
    }
}

pub fn check_root_health(root: &Path) -> RootHealthReport {
    let mut issues = Vec::new();
    let mut profile_count = 0;
    let mut registered_ids = HashSet::new();

    match fs::symlink_metadata(root) {
        Ok(metadata) if metadata.is_dir() => {}
        Ok(_) => {
            issues.push(health_issue(
                RootHealthSeverity::Error,
                "root_not_directory",
                "根路径不是文件夹",
                "当前配置根路径存在，但不是一个文件夹。",
                Some(root),
                None,
            ));
            return health_report(root, profile_count, issues);
        }
        Err(_) => {
            issues.push(health_issue(
                RootHealthSeverity::Error,
                "root_missing",
                "根目录不存在",
                "当前配置根目录不存在，需要先在设置里检测或重新选择目录。",
                Some(root),
                None,
            ));
            return health_report(root, profile_count, issues);
        }
    }

    let app_data_path = root.join("app-data");
    let profiles_path = root.join("profiles");
    if !app_data_path.is_dir() {
        issues.push(health_issue(
            RootHealthSeverity::Error,
            "app_data_dir_missing",
            "索引目录缺失",
            "app-data 文件夹不存在，账号索引无法读取。",
            Some(&app_data_path),
            None,
        ));
    } else if !can_write(root) {
        issues.push(health_issue(
            RootHealthSeverity::Error,
            "root_not_writable",
            "根目录不可写",
            "无法在 app-data 写入测试文件，请检查磁盘权限或外置盘状态。",
            Some(root),
            None,
        ));
    }

    if !profiles_path.is_dir() {
        issues.push(health_issue(
            RootHealthSeverity::Error,
            "profiles_dir_missing",
            "Profile 目录缺失",
            "profiles 文件夹不存在，Chrome 配置文件夹无法定位。",
            Some(&profiles_path),
            None,
        ));
    }

    let document_file = document_path(root);
    if !document_file.exists() {
        issues.push(health_issue(
            RootHealthSeverity::Error,
            "profile_document_missing",
            "账号索引缺失",
            "app-data/profiles.json 不存在，软件无法读取账号列表。",
            Some(&document_file),
            None,
        ));
    } else {
        match read_document(&document_file) {
            Ok(document) => {
                profile_count = document.profiles.len();
                for profile in document.profiles {
                    if validate_profile_id(&profile.id).is_err() {
                        issues.push(health_issue(
                            RootHealthSeverity::Error,
                            "profile_id_invalid",
                            "账号 ID 不合法",
                            "账号 ID 只能包含字母、数字、短横线和下划线。",
                            None,
                            Some(&profile.id),
                        ));
                        continue;
                    }

                    if !registered_ids.insert(profile.id.clone()) {
                        issues.push(health_issue(
                            RootHealthSeverity::Error,
                            "profile_id_duplicated",
                            "账号 ID 重复",
                            "账号索引里出现了重复 ID，可能导致同一个配置目录被多个账号共用。",
                            None,
                            Some(&profile.id),
                        ));
                    }

                    inspect_registered_profile(root, &profile.id, &mut issues);
                }
            }
            Err(error) => issues.push(health_issue(
                RootHealthSeverity::Error,
                "profile_document_invalid",
                "账号索引损坏",
                &format!("profiles.json 不是有效的账号索引：{error}"),
                Some(&document_file),
                None,
            )),
        }
    }

    inspect_profile_directory_entries(&profiles_path, &registered_ids, &mut issues);
    health_report(root, profile_count, issues)
}

pub fn repair_root_health(root: &Path) -> Result<RootRepairResult, String> {
    let mut actions = Vec::new();

    match fs::symlink_metadata(root) {
        Ok(metadata) if metadata.is_dir() => {}
        Ok(_) => return Err("根路径不是文件夹".to_string()),
        Err(_) => {
            fs::create_dir_all(root).map_err(|error| error.to_string())?;
            actions.push(repair_action(
                "root_dir_created",
                "已创建根目录",
                "配置根目录不存在，已自动创建。",
                Some(root),
                None,
            ));
        }
    }

    let app_data_path = root.join("app-data");
    if !app_data_path.exists() {
        fs::create_dir_all(&app_data_path).map_err(|error| error.to_string())?;
        actions.push(repair_action(
            "app_data_dir_created",
            "已创建索引目录",
            "app-data 文件夹不存在，已自动创建。",
            Some(&app_data_path),
            None,
        ));
    }

    let profiles_path = root.join("profiles");
    if !profiles_path.exists() {
        fs::create_dir_all(&profiles_path).map_err(|error| error.to_string())?;
        actions.push(repair_action(
            "profiles_dir_created",
            "已创建 Profile 目录",
            "profiles 文件夹不存在，已自动创建。",
            Some(&profiles_path),
            None,
        ));
    }

    let backups_path = root.join("app-data/backups");
    if app_data_path.is_dir() && !backups_path.exists() {
        fs::create_dir_all(&backups_path).map_err(|error| error.to_string())?;
        actions.push(repair_action(
            "backups_dir_created",
            "已创建备份目录",
            "备份目录不存在，已自动创建。",
            Some(&backups_path),
            None,
        ));
    }

    let document_file = document_path(root);
    if app_data_path.is_dir() && !document_file.exists() {
        let document = ProfileDocument {
            version: 1,
            settings: AppSettings::default(),
            profiles: Vec::new(),
            projects: Vec::new(),
        };
        let json = serde_json::to_string_pretty(&document).map_err(|error| error.to_string())?;
        fs::write(&document_file, format!("{json}\n")).map_err(|error| error.to_string())?;
        actions.push(repair_action(
            "profile_document_created",
            "已创建账号索引",
            "profiles.json 不存在，已创建空账号索引。",
            Some(&document_file),
            None,
        ));
    }

    if profiles_path.is_dir() {
        if let Ok(document) = load_profile_document(root) {
            for profile in document.profiles {
                let Ok(path) = safe_profile_dir(root, &profile.id) else {
                    continue;
                };
                if !path.exists() {
                    fs::create_dir_all(&path).map_err(|error| error.to_string())?;
                    actions.push(repair_action(
                        "profile_dir_created",
                        "已补建 Profile 文件夹",
                        "账号索引里存在该账号，已补建缺失的 profile 文件夹。",
                        Some(&path),
                        Some(&profile.id),
                    ));
                }
            }
        }
    }

    let health = check_root_health(root);
    Ok(RootRepairResult {
        repaired_count: actions.len(),
        actions,
        health,
    })
}

pub fn scan_profile_import_candidates(
    root: &Path,
    source_path: &Path,
) -> Result<Vec<ProfileImportCandidate>, String> {
    let metadata = fs::symlink_metadata(source_path).map_err(|error| error.to_string())?;
    if !metadata.is_dir() {
        return Err("导入来源必须是目录".to_string());
    }

    let profiles_dir = source_path.join("profiles");
    let document_file = document_path(source_path);
    let is_multichrome_root = profiles_dir.is_dir() && document_file.is_file();
    let scan_dir = if is_multichrome_root {
        profiles_dir.as_path()
    } else {
        source_path
    };
    let indexed_profiles = if is_multichrome_root {
        read_import_index(&document_file).unwrap_or_default()
    } else {
        HashMap::new()
    };
    let duplicate_index = read_duplicate_import_index(root);

    let mut entries = fs::read_dir(scan_dir)
        .map_err(|error| error.to_string())?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|error| error.to_string())?;
    entries.sort_by_key(|entry| entry.file_name().to_string_lossy().to_lowercase());

    let mut candidates = Vec::new();
    for entry in entries {
        let path = entry.path();
        let folder_name = entry.file_name().to_string_lossy().to_string();
        let entry_metadata = fs::symlink_metadata(&path).map_err(|error| error.to_string())?;
        if !entry_metadata.is_dir() {
            continue;
        }

        candidates.push(inspect_import_candidate(
            &path,
            &folder_name,
            indexed_profiles.get(&folder_name),
            &duplicate_index,
        ));
    }

    Ok(candidates)
}

fn read_duplicate_import_index(
    root: &Path,
) -> (
    HashMap<String, DuplicateProfileMeta>,
    HashMap<String, DuplicateProfileMeta>,
) {
    let mut by_source_path = HashMap::new();
    let mut by_profile_uid = HashMap::new();
    let Ok(document) = load_profile_document(root) else {
        return (by_source_path, by_profile_uid);
    };

    for profile in document.profiles {
        let Some(import_source) = profile.import_source else {
            continue;
        };
        let duplicate = DuplicateProfileMeta {
            id: profile.id,
            name: profile.name,
        };
        if !import_source.source_path.trim().is_empty() {
            by_source_path.insert(import_source.source_path, duplicate.clone());
        }
        if !import_source.profile_uid.trim().is_empty() {
            by_profile_uid.insert(import_source.profile_uid, duplicate);
        }
    }

    (by_source_path, by_profile_uid)
}

fn read_import_index(document_file: &Path) -> Result<HashMap<String, IndexedProfileMeta>, String> {
    let document = read_document(document_file)?;
    Ok(document
        .profiles
        .into_iter()
        .map(|profile| {
            (
                profile.id,
                IndexedProfileMeta {
                    name: profile.name,
                    tags: profile.tags,
                    notes: profile.notes,
                },
            )
        })
        .collect())
}

fn inspect_import_candidate(
    path: &Path,
    folder_name: &str,
    indexed_profile: Option<&IndexedProfileMeta>,
    duplicate_index: &(
        HashMap<String, DuplicateProfileMeta>,
        HashMap<String, DuplicateProfileMeta>,
    ),
) -> ProfileImportCandidate {
    let mut evidence = Vec::new();
    let mut skipped_reason = None;
    let marker = read_profile_marker(path);
    if marker.is_some() {
        evidence.push("发现 .multichrome.json".to_string());
    }

    if path.join("Local State").is_file() {
        evidence.push("发现 Local State".to_string());
    }

    for feature in [
        "Default/Preferences",
        "Default/Cookies",
        "Default/History",
        "Default/Login Data",
    ] {
        if path.join(feature).is_file() {
            evidence.push(format!("发现 {feature}"));
        }
    }

    let confidence = if evidence
        .iter()
        .any(|item| item.starts_with("发现 Local State") || item.starts_with("发现 Default/"))
    {
        ProfileImportConfidence::Ready
    } else if path.join("Default").is_dir() {
        evidence.push("只发现 Default 文件夹".to_string());
        ProfileImportConfidence::Suspicious
    } else if path.join("Preferences").is_file() {
        evidence.push("发现根层 Preferences，可能是 Chrome 内部 Profile 子目录".to_string());
        ProfileImportConfidence::Suspicious
    } else {
        skipped_reason = Some(
            if directory_is_empty(path).unwrap_or(false) {
                "空目录"
            } else {
                "未发现 Chrome profile 特征"
            }
            .to_string(),
        );
        ProfileImportConfidence::Skipped
    };

    if indexed_profile.is_some() {
        evidence.push("匹配旧 MultiChrome 索引".to_string());
    }

    let path_string = path.to_string_lossy().to_string();
    let duplicate_by_uid = marker
        .as_ref()
        .and_then(|value| duplicate_index.1.get(&value.profile_uid))
        .map(|profile| (profile, "profileUid 已导入"));
    let duplicate_by_path = duplicate_index
        .0
        .get(&path_string)
        .map(|profile| (profile, "来源路径已导入"));
    let duplicate = duplicate_by_uid.or(duplicate_by_path);

    ProfileImportCandidate {
        path: path_string,
        folder_name: folder_name.to_string(),
        suggested_name: indexed_profile
            .map(|profile| profile.name.clone())
            .or_else(|| marker.as_ref().map(|value| value.name.clone()))
            .filter(|name| !name.trim().is_empty())
            .unwrap_or_else(|| folder_name.to_string()),
        suggested_tags: indexed_profile
            .map(|profile| profile.tags.clone())
            .unwrap_or_default(),
        suggested_notes: indexed_profile
            .map(|profile| profile.notes.clone())
            .unwrap_or_default(),
        size_bytes: directory_size(path).unwrap_or(0),
        confidence,
        evidence,
        skipped_reason,
        profile_uid: marker.map(|value| value.profile_uid),
        duplicate_profile_id: duplicate.map(|(profile, _)| profile.id.clone()),
        duplicate_profile_name: duplicate.map(|(profile, _)| profile.name.clone()),
        duplicate_reason: duplicate.map(|(_, reason)| reason.to_string()),
    }
}

fn read_profile_marker(profile_path: &Path) -> Option<ProfileMarker> {
    let raw = fs::read_to_string(profile_marker_path(profile_path)).ok()?;
    let marker = serde_json::from_str::<ProfileMarker>(&raw).ok()?;
    (marker.app == "MultiChrome" && !marker.profile_uid.trim().is_empty()).then_some(marker)
}

fn write_profile_marker(profile_path: &Path, marker: &ProfileMarker) -> Result<(), String> {
    let json = serde_json::to_string_pretty(marker).map_err(|error| error.to_string())?;
    fs::write(profile_marker_path(profile_path), format!("{json}\n"))
        .map_err(|error| error.to_string())
}

fn profile_marker_path(profile_path: &Path) -> PathBuf {
    profile_path.join(".multichrome.json")
}

pub fn save_profile_document(root: &Path, document: &ProfileDocument) -> Result<(), String> {
    fs::create_dir_all(root.join("app-data")).map_err(|error| error.to_string())?;
    fs::create_dir_all(root.join("profiles")).map_err(|error| error.to_string())?;
    for profile in &document.profiles {
        fs::create_dir_all(safe_profile_dir(root, &profile.id)?)
            .map_err(|error| error.to_string())?;
    }
    let json = serde_json::to_string_pretty(document).map_err(|error| error.to_string())?;
    fs::write(document_path(root), format!("{json}\n")).map_err(|error| error.to_string())
}

pub fn ensure_profile_dir(root: &Path, profile_id: &str) -> Result<PathBuf, String> {
    let path = safe_profile_dir(root, profile_id)?;
    fs::create_dir_all(&path).map_err(|error| error.to_string())?;
    Ok(path)
}

pub fn ensure_profile_backups_dir(root: &Path) -> Result<PathBuf, String> {
    let path = root.join("app-data/backups");
    fs::create_dir_all(&path).map_err(|error| error.to_string())?;
    Ok(path)
}

pub fn delete_profile_dir(root: &Path, profile_id: &str) -> Result<(), String> {
    let path = safe_profile_dir(root, profile_id)?;
    if path.exists() {
        fs::remove_dir_all(path).map_err(|error| error.to_string())?;
    }
    Ok(())
}

pub fn copy_profile_dir(
    root: &Path,
    source_profile_id: &str,
    target_profile_id: &str,
) -> Result<(), String> {
    let source = safe_profile_dir(root, source_profile_id)?;
    let target = safe_profile_dir(root, target_profile_id)?;
    copy_directory(&source, &target)
}

pub fn import_profile_dir(
    root: &Path,
    source_path: &Path,
    target_profile_id: &str,
    marker: Option<ProfileMarker>,
) -> Result<(), String> {
    let target = safe_profile_dir(root, target_profile_id)?;
    match copy_directory(source_path, &target).and_then(|_| {
        if let Some(marker) = marker.as_ref() {
            write_profile_marker(&target, marker)?;
        }
        Ok(())
    }) {
        Ok(()) => Ok(()),
        Err(error) => {
            if target.exists() {
                let _ = fs::remove_dir_all(&target);
            }
            Err(error)
        }
    }
}

pub fn profile_dir(root: &Path, profile_id: &str) -> PathBuf {
    root.join("profiles").join(profile_id)
}

fn safe_profile_dir(root: &Path, profile_id: &str) -> Result<PathBuf, String> {
    validate_profile_id(profile_id)?;
    Ok(profile_dir(root, profile_id))
}

fn validate_profile_id(profile_id: &str) -> Result<(), String> {
    let valid = !profile_id.is_empty()
        && profile_id.chars().all(|character| {
            character.is_ascii_alphanumeric() || character == '-' || character == '_'
        });

    if valid {
        Ok(())
    } else {
        Err("账号 ID 只能包含字母、数字、短横线和下划线".to_string())
    }
}

fn copy_directory(source: &Path, destination: &Path) -> Result<(), String> {
    let metadata = fs::symlink_metadata(source).map_err(|error| error.to_string())?;
    if !metadata.is_dir() {
        return Err("来源必须是目录".to_string());
    }

    if destination.exists() && !directory_is_empty(destination)? {
        return Err("目标 profile 目录已存在且不为空".to_string());
    }

    fs::create_dir_all(destination).map_err(|error| error.to_string())?;
    for entry in fs::read_dir(source).map_err(|error| error.to_string())? {
        let entry = entry.map_err(|error| error.to_string())?;
        let source_path = entry.path();
        let destination_path = destination.join(entry.file_name());
        let entry_metadata =
            fs::symlink_metadata(&source_path).map_err(|error| error.to_string())?;

        if entry_metadata.is_dir() {
            copy_directory(&source_path, &destination_path)?;
        } else if entry_metadata.is_file() {
            fs::copy(&source_path, &destination_path).map_err(|error| error.to_string())?;
        }
    }

    Ok(())
}

fn directory_is_empty(path: &Path) -> Result<bool, String> {
    Ok(fs::read_dir(path)
        .map_err(|error| error.to_string())?
        .next()
        .is_none())
}

fn read_document(path: &Path) -> Result<ProfileDocument, String> {
    let raw = fs::read_to_string(path).map_err(|error| error.to_string())?;
    serde_json::from_str(&raw).map_err(|error| error.to_string())
}

fn document_path(root: &Path) -> std::path::PathBuf {
    root.join("app-data/profiles.json")
}

fn timestamp_millis() -> u128 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_millis())
        .unwrap_or(0)
}

pub fn default_browser_path() -> String {
    "/Applications/Google Chrome.app".to_string()
}

fn default_theme() -> String {
    "light".to_string()
}

fn can_write(root: &Path) -> bool {
    let test_path = root.join("app-data/.write-test");
    match fs::write(&test_path, b"ok") {
        Ok(()) => {
            let _ = fs::remove_file(test_path);
            true
        }
        Err(_) => false,
    }
}

fn inspect_registered_profile(root: &Path, profile_id: &str, issues: &mut Vec<RootHealthIssue>) {
    let path = profile_dir(root, profile_id);
    match fs::symlink_metadata(&path) {
        Ok(metadata) if metadata.is_dir() => {
            if directory_is_empty(&path).unwrap_or(false) {
                issues.push(health_issue(
                    RootHealthSeverity::Warning,
                    "profile_dir_empty",
                    "Profile 文件夹为空",
                    "该账号还没有启动过 Chrome，或配置目录没有写入数据。",
                    Some(&path),
                    Some(profile_id),
                ));
            }
        }
        Ok(_) => issues.push(health_issue(
            RootHealthSeverity::Error,
            "profile_path_not_directory",
            "Profile 路径不是文件夹",
            "账号对应路径存在，但不是一个文件夹。",
            Some(&path),
            Some(profile_id),
        )),
        Err(_) => issues.push(health_issue(
            RootHealthSeverity::Error,
            "profile_dir_missing",
            "Profile 文件夹缺失",
            "账号索引里存在该账号，但对应 profile 文件夹不存在。",
            Some(&path),
            Some(profile_id),
        )),
    }
}

fn inspect_profile_directory_entries(
    profiles_path: &Path,
    registered_ids: &HashSet<String>,
    issues: &mut Vec<RootHealthIssue>,
) {
    if !profiles_path.is_dir() {
        return;
    }

    let entries = match fs::read_dir(profiles_path) {
        Ok(entries) => entries,
        Err(error) => {
            issues.push(health_issue(
                RootHealthSeverity::Error,
                "profiles_dir_unreadable",
                &format!("无法读取 profiles 目录：{error}"),
                "请检查磁盘权限或外置盘连接状态。",
                Some(profiles_path),
                None,
            ));
            return;
        }
    };

    for entry in entries.flatten() {
        let path = entry.path();
        let id = entry.file_name().to_string_lossy().to_string();
        match fs::symlink_metadata(&path) {
            Ok(metadata) if metadata.is_dir() => {
                if !registered_ids.contains(&id) {
                    issues.push(health_issue(
                        RootHealthSeverity::Warning,
                        "orphan_profile_dir",
                        "发现未登记的 Profile 文件夹",
                        "该文件夹存在于 profiles 下，但不在账号索引里。",
                        Some(&path),
                        Some(&id),
                    ));
                }
            }
            Ok(_) => issues.push(health_issue(
                RootHealthSeverity::Warning,
                "profiles_entry_not_directory",
                "profiles 下存在非文件夹条目",
                "profiles 目录中建议只存放账号 profile 文件夹。",
                Some(&path),
                Some(&id),
            )),
            Err(error) => issues.push(health_issue(
                RootHealthSeverity::Error,
                "profile_entry_unreadable",
                &format!("无法读取 profile 条目：{error}"),
                "请检查磁盘权限或外置盘连接状态。",
                Some(&path),
                Some(&id),
            )),
        }
    }
}

fn health_issue(
    severity: RootHealthSeverity,
    code: &str,
    title: &str,
    detail: &str,
    path: Option<&Path>,
    profile_id: Option<&str>,
) -> RootHealthIssue {
    RootHealthIssue {
        severity,
        code: code.to_string(),
        title: title.to_string(),
        detail: detail.to_string(),
        path: path.map(|value| value.to_string_lossy().to_string()),
        profile_id: profile_id.map(ToString::to_string),
    }
}

fn repair_action(
    code: &str,
    title: &str,
    detail: &str,
    path: Option<&Path>,
    profile_id: Option<&str>,
) -> RootRepairAction {
    RootRepairAction {
        code: code.to_string(),
        title: title.to_string(),
        detail: detail.to_string(),
        path: path.map(|value| value.to_string_lossy().to_string()),
        profile_id: profile_id.map(ToString::to_string),
    }
}

fn health_report(
    root: &Path,
    profile_count: usize,
    issues: Vec<RootHealthIssue>,
) -> RootHealthReport {
    let warning_count = issues
        .iter()
        .filter(|issue| issue.severity == RootHealthSeverity::Warning)
        .count();
    let error_count = issues
        .iter()
        .filter(|issue| issue.severity == RootHealthSeverity::Error)
        .count();

    RootHealthReport {
        root_path: root.to_string_lossy().to_string(),
        summary: RootHealthSummary {
            profile_count,
            warning_count,
            error_count,
        },
        issues,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;

    #[test]
    fn init_root_creates_app_data_profiles_and_document() {
        let temp_dir = tempfile::tempdir().expect("temp dir");
        let status = init_root(temp_dir.path()).expect("init root");

        assert!(status.root_exists);
        assert!(status.writable);
        assert_eq!(status.profile_count, 0);
        assert!(temp_dir.path().join("app-data").is_dir());
        assert!(temp_dir.path().join("profiles").is_dir());

        let document = fs::read_to_string(temp_dir.path().join("app-data/profiles.json"))
            .expect("profiles document");
        assert_eq!(
            document,
            "{\n  \"version\": 1,\n  \"settings\": {\n    \"browserPath\": \"/Applications/Google Chrome.app\",\n    \"favoriteUrls\": [],\n    \"recentUrls\": [],\n    \"urlLibrary\": [],\n    \"theme\": \"light\"\n  },\n  \"profiles\": [],\n  \"projects\": []\n}\n"
        );
    }

    #[test]
    fn directory_size_counts_nested_files() {
        let temp_dir = tempfile::tempdir().expect("temp dir");
        fs::write(temp_dir.path().join("one.txt"), b"12345").expect("write one");
        fs::create_dir(temp_dir.path().join("nested")).expect("create nested");
        fs::write(temp_dir.path().join("nested/two.txt"), b"123").expect("write two");

        assert_eq!(directory_size(temp_dir.path()).expect("size"), 8);
    }

    #[test]
    fn save_and_load_document_round_trips_profiles() {
        let temp_dir = tempfile::tempdir().expect("temp dir");
        init_root(temp_dir.path()).expect("init root");

        let document = ProfileDocument {
            version: 1,
            settings: AppSettings::default(),
            profiles: vec![StoredProfile {
                id: "account-001".to_string(),
                name: "推特 01".to_string(),
                tags: vec!["twitter".to_string(), "galxe".to_string()],
                notes: "测试账号".to_string(),
                status: "active".to_string(),
                account_platforms: vec![StoredAccountPlatform {
                    id: "platform-001".to_string(),
                    platform: "X".to_string(),
                    login_url: "https://x.com/i/flow/login".to_string(),
                    username: "tree_user".to_string(),
                    notes: "主推特".to_string(),
                }],
                accent_color: Some("forest".to_string()),
                import_source: None,
                created_at: "2026-07-15T10:00:00.000Z".to_string(),
                updated_at: "2026-07-15T10:00:00.000Z".to_string(),
                last_opened_at: None,
            }],
            projects: Vec::new(),
        };

        save_profile_document(temp_dir.path(), &document).expect("save document");
        let loaded = load_profile_document(temp_dir.path()).expect("load document");

        assert_eq!(
            loaded.settings.browser_path,
            "/Applications/Google Chrome.app"
        );
        assert_eq!(loaded.profiles.len(), 1);
        assert_eq!(loaded.profiles[0].name, "推特 01");
        assert_eq!(loaded.profiles[0].tags, vec!["twitter", "galxe"]);
        assert_eq!(loaded.profiles[0].account_platforms.len(), 1);
        assert_eq!(loaded.profiles[0].account_platforms[0].platform, "X");
    }

    #[test]
    fn save_profile_document_creates_profile_directories() {
        let temp_dir = tempfile::tempdir().expect("temp dir");
        init_root(temp_dir.path()).expect("init root");

        let document = ProfileDocument {
            version: 1,
            settings: AppSettings::default(),
            profiles: vec![StoredProfile {
                id: "account-002".to_string(),
                name: "账号 2".to_string(),
                tags: Vec::new(),
                notes: String::new(),
                status: "active".to_string(),
                account_platforms: Vec::new(),
                accent_color: Some("teal".to_string()),
                import_source: None,
                created_at: "2026-07-15T10:00:00.000Z".to_string(),
                updated_at: "2026-07-15T10:00:00.000Z".to_string(),
                last_opened_at: None,
            }],
            projects: Vec::new(),
        };

        save_profile_document(temp_dir.path(), &document).expect("save document");

        assert!(temp_dir.path().join("profiles/account-002").is_dir());
    }

    #[test]
    fn load_profile_document_uses_default_settings_for_legacy_document() {
        let temp_dir = tempfile::tempdir().expect("temp dir");
        fs::create_dir_all(temp_dir.path().join("app-data")).expect("create app data");
        fs::write(
            temp_dir.path().join("app-data/profiles.json"),
            "{\n  \"version\": 1,\n  \"profiles\": []\n}\n",
        )
        .expect("write legacy document");

        let document = load_profile_document(temp_dir.path()).expect("load document");

        assert_eq!(
            document.settings.browser_path,
            "/Applications/Google Chrome.app"
        );
        assert_eq!(document.settings.theme, "light");
    }

    #[test]
    fn delete_profile_dir_removes_only_target_profile_directory() {
        let temp_dir = tempfile::tempdir().expect("temp dir");
        init_root(temp_dir.path()).expect("init root");
        fs::create_dir_all(temp_dir.path().join("profiles/account-001/Default"))
            .expect("create profile");
        fs::write(
            temp_dir
                .path()
                .join("profiles/account-001/Default/Preferences"),
            b"prefs",
        )
        .expect("write prefs");
        fs::write(temp_dir.path().join("app-data/profiles.json"), b"{}").expect("write app data");

        delete_profile_dir(temp_dir.path(), "account-001").expect("delete profile dir");

        assert!(!temp_dir.path().join("profiles/account-001").exists());
        assert!(temp_dir.path().join("app-data/profiles.json").exists());
    }

    #[test]
    fn copy_profile_dir_copies_nested_files_to_new_profile() {
        let temp_dir = tempfile::tempdir().expect("temp dir");
        init_root(temp_dir.path()).expect("init root");
        fs::create_dir_all(temp_dir.path().join("profiles/account-001/Default"))
            .expect("create source profile");
        fs::write(
            temp_dir
                .path()
                .join("profiles/account-001/Default/Preferences"),
            b"prefs",
        )
        .expect("write prefs");

        copy_profile_dir(temp_dir.path(), "account-001", "account-002").expect("copy profile dir");

        assert_eq!(
            fs::read(
                temp_dir
                    .path()
                    .join("profiles/account-002/Default/Preferences")
            )
            .expect("target prefs"),
            b"prefs"
        );
        assert!(temp_dir
            .path()
            .join("profiles/account-001/Default/Preferences")
            .exists());
    }

    #[test]
    fn import_profile_dir_copies_external_directory_to_profile() {
        let temp_dir = tempfile::tempdir().expect("temp dir");
        let external_dir = tempfile::tempdir().expect("external dir");
        init_root(temp_dir.path()).expect("init root");
        fs::create_dir_all(external_dir.path().join("Default")).expect("create external profile");
        fs::write(external_dir.path().join("Default/Cookies"), b"cookies").expect("write cookies");

        import_profile_dir(temp_dir.path(), external_dir.path(), "account-003", None)
            .expect("import profile");

        assert_eq!(
            fs::read(temp_dir.path().join("profiles/account-003/Default/Cookies"))
                .expect("imported cookies"),
            b"cookies"
        );
    }

    #[test]
    fn import_profile_dir_writes_multichrome_marker() {
        let temp_dir = tempfile::tempdir().expect("temp dir");
        let external_dir = tempfile::tempdir().expect("external dir");
        init_root(temp_dir.path()).expect("init root");
        fs::create_dir_all(external_dir.path().join("Default")).expect("create external profile");
        fs::write(external_dir.path().join("Default/Preferences"), b"prefs").expect("write prefs");

        import_profile_dir(
            temp_dir.path(),
            external_dir.path(),
            "account-003",
            Some(ProfileMarker {
                schema_version: 1,
                app: "MultiChrome".to_string(),
                profile_uid: "profile-uid-001".to_string(),
                profile_id: "account-003".to_string(),
                name: "导入号".to_string(),
                source_path: external_dir.path().to_string_lossy().to_string(),
                source_folder_name: external_dir
                    .path()
                    .file_name()
                    .expect("folder name")
                    .to_string_lossy()
                    .to_string(),
                imported_at: "2026-07-17T00:00:00.000Z".to_string(),
            }),
        )
        .expect("import profile");

        let marker = fs::read_to_string(
            temp_dir
                .path()
                .join("profiles/account-003/.multichrome.json"),
        )
        .expect("marker");

        assert!(marker.contains("\"app\": \"MultiChrome\""));
        assert!(marker.contains("\"profileUid\": \"profile-uid-001\""));
        assert!(marker.contains("\"sourcePath\":"));
    }

    #[test]
    fn scan_profile_import_candidates_marks_duplicate_source_path() {
        let root = tempfile::tempdir().expect("root");
        let source_dir = tempfile::tempdir().expect("source");
        init_root(root.path()).expect("init root");
        fs::create_dir_all(source_dir.path().join("twitter-main/Default"))
            .expect("create source profile");
        fs::write(
            source_dir.path().join("twitter-main/Default/Preferences"),
            b"prefs",
        )
        .expect("write prefs");
        let imported_source_path = source_dir
            .path()
            .join("twitter-main")
            .to_string_lossy()
            .to_string();
        save_profile_document(
            root.path(),
            &ProfileDocument {
                version: 1,
                settings: AppSettings::default(),
                profiles: vec![StoredProfile {
                    id: "account-001".to_string(),
                    name: "已导入号".to_string(),
                    tags: Vec::new(),
                    notes: String::new(),
                    status: "active".to_string(),
                    account_platforms: Vec::new(),
                    accent_color: Some("forest".to_string()),
                    import_source: Some(StoredProfileImportSource {
                        profile_uid: "profile-uid-001".to_string(),
                        source_path: imported_source_path,
                        source_folder_name: "twitter-main".to_string(),
                        imported_at: "2026-07-17T00:00:00.000Z".to_string(),
                    }),
                    created_at: "2026-07-17T00:00:00.000Z".to_string(),
                    updated_at: "2026-07-17T00:00:00.000Z".to_string(),
                    last_opened_at: None,
                }],
                projects: Vec::new(),
            },
        )
        .expect("save document");

        let candidates = scan_profile_import_candidates(root.path(), source_dir.path())
            .expect("scan candidates");

        assert_eq!(candidates.len(), 1);
        assert_eq!(
            candidates[0].duplicate_profile_id.as_deref(),
            Some("account-001")
        );
        assert_eq!(
            candidates[0].duplicate_profile_name.as_deref(),
            Some("已导入号")
        );
        assert_eq!(
            candidates[0].duplicate_reason.as_deref(),
            Some("来源路径已导入")
        );
    }

    #[test]
    fn scan_profile_import_candidates_uses_multichrome_index_metadata() {
        let source_root = tempfile::tempdir().expect("source root");
        init_root(source_root.path()).expect("init source");
        fs::create_dir_all(source_root.path().join("profiles/account-010/Default"))
            .expect("create imported profile");
        fs::write(
            source_root
                .path()
                .join("profiles/account-010/Default/Preferences"),
            b"prefs",
        )
        .expect("write prefs");
        save_profile_document(
            source_root.path(),
            &ProfileDocument {
                version: 1,
                settings: AppSettings::default(),
                profiles: vec![StoredProfile {
                    id: "account-010".to_string(),
                    name: "旧推特号".to_string(),
                    tags: vec!["旧盘".to_string(), "x".to_string()],
                    notes: "旧索引备注".to_string(),
                    status: "active".to_string(),
                    account_platforms: Vec::new(),
                    accent_color: Some("forest".to_string()),
                    import_source: None,
                    created_at: "2026-07-15T10:00:00.000Z".to_string(),
                    updated_at: "2026-07-15T10:00:00.000Z".to_string(),
                    last_opened_at: None,
                }],
                projects: Vec::new(),
            },
        )
        .expect("save source document");

        let candidates = scan_profile_import_candidates(source_root.path(), source_root.path())
            .expect("scan candidates");

        assert_eq!(candidates.len(), 1);
        assert_eq!(candidates[0].folder_name, "account-010");
        assert_eq!(candidates[0].suggested_name, "旧推特号");
        assert_eq!(candidates[0].suggested_tags, vec!["旧盘", "x"]);
        assert_eq!(candidates[0].suggested_notes, "旧索引备注");
        assert_eq!(candidates[0].confidence, ProfileImportConfidence::Ready);
        assert!(candidates[0]
            .evidence
            .contains(&"发现 Default/Preferences".to_string()));
        assert!(candidates[0]
            .evidence
            .contains(&"匹配旧 MultiChrome 索引".to_string()));
    }

    #[test]
    fn scan_profile_import_candidates_scans_one_level_and_marks_suspicious() {
        let source_dir = tempfile::tempdir().expect("source dir");
        fs::create_dir_all(source_dir.path().join("ready/Default")).expect("create ready");
        fs::write(
            source_dir.path().join("ready/Default/Preferences"),
            b"prefs",
        )
        .expect("write prefs");
        fs::create_dir_all(source_dir.path().join("maybe/Default")).expect("create maybe");
        fs::create_dir_all(source_dir.path().join("nested/child/Default"))
            .expect("create nested child");
        fs::write(
            source_dir.path().join("nested/child/Default/Preferences"),
            b"prefs",
        )
        .expect("write nested prefs");

        let candidates = scan_profile_import_candidates(source_dir.path(), source_dir.path())
            .expect("scan candidates");

        let ready = candidates
            .iter()
            .find(|candidate| candidate.folder_name == "ready")
            .expect("ready candidate");
        let maybe = candidates
            .iter()
            .find(|candidate| candidate.folder_name == "maybe")
            .expect("maybe candidate");
        let nested = candidates
            .iter()
            .find(|candidate| candidate.folder_name == "nested")
            .expect("nested candidate");

        assert_eq!(ready.confidence, ProfileImportConfidence::Ready);
        assert_eq!(maybe.confidence, ProfileImportConfidence::Suspicious);
        assert_eq!(nested.confidence, ProfileImportConfidence::Skipped);
        assert_eq!(
            nested.skipped_reason.as_deref(),
            Some("未发现 Chrome profile 特征")
        );
        assert!(!candidates
            .iter()
            .any(|candidate| candidate.folder_name == "child"));
    }

    #[test]
    fn profile_file_operations_reject_path_traversal_ids() {
        let temp_dir = tempfile::tempdir().expect("temp dir");
        init_root(temp_dir.path()).expect("init root");

        let result = delete_profile_dir(temp_dir.path(), "../outside");

        assert!(result.is_err());
    }

    #[test]
    fn profile_dir_uses_profiles_subdirectory() {
        let root = std::path::Path::new("/tmp/multichrome-root");

        assert_eq!(
            profile_dir(root, "account-001"),
            std::path::PathBuf::from("/tmp/multichrome-root/profiles/account-001")
        );
    }

    #[test]
    fn check_root_health_reports_missing_registered_profile_directory() {
        let temp_dir = tempfile::tempdir().expect("temp dir");
        init_root(temp_dir.path()).expect("init root");
        let document = ProfileDocument {
            version: 1,
            settings: AppSettings::default(),
            profiles: vec![test_profile("account-001")],
            projects: Vec::new(),
        };
        save_profile_document(temp_dir.path(), &document).expect("save document");
        fs::remove_dir_all(temp_dir.path().join("profiles/account-001"))
            .expect("remove profile dir");

        let report = check_root_health(temp_dir.path());

        assert_eq!(report.summary.error_count, 1);
        assert!(report.issues.iter().any(|issue| {
            issue.code == "profile_dir_missing"
                && issue.profile_id.as_deref() == Some("account-001")
        }));
    }

    #[test]
    fn check_root_health_reports_orphan_profile_directory() {
        let temp_dir = tempfile::tempdir().expect("temp dir");
        init_root(temp_dir.path()).expect("init root");
        fs::create_dir_all(temp_dir.path().join("profiles/orphan-001/Default"))
            .expect("create orphan dir");

        let report = check_root_health(temp_dir.path());

        assert_eq!(report.summary.warning_count, 1);
        assert!(report
            .issues
            .iter()
            .any(|issue| issue.code == "orphan_profile_dir"));
    }

    #[test]
    fn check_root_health_reports_invalid_profile_document() {
        let temp_dir = tempfile::tempdir().expect("temp dir");
        fs::create_dir_all(temp_dir.path().join("app-data")).expect("create app data");
        fs::create_dir_all(temp_dir.path().join("profiles")).expect("create profiles");
        fs::write(temp_dir.path().join("app-data/profiles.json"), b"{broken")
            .expect("write invalid document");

        let report = check_root_health(temp_dir.path());

        assert_eq!(report.summary.error_count, 1);
        assert!(report
            .issues
            .iter()
            .any(|issue| issue.code == "profile_document_invalid"));
    }

    #[test]
    fn repair_root_health_creates_missing_app_directories_and_document() {
        let temp_dir = tempfile::tempdir().expect("temp dir");
        let root = temp_dir.path().join("new-root");

        let result = repair_root_health(&root).expect("repair root");

        assert!(root.is_dir());
        assert!(root.join("app-data").is_dir());
        assert!(root.join("profiles").is_dir());
        assert!(root.join("app-data/backups").is_dir());
        assert!(root.join("app-data/profiles.json").is_file());
        assert_eq!(result.health.summary.error_count, 0);
        assert!(result
            .actions
            .iter()
            .any(|action| action.code == "profile_document_created"));
    }

    #[test]
    fn repair_root_health_creates_missing_registered_profile_directory() {
        let temp_dir = tempfile::tempdir().expect("temp dir");
        init_root(temp_dir.path()).expect("init root");
        save_profile_document(
            temp_dir.path(),
            &ProfileDocument {
                version: 1,
                settings: AppSettings::default(),
                profiles: vec![test_profile("account-001")],
                projects: Vec::new(),
            },
        )
        .expect("save document");
        fs::remove_dir_all(temp_dir.path().join("profiles/account-001"))
            .expect("remove profile dir");

        let result = repair_root_health(temp_dir.path()).expect("repair root");

        assert!(temp_dir.path().join("profiles/account-001").is_dir());
        assert_eq!(result.health.summary.error_count, 0);
        assert!(result
            .actions
            .iter()
            .any(|action| action.code == "profile_dir_created"
                && action.profile_id.as_deref() == Some("account-001")));
    }

    #[test]
    fn repair_root_health_does_not_overwrite_invalid_document() {
        let temp_dir = tempfile::tempdir().expect("temp dir");
        fs::create_dir_all(temp_dir.path().join("app-data")).expect("create app data");
        fs::create_dir_all(temp_dir.path().join("profiles")).expect("create profiles");
        fs::write(temp_dir.path().join("app-data/profiles.json"), b"{broken")
            .expect("write invalid document");

        let result = repair_root_health(temp_dir.path()).expect("repair root");
        let raw = fs::read_to_string(temp_dir.path().join("app-data/profiles.json"))
            .expect("read document");

        assert_eq!(raw, "{broken");
        assert_eq!(result.health.summary.error_count, 1);
        assert!(result
            .health
            .issues
            .iter()
            .any(|issue| issue.code == "profile_document_invalid"));
        assert!(!result
            .actions
            .iter()
            .any(|action| action.code == "profile_document_created"));
    }

    #[test]
    fn create_profile_backup_writes_document_copy() {
        let temp_dir = tempfile::tempdir().expect("temp dir");
        init_root(temp_dir.path()).expect("init root");
        let document = ProfileDocument {
            version: 1,
            settings: AppSettings::default(),
            profiles: vec![test_profile("account-001")],
            projects: Vec::new(),
        };
        save_profile_document(temp_dir.path(), &document).expect("save document");

        let backup = create_profile_backup(temp_dir.path()).expect("create backup");
        let loaded_backup =
            read_document(&std::path::PathBuf::from(&backup.path)).expect("load backup");

        assert_eq!(backup.profile_count, 1);
        assert!(std::path::PathBuf::from(&backup.path)
            .starts_with(temp_dir.path().join("app-data/backups")));
        assert_eq!(loaded_backup.profiles.len(), 1);
        assert_eq!(loaded_backup.profiles[0].id, "account-001");
    }

    #[test]
    fn restore_profile_backup_replaces_document_and_creates_profile_directories() {
        let temp_dir = tempfile::tempdir().expect("temp dir");
        let backup_dir = tempfile::tempdir().expect("backup dir");
        init_root(temp_dir.path()).expect("init root");
        save_profile_document(
            temp_dir.path(),
            &ProfileDocument {
                version: 1,
                settings: AppSettings::default(),
                profiles: vec![test_profile("account-001")],
                projects: Vec::new(),
            },
        )
        .expect("save original document");
        let backup_path = backup_dir.path().join("backup.json");
        let backup_document = ProfileDocument {
            version: 1,
            settings: AppSettings {
                browser_path: "/Applications/Chromium.app".to_string(),
                favorite_urls: Vec::new(),
                recent_urls: Vec::new(),
                url_library: Vec::new(),
                theme: "dark".to_string(),
            },
            profiles: vec![test_profile("account-009")],
            projects: Vec::new(),
        };
        fs::write(
            &backup_path,
            format!(
                "{}\n",
                serde_json::to_string_pretty(&backup_document).expect("json")
            ),
        )
        .expect("write backup");

        let restored =
            restore_profile_backup(temp_dir.path(), &backup_path).expect("restore backup");
        let loaded = load_profile_document(temp_dir.path()).expect("load restored document");

        assert_eq!(restored.profiles[0].id, "account-009");
        assert_eq!(loaded.settings.browser_path, "/Applications/Chromium.app");
        assert_eq!(loaded.settings.theme, "dark");
        assert!(temp_dir.path().join("profiles/account-009").is_dir());
    }

    #[test]
    fn create_full_profile_backup_copies_selected_profile_directories() {
        let temp_dir = tempfile::tempdir().expect("temp dir");
        init_root(temp_dir.path()).expect("init root");
        save_profile_document(
            temp_dir.path(),
            &ProfileDocument {
                version: 1,
                settings: AppSettings::default(),
                profiles: vec![test_profile("account-001"), test_profile("account-002")],
                projects: Vec::new(),
            },
        )
        .expect("save document");
        fs::create_dir_all(temp_dir.path().join("profiles/account-001/Default"))
            .expect("create profile data");
        fs::write(
            temp_dir.path().join("profiles/account-001/Default/Cookies"),
            b"cookies",
        )
        .expect("write profile data");
        fs::write(
            temp_dir.path().join("profiles/account-002/Preferences"),
            b"skip",
        )
        .expect("write skipped profile data");

        let backup = create_full_profile_backup(temp_dir.path(), &["account-001".to_string()])
            .expect("create full backup");
        let backup_path = std::path::PathBuf::from(&backup.path);
        let backup_document =
            read_document(&backup_path.join("profiles.json")).expect("read backup document");

        assert_eq!(backup.profile_count, 1);
        assert_eq!(backup.profile_ids, vec!["account-001"]);
        assert!(backup.total_bytes > 0);
        assert!(backup_path.starts_with(temp_dir.path().join("app-data/backups")));
        assert!(backup_path.join("manifest.json").is_file());
        assert!(backup_path
            .join("profiles/account-001/Default/Cookies")
            .is_file());
        assert!(!backup_path.join("profiles/account-002").exists());
        assert_eq!(backup_document.profiles.len(), 1);
        assert_eq!(backup_document.profiles[0].id, "account-001");
    }

    #[test]
    fn preview_full_profile_backup_reports_selected_profiles_size_and_destination() {
        let temp_dir = tempfile::tempdir().expect("temp dir");
        init_root(temp_dir.path()).expect("init root");
        save_profile_document(
            temp_dir.path(),
            &ProfileDocument {
                version: 1,
                settings: AppSettings::default(),
                profiles: vec![test_profile("account-001"), test_profile("account-002")],
                projects: Vec::new(),
            },
        )
        .expect("save document");
        fs::write(
            temp_dir.path().join("profiles/account-001/Preferences"),
            b"one",
        )
        .expect("write selected profile");
        fs::write(
            temp_dir.path().join("profiles/account-002/Preferences"),
            b"two",
        )
        .expect("write skipped profile");

        let preview = preview_full_profile_backup(temp_dir.path(), &["account-001".to_string()])
            .expect("preview backup");

        assert_eq!(preview.profile_count, 1);
        assert_eq!(preview.profile_ids, vec!["account-001"]);
        assert!(preview.total_bytes >= 3);
        assert_eq!(
            preview.destination_dir,
            temp_dir
                .path()
                .join("app-data/backups")
                .to_string_lossy()
                .to_string()
        );
    }

    #[test]
    fn preview_full_profile_restore_reports_new_and_overwritten_profiles() {
        let source_root = tempfile::tempdir().expect("source root");
        let target_root = tempfile::tempdir().expect("target root");
        init_root(source_root.path()).expect("init source");
        init_root(target_root.path()).expect("init target");
        save_profile_document(
            source_root.path(),
            &ProfileDocument {
                version: 1,
                settings: AppSettings::default(),
                profiles: vec![test_profile("account-001"), test_profile("account-003")],
                projects: Vec::new(),
            },
        )
        .expect("save source");
        save_profile_document(
            target_root.path(),
            &ProfileDocument {
                version: 1,
                settings: AppSettings::default(),
                profiles: vec![test_profile("account-001"), test_profile("account-002")],
                projects: Vec::new(),
            },
        )
        .expect("save target");
        fs::write(
            source_root.path().join("profiles/account-003/Preferences"),
            b"new",
        )
        .expect("write source profile");
        let backup = create_full_profile_backup(
            source_root.path(),
            &["account-001".to_string(), "account-003".to_string()],
        )
        .expect("create full backup");

        let preview = preview_full_profile_restore(
            target_root.path(),
            &std::path::PathBuf::from(&backup.path),
        )
        .expect("preview restore");

        assert_eq!(preview.profile_count, 2);
        assert_eq!(preview.overwrite_profile_ids, vec!["account-001"]);
        assert_eq!(preview.new_profile_ids, vec!["account-003"]);
        assert!(preview.total_bytes > 0);
    }

    #[test]
    fn restore_full_profile_backup_merges_document_and_profile_directories() {
        let source_root = tempfile::tempdir().expect("source root");
        let target_root = tempfile::tempdir().expect("target root");
        init_root(source_root.path()).expect("init source");
        init_root(target_root.path()).expect("init target");
        save_profile_document(
            source_root.path(),
            &ProfileDocument {
                version: 1,
                settings: AppSettings::default(),
                profiles: vec![test_profile("account-001"), test_profile("account-003")],
                projects: Vec::new(),
            },
        )
        .expect("save source");
        save_profile_document(
            target_root.path(),
            &ProfileDocument {
                version: 1,
                settings: AppSettings::default(),
                profiles: vec![test_profile("account-001"), test_profile("account-002")],
                projects: Vec::new(),
            },
        )
        .expect("save target");
        fs::create_dir_all(source_root.path().join("profiles/account-001/Default"))
            .expect("create source profile");
        fs::write(
            source_root
                .path()
                .join("profiles/account-001/Default/Cookies"),
            b"new cookies",
        )
        .expect("write source account-001");
        fs::write(
            source_root.path().join("profiles/account-003/Preferences"),
            b"restored",
        )
        .expect("write source account-003");
        fs::create_dir_all(target_root.path().join("profiles/account-001/Default"))
            .expect("create target profile");
        fs::write(
            target_root
                .path()
                .join("profiles/account-001/Default/Cookies"),
            b"old cookies",
        )
        .expect("write target account-001");
        let backup = create_full_profile_backup(
            source_root.path(),
            &["account-001".to_string(), "account-003".to_string()],
        )
        .expect("create full backup");

        let restored = restore_full_profile_backup(
            target_root.path(),
            &std::path::PathBuf::from(&backup.path),
            true,
        )
        .expect("restore full backup");
        let restored_ids = restored
            .profiles
            .iter()
            .map(|profile| profile.id.as_str())
            .collect::<Vec<_>>();
        let restored_cookie = fs::read_to_string(
            target_root
                .path()
                .join("profiles/account-001/Default/Cookies"),
        )
        .expect("read restored cookie");

        assert_eq!(
            restored_ids,
            vec!["account-002", "account-001", "account-003"]
        );
        assert_eq!(restored_cookie, "new cookies");
        assert!(target_root
            .path()
            .join("profiles/account-003/Preferences")
            .is_file());
        assert!(target_root.path().join("profiles/account-002").is_dir());
    }

    #[test]
    fn ensure_profile_backups_dir_creates_backups_directory() {
        let temp_dir = tempfile::tempdir().expect("temp dir");
        init_root(temp_dir.path()).expect("init root");

        let backups_dir = ensure_profile_backups_dir(temp_dir.path()).expect("ensure backups dir");

        assert_eq!(backups_dir, temp_dir.path().join("app-data/backups"));
        assert!(backups_dir.is_dir());
    }

    fn test_profile(id: &str) -> StoredProfile {
        StoredProfile {
            id: id.to_string(),
            name: id.to_string(),
            tags: Vec::new(),
            notes: String::new(),
            status: "active".to_string(),
            account_platforms: Vec::new(),
            accent_color: Some("forest".to_string()),
            import_source: None,
            created_at: "2026-07-15T10:00:00.000Z".to_string(),
            updated_at: "2026-07-15T10:00:00.000Z".to_string(),
            last_opened_at: None,
        }
    }
}
