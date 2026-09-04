//go:build darwin && !server

package shell

/*
#cgo CFLAGS: -mmacosx-version-min=10.13 -x objective-c
#cgo LDFLAGS: -framework Cocoa

#import <Cocoa/Cocoa.h>

// repositionTrafficLights moves the three standard window-control buttons (close/miniaturize/
// zoom) to sit inside a title bar exactly barHeight points tall, left-inset by leftInset points —
// the same effect Electron's trafficLightPosition option gives VS Code's own compact hiddenInset
// title bar, done here by hand since Wails v3 (pinned beta.16)'s MacTitleBar has no equivalent
// option of its own (only AppearsTransparent/Hide/HideTitle/FullSizeContent/UseToolbar/
// HideToolbarSeparator/ShowToolbarWhenFullscreen/ToolbarStyle — nothing that touches button
// position). Horizontal spacing between the three buttons is measured off AppKit's own current
// layout rather than hardcoded, so this survives an OS version that changes it; only where the
// cluster as a whole sits is ours to decide.
//
// Every argument is a plain pointer/double, not an ARC-managed type, matching Wails' own
// webview_window_darwin.go convention (a plain C cast onto the NSWindow*, no __bridge) — this
// file compiles without -fobjc-arc, same as that one.
static void repositionTrafficLights(void *nsWindowPtr, double barHeight, double leftInset) {
    if (nsWindowPtr == NULL) {
        return;
    }
    @autoreleasepool {
        NSWindow *window = (NSWindow *)nsWindowPtr;
        NSButton *close = [window standardWindowButton:NSWindowCloseButton];
        NSButton *miniaturize = [window standardWindowButton:NSWindowMiniaturizeButton];
        NSButton *zoom = [window standardWindowButton:NSWindowZoomButton];
        if (close == nil || miniaturize == nil || zoom == nil || close.superview == nil) {
            return;
        }
        NSArray<NSButton *> *buttons = @[close, miniaturize, zoom];

        CGFloat spacing = NSMinX(miniaturize.frame) - NSMinX(close.frame);
        if (spacing <= 0) {
            // AppKit's own historical default gap, as a floor only — this branch means the
            // buttons weren't in their usual relative order yet (very early in window creation),
            // not that we've measured a real value of zero.
            spacing = 20;
        }
        CGFloat buttonDiameter = NSHeight(close.frame);
        CGFloat containerHeight = NSHeight(close.superview.frame);
        CGFloat y = containerHeight - barHeight + (barHeight - buttonDiameter) / 2.0;

        for (NSUInteger i = 0; i < buttons.count; i++) {
            NSRect frame = buttons[i].frame;
            frame.origin.x = leftInset + (CGFloat)i * spacing;
            frame.origin.y = y;
            [buttons[i] setFrameOrigin:frame.origin];
        }
    }
}
*/
import "C"

import "unsafe"

// repositionTrafficLightsImpl is RepositionTrafficLights' real, darwin-only body.
func repositionTrafficLightsImpl(nativeWindow unsafe.Pointer, barHeight, leftInset float64) {
	if nativeWindow == nil {
		return
	}
	C.repositionTrafficLights(nativeWindow, C.double(barHeight), C.double(leftInset))
}
