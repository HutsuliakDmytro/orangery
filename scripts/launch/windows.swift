import CoreGraphics
import Foundation
let list = CGWindowListCopyWindowInfo([.optionOnScreenOnly], kCGNullWindowID) as? [[String: Any]] ?? []
for w in list {
  let owner = w[kCGWindowOwnerName as String] as? String ?? ""
  guard owner.contains("Orangery") || owner.hasPrefix("orangery") else { continue }
  let id = w[kCGWindowNumber as String] as? Int ?? 0
  let layer = w[kCGWindowLayer as String] as? Int ?? 0
  let name = w[kCGWindowName as String] as? String ?? ""
  let b = w[kCGWindowBounds as String] as? [String: Any] ?? [:]
  if layer == 0 { print("\(id)\t\(owner)\t\(name)\t\(b["Width"] ?? 0)x\(b["Height"] ?? 0)") }
}
