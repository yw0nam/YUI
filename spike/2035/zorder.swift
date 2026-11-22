// SPIKE #2035: front-to-back order of on-screen windows that intersect a rect, with layer and owner.
//   zorder <x> <y> <w> <h>     prints JSON [{id, owner, layer, x, y, w, h}] front first
// Only windows of "YUI Verify" and "spike-cover" carry their owner name; others are reported as "other".
import Cocoa

let a = CommandLine.arguments.dropFirst().compactMap { Double($0) }
let r = a.count == 4 ? CGRect(x: a[0], y: a[1], width: a[2], height: a[3]) : CGRect.infinite
let list = CGWindowListCopyWindowInfo([.optionOnScreenOnly, .excludeDesktopElements], kCGNullWindowID) as? [[String: Any]] ?? []
var out: [[String: Any]] = []
for w in list {
  let b = w[kCGWindowBounds as String] as? [String: CGFloat] ?? [:]
  let f = CGRect(x: b["X"] ?? 0, y: b["Y"] ?? 0, width: b["Width"] ?? 0, height: b["Height"] ?? 0)
  guard f.intersects(r), f.width > 1, f.height > 1 else { continue }
  let o = w[kCGWindowOwnerName as String] as? String ?? ""
  let layer = w[kCGWindowLayer as String] as? Int ?? 0
  guard layer < 25 else { continue }  // menu bar, dock, overlays
  out.append([
    "id": w[kCGWindowNumber as String] as? Int ?? 0,
    "owner": (o == "YUI Verify" || o == "spike-cover") ? o : "other",
    "layer": layer, "x": Int(f.minX), "y": Int(f.minY), "w": Int(f.width), "h": Int(f.height),
  ])
}
print(String(data: try! JSONSerialization.data(withJSONObject: out), encoding: .utf8)!)
