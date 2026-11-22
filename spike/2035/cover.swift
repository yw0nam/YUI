// SPIKE #2035: "another app" covering the settings window: a plain normal-level window at a rect.
//   spike-cover <x> <y> <w> <h> <seconds> [activate]
// Without `activate` it is ordered front without taking focus (orderFrontRegardless).
// With `activate` this process becomes the active app, so YUI's windows lose focus (blur).
import Cocoa

let a = CommandLine.arguments
let n = a[1...4].map { Double($0)! }
let secs = Double(a[5])!
let app = NSApplication.shared
app.setActivationPolicy(.accessory)
let screenH = NSScreen.screens[0].frame.height
let rect = NSRect(x: n[0], y: screenH - n[1] - n[3], width: n[2], height: n[3])
let win = NSWindow(contentRect: rect, styleMask: [.titled], backing: .buffered, defer: false)
win.title = "spike-cover"
win.backgroundColor = .systemTeal
win.level = .normal
if a.count > 6 && a[6] == "activate" {
  app.activate(ignoringOtherApps: true)
  win.makeKeyAndOrderFront(nil)
} else {
  win.orderFrontRegardless()
}
print("cover_up \(Int(Date().timeIntervalSince1970 * 1000))")
fflush(stdout)
DispatchQueue.main.asyncAfter(deadline: .now() + secs) { app.terminate(nil) }
app.run()
