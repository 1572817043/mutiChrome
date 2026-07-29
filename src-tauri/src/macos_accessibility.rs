use crate::ChromeWindowInfo;
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
    fn AXValueGetValue(value: AXValueRef, value_type: c_int, value_ptr: *mut c_void) -> Boolean;
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

pub fn set_window_bounds(pid: u32, x: i32, y: i32, width: i32, height: i32) -> Result<(), String> {
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

fn set_bool_attribute(element: AXUIElementRef, attribute: &str, value: bool) -> Result<(), String> {
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

fn perform_action(element: AXUIElementRef, action: &str, operation: &str) -> Result<(), String> {
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
