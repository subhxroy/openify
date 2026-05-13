import SwiftUI

@main
struct BitsongApp: App {
    var body: some Scene {
        WindowGroup {
            RootContentView()
        }
        .windowStyle(.hiddenTitleBar)
        .defaultSize(width: 1100, height: 720)
        .windowResizability(.contentMinSize)
    }
}
