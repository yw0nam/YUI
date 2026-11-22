// SPIKE #1971 (never merged): one helper process that stands in for "another app" and asks the window server
// questions without posting mouse events. Reads one command per stdin line, answers one JSON line on stdout.
// Coordinates are global logical points, top-left origin (as Tauri and CGWindowList report them).
//   cover x y w h        a normal-level window of this process at the rect, ordered front without activating
//   uncover              close it
//   activate             make this process the active app and its cover the key window (an app switch)
//   hit x y              windowNumberAtPoint: the window a mouse-down at the point would hit, with its owner
//   watch x y ms         poll `hit` every 1 ms for ms; every change with its epoch ms
//   zorder x y w h       every on-screen window intersecting the rect, front first, with layer and owner pid
//   screens              each NSScreen frame, visibleFrame and backing scale
//   app pid              activationPolicy, isActive, isHidden of a process
//   front                the frontmost app (NSWorkspace)
//   keys pid text        CGEventPostToPid: the text as unicode key events, `\t` = Tab, `\e` = Escape (no window routing)
//   back x y w h         a second own window, ordered behind the cover (for the ignoresMouseEvents control)
//   ignore 0|1           set the cover's ignoresMouseEvents
//   restore pid          activate that app again (the owner's front app after a run)
import Cocoa

let app = NSApplication.shared
app.setActivationPolicy(.accessory)
var cover: NSWindow?
var extra: [NSWindow] = []
func screenH() -> CGFloat { NSScreen.screens[0].frame.height }
func cocoaRect(_ x: Double, _ y: Double, _ w: Double, _ h: Double) -> NSRect {
  NSRect(x: x, y: Double(screenH()) - y - h, width: w, height: h)
}
func now() -> Int { Int(Date().timeIntervalSince1970 * 1000) }
func emit(_ o: [String: Any]) {
  print(String(data: try! JSONSerialization.data(withJSONObject: o), encoding: .utf8)!)
  fflush(stdout)
}
func windowInfo() -> [[String: Any]] {
  CGWindowListCopyWindowInfo([.optionOnScreenOnly], kCGNullWindowID) as? [[String: Any]] ?? []
}
func isKnown(_ name: String, _ pid: Int) -> Bool {
  name.hasPrefix("YUI") || pid == Int(getpid())
    || ["Dock", "Window Server", "SystemUIServer", "Control Center", "WindowManager"].contains(name)
}
func ownerOf(_ num: Int) -> [String: Any] {
  for w in windowInfo() where (w[kCGWindowNumber as String] as? Int) == num {
    let pid = w[kCGWindowOwnerPID as String] as? Int ?? 0
    let name = w[kCGWindowOwnerName as String] as? String ?? ""
    return ["pid": pid, "owner": isKnown(name, pid) ? name : "other", "layer": w[kCGWindowLayer as String] as? Int ?? 0]
  }
  return ["pid": 0, "owner": "none"]
}
func hit(_ x: Double, _ y: Double) -> Int {
  NSWindow.windowNumber(at: NSPoint(x: x, y: Double(screenH()) - y), belowWindowWithWindowNumber: 0)
}
func makeWindow(_ r: NSRect, _ color: NSColor) -> NSWindow {
  let w = NSWindow(contentRect: r, styleMask: [.titled], backing: .buffered, defer: false)
  w.title = "spike-cover"
  w.backgroundColor = color
  w.level = .normal
  w.isReleasedWhenClosed = false
  return w
}

