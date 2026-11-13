import Foundation
import CoreServices

/// Recursive file-change watcher (FSEvents) for the project folder. Events are batched by `latency`
/// and delivered on the main queue as absolute paths.
final class FileWatcher {
    private var stream: FSEventStreamRef?
    private let handler: ([String]) -> Void

    init(path: String, latency: TimeInterval = 0.25, handler: @escaping ([String]) -> Void) {
        self.handler = handler
        var context = FSEventStreamContext(version: 0, info: Unmanaged.passUnretained(self).toOpaque(),
                                           retain: nil, release: nil, copyDescription: nil)
        let callback: FSEventStreamCallback = { _, info, count, eventPaths, eventFlags, _ in
            guard let info else { return }
            let watcher = Unmanaged<FileWatcher>.fromOpaque(info).takeUnretainedValue()
            let all = unsafeBitCast(eventPaths, to: NSArray.self) as? [String] ?? []
            // Only real content changes. macOS also reports metadata-only events (extended attributes,
            // quarantine/provenance stamps on a freshly built app), which must not trigger reloads.
            let content = UInt32(kFSEventStreamEventFlagItemCreated | kFSEventStreamEventFlagItemRemoved
                                 | kFSEventStreamEventFlagItemRenamed | kFSEventStreamEventFlagItemModified)
            var paths: [String] = []
            for i in 0..<min(count, all.count) where eventFlags[i] & content != 0 { paths.append(all[i]) }
            if !paths.isEmpty { watcher.handler(paths) }
        }
        let flags = UInt32(kFSEventStreamCreateFlagFileEvents | kFSEventStreamCreateFlagUseCFTypes | kFSEventStreamCreateFlagNoDefer)
        stream = FSEventStreamCreate(nil, callback, &context, [path] as CFArray,
                                     FSEventStreamEventId(kFSEventStreamEventIdSinceNow), latency, flags)
        if let stream {
            FSEventStreamSetDispatchQueue(stream, .main)
            FSEventStreamStart(stream)
        }
    }

    func stop() {
        guard let stream else { return }
        FSEventStreamStop(stream)
        FSEventStreamInvalidate(stream)
        FSEventStreamRelease(stream)
        self.stream = nil
    }

    deinit { stop() }
}
