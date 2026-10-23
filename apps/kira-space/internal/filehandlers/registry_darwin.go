//go:build darwin && cgo && !server

// The macOS Registry over NSWorkspace / UniformTypeIdentifiers (macOS 12+; the bundle requires
// 14). Mechanical by design: every decision lives in filehandlers.go, which the flow tests cover
// through a fake. It cannot be compiled outside a real macOS toolchain; read it for structure.
package filehandlers

/*
#cgo CFLAGS: -x objective-c -fobjc-arc
#cgo LDFLAGS: -framework Cocoa -framework UniformTypeIdentifiers

#import <Cocoa/Cocoa.h>
#import <UniformTypeIdentifiers/UniformTypeIdentifiers.h>
#include <dispatch/dispatch.h>
#include <stdlib.h>
#include <string.h>

static char *kira_dup(NSString *s) {
	return s ? strdup([s UTF8String]) : NULL;
}

// kira_resolve sets *uti to the content type of ext and returns 1 when the extension is not a
// usable text type: no declared type (an app never registered with LaunchServices sees a dynamic
// one), or one that does not conform to public.text (ts resolves to MPEG-2 video).
static int kira_resolve(const char *ext, char **uti) {
	UTType *t = [UTType typeWithFilenameExtension:[NSString stringWithUTF8String:ext]];
	if (t == nil) {
		*uti = NULL;
		return 1;
	}
	*uti = kira_dup(t.identifier);
	if (t.isDynamic || ![t conformsToType:UTTypeText]) {
		return 1;
	}
	return 0;
}

static NSString *kira_app_name(NSBundle *b, NSURL *url) {
	NSString *n = [b objectForInfoDictionaryKey:@"CFBundleDisplayName"];
	if (n == nil) n = [b objectForInfoDictionaryKey:@"CFBundleName"];
	if (n == nil) n = [[url lastPathComponent] stringByDeletingPathExtension];
	return n;
}

// kira_default returns 1 and fills the out strings (malloc'd) when an app opens uti, else 0.
static int kira_default(const char *uti, char **path, char **bundleID, char **name) {
	UTType *t = [UTType typeWithIdentifier:[NSString stringWithUTF8String:uti]];
	if (t == nil) return 0;
	NSURL *url = [[NSWorkspace sharedWorkspace] URLForApplicationToOpenContentType:t];
	if (url == nil) return 0;
	NSBundle *b = [NSBundle bundleWithURL:url];
	*path = kira_dup(url.path);
	*bundleID = kira_dup(b.bundleIdentifier);
	*name = kira_dup(kira_app_name(b, url));
	return 1;
}

// kira_set blocks on the completion handler. Returns 0 ok, 1 the system refused (*msg set),
// 2 the app is gone or not a loadable bundle, 3 timed out.
static int kira_set(const char *uti, const char *appPath, double timeoutSeconds, char **msg) {
	UTType *t = [UTType typeWithIdentifier:[NSString stringWithUTF8String:uti]];
	NSURL *url = [NSURL fileURLWithPath:[NSString stringWithUTF8String:appPath]];
	if (t == nil || [NSBundle bundleWithURL:url] == nil) return 2;
	__block int result = 0;
	__block NSString *text = nil;
	dispatch_semaphore_t sem = dispatch_semaphore_create(0);
	[[NSWorkspace sharedWorkspace] setDefaultApplicationAtURL:url
	                                        toOpenContentType:t
	                                        completionHandler:^(NSError *error) {
		if (error != nil) {
			result = 1;
			text = error.localizedDescription;
		}
		dispatch_semaphore_signal(sem);
	}];
	if (dispatch_semaphore_wait(sem, dispatch_time(DISPATCH_TIME_NOW, (int64_t)(timeoutSeconds * NSEC_PER_SEC))) != 0) {
		return 3;
	}
	if (result != 0) *msg = kira_dup(text);
	return result;
}

static void kira_self(char **path, char **bundleID, char **name) {
	NSBundle *b = [NSBundle mainBundle];
	*path = kira_dup(b.bundleURL.path);
	*bundleID = kira_dup(b.bundleIdentifier);
	*name = kira_dup(kira_app_name(b, b.bundleURL));
}
*/
import "C"

import (
	"errors"
	"fmt"
	"unsafe"
)

const setTimeoutSeconds = 10

type darwinRegistry struct{}

// NewRegistry is the platform Registry.
func NewRegistry() Registry { return darwinRegistry{} }

func (darwinRegistry) Supported() bool { return true }

func goString(p *C.char) string {
	if p == nil {
		return ""
	}
	defer C.free(unsafe.Pointer(p))
	return C.GoString(p)
}

func (darwinRegistry) Resolve(ext string) (string, bool) {
	cext := C.CString(ext)
	defer C.free(unsafe.Pointer(cext))
	var uti *C.char
	dynamic := C.kira_resolve(cext, &uti) != 0
	return goString(uti), dynamic
}

func (darwinRegistry) Default(uti string) (App, error) {
	cuti := C.CString(uti)
	defer C.free(unsafe.Pointer(cuti))
	var path, bundleID, name *C.char
	if C.kira_default(cuti, &path, &bundleID, &name) == 0 {
		return App{}, nil
	}
	return App{Path: goString(path), BundleID: goString(bundleID), Name: goString(name)}, nil
}

func (darwinRegistry) SetDefault(uti, appPath string) error {
	cuti, capp := C.CString(uti), C.CString(appPath)
	defer C.free(unsafe.Pointer(cuti))
	defer C.free(unsafe.Pointer(capp))
	var msg *C.char
	switch C.kira_set(cuti, capp, setTimeoutSeconds, &msg) {
	case 0:
		return nil
	case 1:
		return errors.New(goString(msg))
	case 2:
		return fmt.Errorf("app not found: %s", appPath)
	default:
		return errors.New("timed out waiting for the system")
	}
}

func (darwinRegistry) Self() App {
	var path, bundleID, name *C.char
	C.kira_self(&path, &bundleID, &name)
	return App{Path: goString(path), BundleID: goString(bundleID), Name: goString(name)}
}