func handle(_ line: String) {
  let p = line.split(separator: " ").map(String.init)
  guard let cmd = p.first else { return }
  let n = p.dropFirst().compactMap { Double($0) }
  switch cmd {
  case "cover":
    cover?.close()
    let w = makeWindow(cocoaRect(n[0], n[1], n[2], n[3]), .systemTeal)
    w.orderFrontRegardless()
    cover = w
    emit(["cmd": cmd, "window": w.windowNumber, "at": now()])
  case "uncover":
    cover?.close(); cover = nil
    emit(["cmd": cmd])
  case "activate":
    app.activate(ignoringOtherApps: true)
    cover?.makeKeyAndOrderFront(nil)
    emit(["cmd": cmd, "at": now()])
  case "hit":
    let num = hit(n[0], n[1])
    var o: [String: Any] = ["cmd": cmd, "x": n[0], "y": n[1], "window": num, "cover": cover?.windowNumber ?? 0]
    for (k, v) in ownerOf(num) { o[k] = v }
    emit(o)
  case "watch":
    let end = Date().addingTimeInterval(n[2] / 1000)
    var last = -1
    var changes: [[String: Any]] = []
    while Date() < end {
      let num = hit(n[0], n[1])
      if num != last { changes.append(["at": now(), "window": num]); last = num }
      usleep(1000)
    }
    emit(["cmd": cmd, "changes": changes, "cover": cover?.windowNumber ?? 0])
  case "zorder":
    let r = CGRect(x: n[0], y: n[1], width: n[2], height: n[3])
    var out: [[String: Any]] = []
    for w in windowInfo() {
      let b = w[kCGWindowBounds as String] as? [String: CGFloat] ?? [:]
      let f = CGRect(x: b["X"] ?? 0, y: b["Y"] ?? 0, width: b["Width"] ?? 0, height: b["Height"] ?? 0)
      guard f.intersects(r), f.width > 1, f.height > 1 else { continue }
      let name = w[kCGWindowOwnerName as String] as? String ?? ""
      let pid = w[kCGWindowOwnerPID as String] as? Int ?? 0
      out.append(["id": w[kCGWindowNumber as String] as? Int ?? 0, "owner": isKnown(name, pid) ? name : "other", "pid": pid,
                  "layer": w[kCGWindowLayer as String] as? Int ?? 0, "x": Int(f.minX), "y": Int(f.minY), "w": Int(f.width), "h": Int(f.height)])
    }
    emit(["cmd": cmd, "windows": out])
  case "screens":
    emit(["cmd": cmd, "screens": NSScreen.screens.map { s -> [String: Any] in
      ["frame": [s.frame.minX, s.frame.minY, s.frame.width, s.frame.height],
       "visible": [s.visibleFrame.minX, s.visibleFrame.minY, s.visibleFrame.width, s.visibleFrame.height],
       "scale": s.backingScaleFactor, "menuBarH": s.frame.maxY - s.visibleFrame.maxY, "dockBottomH": s.visibleFrame.minY - s.frame.minY] }])
  case "app":
    if let a = NSRunningApplication(processIdentifier: pid_t(n[0])) {
      emit(["cmd": cmd, "policy": ["regular", "accessory", "prohibited"][a.activationPolicy.rawValue], "active": a.isActive, "hidden": a.isHidden])
    } else { emit(["cmd": cmd, "error": "no such app"]) }
  case "front":
    let f = NSWorkspace.shared.frontmostApplication
    let name = f?.localizedName ?? ""
    let pid = Int(f?.processIdentifier ?? 0)
    emit(["cmd": cmd, "pid": pid, "name": isKnown(name, pid) ? name : "other", "at": now()])
  case "keys":
    let pid = pid_t(n[0])
    let text = p.dropFirst(2).joined(separator: " ")
    let src = CGEventSource(stateID: .hidSystemState)
    var i = text.startIndex
    var sent = 0
    while i < text.endIndex {
      var code: CGKeyCode = 0
      var uni: [UniChar] = []
      if text[i] == "\\", text.index(after: i) < text.endIndex {
        let c = text[text.index(after: i)]
        code = c == "t" ? 48 : c == "e" ? 53 : 0
        i = text.index(i, offsetBy: 2)
      } else {
        uni = Array(String(text[i]).utf16)
        i = text.index(after: i)
      }
      for down in [true, false] {
        let e = CGEvent(keyboardEventSource: src, virtualKey: code, keyDown: down)!
        if !uni.isEmpty { e.keyboardSetUnicodeString(stringLength: uni.count, unicodeString: uni) }
        e.postToPid(pid)
      }
      sent += 1
      usleep(30000)
    }
    emit(["cmd": cmd, "sent": sent, "ax_trusted": AXIsProcessTrusted()])
  case "restore":
    let ok = NSRunningApplication(processIdentifier: pid_t(n[0]))?.activate(options: []) ?? false
    emit(["cmd": cmd, "ok": ok, "at": now()])
  case "ignore":
    cover?.ignoresMouseEvents = n[0] != 0
    emit(["cmd": cmd, "ignores": cover?.ignoresMouseEvents ?? false])
  case "back":
    let w = makeWindow(cocoaRect(n[0], n[1], n[2], n[3]), .systemRed)
    w.orderFrontRegardless()
    cover?.orderFrontRegardless()
    extra.append(w)
    emit(["cmd": cmd, "window": w.windowNumber])
  default:
    emit(["cmd": cmd, "error": "unknown"])
  }
}

Thread {
  while let line = readLine() {
    let l = line.trimmingCharacters(in: .whitespaces)
    if l == "quit" { DispatchQueue.main.async { app.terminate(nil) }; return }
    DispatchQueue.main.sync { handle(l) }
  }
  DispatchQueue.main.async { app.terminate(nil) }
}.start()
emit(["ready": true, "pid": Int(getpid())])
app.run()
