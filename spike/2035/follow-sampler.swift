// SPIKE #2035: polls the on-screen frames of two windows (by window id) as fast as CGWindowList allows.
//   follow-sampler <leaderId> <followerId> <seconds>   prints JSON {polls, rows: [[t_ms, leaderX, followerX], ...]} (a row per change)
import Cocoa

let a = CommandLine.arguments
let leader = Int(a[1])!, follower = Int(a[2])!
let secs = Double(a[3])!
var rows: [[Double]] = []
var polls = 0
let start = Date()
while Date().timeIntervalSince(start) < secs {
  // A Swift [CGWindowID] bridges as NSNumbers, which CGWindowListCreateDescriptionFromArray ignores; filter the list.
  guard let list = CGWindowListCopyWindowInfo([.optionOnScreenOnly], kCGNullWindowID) as? [[String: Any]] else { continue }
  var xs: [Int: Double] = [:]
  for w in list {
    let id = w[kCGWindowNumber as String] as? Int ?? 0
    let b = w[kCGWindowBounds as String] as? [String: CGFloat] ?? [:]
    xs[id] = Double(b["X"] ?? 0)
  }
  polls += 1
  if let lx = xs[leader], let fx = xs[follower] {
    let t = Date().timeIntervalSince1970 * 1000
    if rows.last.map({ $0[1] != lx || $0[2] != fx }) ?? true { rows.append([t, lx, fx]) }
  }
  usleep(500)
}
print(String(data: try! JSONSerialization.data(withJSONObject: ["polls": polls, "rows": rows]), encoding: .utf8)!)
