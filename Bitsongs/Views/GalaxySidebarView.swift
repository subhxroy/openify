import SwiftUI

private struct StarSong: Identifiable {
    let id: String
    let song: Song
    var x: CGFloat
    var y: CGFloat
    var size: CGFloat
    var drift: CGFloat
    var phase: Double
    var speed: Double
}

struct GalaxySidebarView: View {
    @ObservedObject var viewModel: MusicPlayerViewModel
    @Binding var expandedWidth: CGFloat

    @State private var stars: [StarSong] = []
    @State private var hoveredID: String? = nil
    @State private var time: Double = 0
    @State private var timer: Timer? = nil

    private let collapsed: CGFloat = 68
    private let expanded: CGFloat = 320
    private var isExpanded: Bool { expandedWidth > collapsed + 10 }

    var body: some View {
        GeometryReader { geo in
            ZStack {
                spaceBackground(geo: geo)

                ForEach(stars) { star in
                    starThumbnail(star: star, geo: geo)
                }

                if !isExpanded {
                    collapsedHint
                }
            }
            .clipped()
            .onChange(of: viewModel.songs) { songs in
                buildStars(songs: songs, size: geo.size)
            }
            .onAppear {
                buildStars(songs: viewModel.songs, size: geo.size)
                startTimer()
            }
            .onDisappear { timer?.invalidate() }
        }
    }

    // MARK: - Space Background
    private func spaceBackground(geo: GeometryProxy) -> some View {
        ZStack {
            LinearGradient(
                colors: [
                    Color(red: 0.02, green: 0.01, blue: 0.06),
                    Color(red: 0.05, green: 0.02, blue: 0.12),
                    Color(red: 0.01, green: 0.01, blue: 0.04)
                ],
                startPoint: .top, endPoint: .bottom
            )
            .ignoresSafeArea()

            Canvas { ctx, size in
                let rng = SystemRandomNumberGenerator()
                var r = rng
                for _ in 0..<120 {
                    let x = CGFloat.random(in: 0...size.width, using: &r)
                    let y = CGFloat.random(in: 0...size.height, using: &r)
                    let s = CGFloat.random(in: 0.5...1.8, using: &r)
                    let op = Double.random(in: 0.2...0.7, using: &r)
                    ctx.fill(
                        Path(ellipseIn: CGRect(x: x, y: y, width: s, height: s)),
                        with: .color(.white.opacity(op))
                    )
                }
            }

            RadialGradient(
                colors: [
                    viewModel.dominantColors.accent.opacity(0.18),
                    viewModel.dominantColors.primary.opacity(0.10),
                    .clear
                ],
                center: .center,
                startRadius: 20,
                endRadius: max(geo.size.width, geo.size.height)
            )
            .animation(.easeInOut(duration: 2), value: viewModel.dominantColors.accent)
        }
    }

    // MARK: - Star Thumbnail
    private func starThumbnail(star: StarSong, geo: GeometryProxy) -> some View {
        let isHovered = hoveredID == star.id
        let isCurrent = viewModel.currentSong?.id == star.id
        let floatOffset = sin(time * star.speed + star.phase) * 4.0
        let displaySize: CGFloat = isHovered ? min(star.size * 2.4, 90) : star.size

        return AsyncImage(url: URL(string: star.song.cover)) { phase in
            switch phase {
            case .success(let img):
                img.resizable().aspectRatio(contentMode: .fill)
            default:
                ZStack {
                    Circle().fill(viewModel.dominantColors.primary.opacity(0.5))
                    Image(systemName: "music.note")
                        .font(.system(size: displaySize * 0.35))
                        .foregroundStyle(.white.opacity(0.6))
                }
            }
        }
        .frame(width: displaySize, height: displaySize)
        .clipShape(Circle())
        .overlay(
            Circle()
                .stroke(
                    isCurrent ? viewModel.dominantColors.accent : Color.white.opacity(isHovered ? 0.6 : 0.18),
                    lineWidth: isCurrent ? 2 : 1
                )
        )
        .shadow(
            color: isCurrent ? viewModel.dominantColors.accent.opacity(0.8) : Color.white.opacity(isHovered ? 0.4 : 0.1),
            radius: isCurrent ? 12 : (isHovered ? 8 : 3)
        )
        .scaleEffect(isHovered ? 1.0 : 0.95)
        .position(
            x: clamp(star.x * geo.size.width, min: displaySize / 2 + 4, max: geo.size.width - displaySize / 2 - 4),
            y: clamp(star.y * geo.size.height + floatOffset, min: displaySize / 2 + 4, max: geo.size.height - displaySize / 2 - 4)
        )
        .animation(.spring(response: 0.3, dampingFraction: 0.7), value: isHovered)
        .animation(.spring(response: 0.3, dampingFraction: 0.7), value: isCurrent)
        .onHover { hovering in
            hoveredID = hovering ? star.id : (hoveredID == star.id ? nil : hoveredID)
        }
        .onTapGesture {
            viewModel.selectSong(star.song, from: viewModel.songs)
        }
        .zIndex(isHovered || isCurrent ? 10 : 0)
    }

    // MARK: - Collapsed hint
    private var collapsedHint: some View {
        VStack(spacing: 6) {
            Image(systemName: "music.note.list")
                .font(.system(size: 14, weight: .semibold))
                .foregroundStyle(.white.opacity(0.4))
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .bottom)
        .padding(.bottom, 16)
    }

    // MARK: - Star layout builder
    private func buildStars(songs: [Song], size: CGSize) {
        guard !songs.isEmpty else { return }
        var result: [StarSong] = []
        var rng = SeededRNG(seed: 42)
        for song in songs.prefix(80) {
            let x = CGFloat.random(in: 0.08...0.92, using: &rng)
            let y = CGFloat.random(in: 0.05...0.95, using: &rng)
            let sz = CGFloat.random(in: 28...54, using: &rng)
            let drift = CGFloat.random(in: -1...1, using: &rng)
            let phase = Double.random(in: 0...(2 * .pi), using: &rng)
            let speed = Double.random(in: 0.4...1.2, using: &rng)
            result.append(StarSong(id: song.id, song: song, x: x, y: y, size: sz, drift: drift, phase: phase, speed: speed))
        }
        stars = result
    }

    private func startTimer() {
        timer = Timer.scheduledTimer(withTimeInterval: 1.0 / 30.0, repeats: true) { _ in
            time += 1.0 / 30.0
        }
    }

    private func clamp(_ val: CGFloat, min minV: CGFloat, max maxV: CGFloat) -> CGFloat {
        Swift.max(minV, Swift.min(maxV, val))
    }
}

private struct SeededRNG: RandomNumberGenerator {
    private var state: UInt64
    init(seed: UInt64) { state = seed }
    mutating func next() -> UInt64 {
        state = state &* 6364136223846793005 &+ 1442695040888963407
        return state
    }
}
