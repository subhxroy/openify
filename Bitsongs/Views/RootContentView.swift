import SwiftUI

struct RootContentView: View {
    @StateObject private var viewModel = MusicPlayerViewModel()

    var body: some View {
        MusicPlayerView(viewModel: viewModel)
            .frame(minWidth: 1000, minHeight: 680)
            .preferredColorScheme(.dark)
    }
}
