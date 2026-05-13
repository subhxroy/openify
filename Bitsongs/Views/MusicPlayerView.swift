import SwiftUI
import AppKit

// MARK: - Root View
struct MusicPlayerView: View {
    @ObservedObject var viewModel: MusicPlayerViewModel
    @State private var vinylDegrees: Double = 0
    @State private var vinylTimer: Timer? = nil

    var body: some View {
        GeometryReader { geo in
            ZStack(alignment: .topLeading) {
                // ── Split background ──────────────────────────────────────
                SplitBackground(geo: geo)

                // ── Main 3-column layout ──────────────────────────────────
                HStack(spacing: 0) {
                    LeftPanel(viewModel: viewModel, geo: geo)
                    CenterPanel(viewModel: viewModel,
                                vinylDegrees: $vinylDegrees,
                                geo: geo)
                    RightPanel(viewModel: viewModel, geo: geo)
                }

            }
        }

        .onChange(of: viewModel.isPlaying) { playing in
            playing ? startVinyl() : stopVinyl()
        }
        .onAppear {
            if viewModel.isPlaying { startVinyl() }
        }
    }

    // MARK: - Vinyl rotation helpers
    private func startVinyl() {
        stopVinyl()
        // 33 RPM ≈ 1 rotation per 1.818 s
        vinylTimer = Timer.scheduledTimer(withTimeInterval: 1.0/60.0, repeats: true) { _ in
         vinylDegrees = (vinylDegrees + 360.0 / (6.0 * 60.0)).truncatingRemainder(dividingBy: 360)
}
    }

    private func stopVinyl() {
        vinylTimer?.invalidate()
        vinylTimer = nil
    }
}

// MARK: - Split Background
private struct SplitBackground: View {
    let geo: GeometryProxy
    var body: some View {
        ZStack {
            Color(hex: "#212842").ignoresSafeArea() // Midnight Indigo
            Path { p in
                let w = geo.size.width, h = geo.size.height
                let x = w * 0.52
                p.move(to: CGPoint(x: x, y: 0))
                p.addLine(to: CGPoint(x: w, y: 0))
                p.addLine(to: CGPoint(x: w, y: h))
                p.addLine(to: CGPoint(x: x - 100, y: h))
                p.closeSubpath()
            }
            .fill(Color(hex: "#F0E7D5")) // Vanilla Cream
        }
    }
}

// MARK: - Left Panel (song list + search)
private struct LeftPanel: View {
    @ObservedObject var viewModel: MusicPlayerViewModel
    let geo: GeometryProxy

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            // Brand
            HStack(spacing: 9) {
                ZStack {
                    RoundedRectangle(cornerRadius: 7)
                        .fill(Color.white)
                        .frame(width: 26, height: 26)
                    Image(systemName: "record.circle.fill")
                        .font(.system(size: 14, weight: .bold))
                        .foregroundColor(Color(hex: "#111111"))
                }
                Text("DayDreamin")
                    .font(.system(size: 11, weight: .semibold))
                    .foregroundColor(.white.opacity(0.55))
                    .tracking(0.4)
            }
            .padding(.top, 54).padding(.horizontal, 20)

            // Search bar
            HStack(spacing: 8) {
                Image(systemName: "magnifyingglass")
                    .font(.system(size: 11))
                    .foregroundColor(.white.opacity(0.35))
                TextField("Search…", text: $viewModel.searchText)
                        .onChange(of: viewModel.searchText) { text in
                            viewModel.onSearchTextChanged(text)
                        }
                    .font(.system(size: 12))
                    .foregroundColor(.white.opacity(0.85))
                    .textFieldStyle(.plain)
                    .autocorrectionDisabled()
                if !viewModel.searchText.isEmpty {
                    Button {
                        viewModel.searchText = ""
                        viewModel.cancelSearch()
                    } label: {
                        Image(systemName: "xmark.circle.fill")
                            .font(.system(size: 11))
                            .foregroundColor(.white.opacity(0.3))
                    }
                    .buttonStyle(.plain)
                }
            }
            .padding(.horizontal, 10).padding(.vertical, 7)
            .background(Color.white.opacity(0.06))
            .clipShape(RoundedRectangle(cornerRadius: 9))
            .padding(.horizontal, 16).padding(.top, 18)

            // List header
            Text(viewModel.searchText.isEmpty ? "TRENDING" : "RESULTS")
                .font(.system(size: 9, weight: .heavy))
                .foregroundColor(.white.opacity(0.3))
                .tracking(3)
                .padding(.horizontal, 20).padding(.top, 18).padding(.bottom, 6)

            // Song list
            if viewModel.isLoading {
                VStack {
                    Spacer()
                    ProgressView().tint(.white.opacity(0.4)).scaleEffect(0.8)
                    Text("Loading…").font(.system(size: 11)).foregroundColor(.white.opacity(0.3)).padding(.top, 6)
                    Spacer()
                }
            } else if let err = viewModel.errorMessage, viewModel.songs.isEmpty {
                VStack(spacing: 8) {
                    Spacer()
                    Image(systemName: "wifi.slash").font(.system(size: 28)).foregroundColor(.white.opacity(0.2))
                    Text("Server offline").font(.system(size: 12, weight: .medium)).foregroundColor(.white.opacity(0.4))
                    Text(err).font(.system(size: 10)).foregroundColor(.white.opacity(0.25)).multilineTextAlignment(.center).padding(.horizontal, 16)
                    Button("Retry") { viewModel.loadChartSongs() }
                        .font(.system(size: 11, weight: .semibold)).foregroundColor(.white.opacity(0.6))
                        .padding(.horizontal, 16).padding(.vertical, 6)
                        .background(Color.white.opacity(0.08))
                        .clipShape(Capsule())
                        .buttonStyle(.plain)
                    Spacer()
                }
                .frame(maxWidth: .infinity)
            } else {
                let displaySongs = viewModel.isSearching ? viewModel.searchResults : viewModel.songs
                ScrollView(showsIndicators: false) {
                    LazyVStack(spacing: 0) {
                        if viewModel.isSearchLoading {
                            HStack(spacing: 6) {
                                ProgressView().tint(.white.opacity(0.4)).scaleEffect(0.7)
                                Text("Searching…").font(.system(size: 11)).foregroundColor(.white.opacity(0.3))
                            }
                            .padding(.vertical, 12)
                        } else {
                            ForEach(Array(displaySongs.prefix(40).enumerated()), id: \.element.id) { i, song in
                                SongRow(index: i + 1, song: song,
                                        isActive: viewModel.currentSong?.id == song.id,
                                        accent: viewModel.dominantColors.accent)
                                .onTapGesture {
                                    viewModel.selectSong(song, from: displaySongs)
                                }
                            }
                        }
                    }
                }
                .frame(height: geo.size.height * 0.55)
            }

            Spacer()
        }
        .frame(width: geo.size.width * 0.26)
    }
}

private struct SongRow: View {
    let index: Int
    let song: Song
    let isActive: Bool
    let accent: Color

    var body: some View {
        HStack(spacing: 10) {
            Text(String(format: "%02d", index))
                .font(.system(size: 10, weight: .medium, design: .monospaced))
                .foregroundColor(.white.opacity(isActive ? 0.45 : 0.18))
                .frame(width: 20)

            ZStack {
                RoundedRectangle(cornerRadius: 5)
                    .fill(isActive ? accent : Color.white.opacity(0.09))
                    .frame(width: 20, height: 20)
                Image(systemName: isActive ? "pause.fill" : "play.fill")
                    .font(.system(size: 7, weight: .bold))
                    .foregroundColor(.white)
            }

            VStack(alignment: .leading, spacing: 2) {
                Text(song.title)
                    .font(.system(size: 12, weight: .medium))
                    .foregroundColor(.white.opacity(isActive ? 1 : 0.32))
                    .lineLimit(1)
                Text(song.artist)
                    .font(.system(size: 10))
                    .foregroundColor(.white.opacity(isActive ? 0.45 : 0.18))
                    .lineLimit(1)
            }

            Spacer()
        }
        .padding(.horizontal, 20).padding(.vertical, 8)
        .background(isActive ? Color.white.opacity(0.05) : Color.clear)
        .contentShape(Rectangle())
    }
}

// MARK: - Center Panel (vinyl + controls)
private struct CenterPanel: View {
    @ObservedObject var viewModel: MusicPlayerViewModel
    @Binding var vinylDegrees: Double
    let geo: GeometryProxy

    private var discSize: CGFloat { min(geo.size.height * 0.72, 460) }

    var body: some View {
        ZStack {
            // Vinyl disc
            VinylDisc(degrees: vinylDegrees,
                      song: viewModel.currentSong,
                      accent: viewModel.dominantColors.accent)
                .frame(width: discSize, height: discSize)
                .offset(x: 0, y: -geo.size.height * 0.05)

            // Needle
            NeedleArm(isPlaying: viewModel.isPlaying, discSize: discSize)
                .frame(width: 130, height: 180)
                .offset(x: discSize * 0.42, y: -geo.size.height * 0.05 - discSize * 0.3)

            // Player controls bar
            PlayerControls(viewModel: viewModel)
                .padding(.horizontal, 24)
                .frame(maxHeight: .infinity, alignment: .bottom)
                .padding(.bottom, 28)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
    }
}

// MARK: - Vinyl Disc
private struct VinylDisc: View {
    let degrees: Double
    let song: Song?
    let accent: Color

    var body: some View {
        ZStack {
            // Base plate
            Circle().fill(Color(hex: "#080808"))

            // Static reflection (does NOT rotate)
            Circle()
                .fill(
                    AngularGradient(gradient: Gradient(stops: [
                        .init(color: .clear,                   location: 0.00),
                        .init(color: .white.opacity(0.09),     location: 0.12),
                        .init(color: .clear,                   location: 0.22),
                        .init(color: .white.opacity(0.04),     location: 0.55),
                        .init(color: .clear,                   location: 0.70),
                        .init(color: .white.opacity(0.07),     location: 0.88),
                        .init(color: .clear,                   location: 1.00),
                    ]), center: .center)
                )

            // Grooves + label — these rotate
            ZStack {
                GrooveCanvas()
                CenterLabel(song: song, accent: accent)
            }
            .rotationEffect(.degrees(degrees))
        }
        .shadow(color: .black.opacity(0.65), radius: 44, x: 12, y: 20)
    }
}

private struct GrooveCanvas: View {
    var body: some View {
        Canvas { ctx, size in
            let cx = size.width / 2, cy = size.height / 2
            let maxR = min(cx, cy) * 0.97
            let minR = min(cx, cy) * 0.28
            var r = minR
            while r < maxR {
                let opacity = Double.random(in: 0.04...0.12)
                ctx.stroke(
                    Path(ellipseIn: CGRect(x: cx-r, y: cy-r, width: r*2, height: r*2)),
                    with: .color(.white.opacity(opacity)),
                    lineWidth: 0.6
                )
                r += 4.0
            }
        }
    }
}

private struct CenterLabel: View {
    let song: Song?
    let accent: Color

    var body: some View {
        ZStack {
            Circle().fill(accent.opacity(0.8)).frame(width: 110, height: 110)
            Circle().fill(Color(hex: "#111111")).frame(width: 36, height: 36)

            if let song = song {
                AsyncImage(url: URL(string: song.cover)) { phase in
                    if case .success(let img) = phase {
                        img.resizable().aspectRatio(contentMode: .fill)
                    } else {
                        Circle().fill(accent.opacity(0.3))
                    }
                }
                .frame(width: 104, height: 104)
                .clipShape(Circle())
                .allowsHitTesting(false)

                Circle().fill(Color(hex: "#111111")).frame(width: 34, height: 34)
            }

            Circle().fill(Color.black).frame(width: 10, height: 10)
        }
    }
}

// MARK: - Needle Arm
private struct NeedleArm: View {
    let isPlaying: Bool
    let discSize: CGFloat
    var angle: Double { isPlaying ? 26 : 3 }

    var body: some View {
        GeometryReader { g in
            ZStack(alignment: .top) {
                // Arm body
                RoundedRectangle(cornerRadius: 2.5)
                    .fill(LinearGradient(colors: [Color(hex:"#606060"), Color(hex:"#2A2A2A")],
                                        startPoint: .leading, endPoint: .trailing))
                    .frame(width: 6, height: g.size.height * 0.72)
                    .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topTrailing)
                    .padding(.trailing, 24).padding(.top, 14)

                // Cartridge
                Capsule()
                    .fill(Color(hex: "#383838"))
                    .frame(width: 14, height: 20)
                    .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .bottomTrailing)
                    .padding(.trailing, 19)

                // Pivot dot
                Circle()
                    .fill(Color(hex: "#303030"))
                    .frame(width: 24, height: 24)
                    .overlay(Circle().stroke(Color.white.opacity(0.18), lineWidth: 1))
                    .frame(maxWidth: .infinity, alignment: .trailing)
                    .padding(.trailing, 13)
            }
        }
        .rotationEffect(.degrees(angle), anchor: UnitPoint(x: 0.92, y: 0.06))
        .animation(.easeInOut(duration: 0.65), value: isPlaying)
    }
}

// MARK: - Player Controls Bar
private struct PlayerControls: View {
    @ObservedObject var viewModel: MusicPlayerViewModel
    @State private var volume: Double = 0.75

    var body: some View {
        HStack(spacing: 0) {
            // ── Playback buttons ──────────────────────────────────
            HStack(spacing: 16) {
                Button { viewModel.playPrevious() } label: {
                    Image(systemName: "backward.fill")
                        .font(.system(size: 14, weight: .semibold))
                        .foregroundColor(.white.opacity(0.7))
                }
                .buttonStyle(.plain)

                Button { viewModel.togglePlayPause() } label: {
                    ZStack {
                        Circle()
                            .fill(Color(hex: "#1A1A1A"))
                            .frame(width: 44, height: 44)
                            .shadow(color: .black.opacity(0.4), radius: 8, x: 0, y: 4)
                        Image(systemName: viewModel.isPlaying ? "pause.fill" : "play.fill")
                            .font(.system(size: 16, weight: .bold))
                            .foregroundColor(.white)
                    }
                }
                .buttonStyle(.plain)

                Button { viewModel.playNext() } label: {
                    Image(systemName: "forward.fill")
                        .font(.system(size: 14, weight: .semibold))
                        .foregroundColor(.white.opacity(0.7))
                }
                .buttonStyle(.plain)
            }
            .padding(.leading, 18)

            Spacer()

            // ── Progress ─────────────────────────────────────────
            VStack(spacing: 5) {
                SeekBar(progress: viewModel.progress) { pct in
                    viewModel.seekToProgress(pct)
                }
                .frame(height: 10)

                HStack {
                    Text(viewModel.currentTimeString)
                    Spacer()
                    if viewModel.isBuffering {
                        Text("Buffering…").italic()
                    }
                    Spacer()
                    Text(viewModel.durationString)
                }
                .font(.system(size: 9, weight: .medium, design: .monospaced))
                .foregroundColor(.white.opacity(0.4))
            }
            .frame(maxWidth: 200)

            Spacer()

            // ── Volume ───────────────────────────────────────────
            HStack(spacing: 7) {
                Image(systemName: volume < 0.02 ? "speaker.slash.fill" : "speaker.wave.2.fill")
                    .font(.system(size: 11))
                    .foregroundColor(.white.opacity(0.55))
                Slider(value: $volume, in: 0...1)
                    .frame(width: 72)
                    .tint(.white.opacity(0.7))
                    .onChange(of: volume) { v in
                        viewModel.setVolume(Float(v))
                    }
            }
            .padding(.trailing, 18)
        }
        .padding(.vertical, 13)
        .background(.ultraThinMaterial, in: RoundedRectangle(cornerRadius: 26, style: .continuous))
        .overlay(
            RoundedRectangle(cornerRadius: 26, style: .continuous)
                .stroke(Color.white.opacity(0.12), lineWidth: 0.5)
        )
        .environment(\.colorScheme, .dark)
    }
}

// MARK: - Seek Bar
private struct SeekBar: View {
    let progress: Double
    let onSeek: (Double) -> Void

    var body: some View {
        GeometryReader { g in
            let filled = g.size.width * progress
            ZStack(alignment: .leading) {
                Capsule().fill(Color.white.opacity(0.18)).frame(height: 3)
                Capsule()
                    .fill(Color(hex: "#1A1A1A").opacity(0.9))
                    .frame(width: max(0, filled), height: 3)
                Circle()
                    .fill(Color(hex: "#E8E4DA"))
                    .frame(width: 10, height: 10)
                    .shadow(color: .black.opacity(0.3), radius: 2)
                    .offset(x: max(0, filled - 5))
            }
            .contentShape(Rectangle())
            .gesture(
                DragGesture(minimumDistance: 0).onChanged { val in
                    onSeek(max(0, min(1, val.location.x / g.size.width)))
                }
            )
        }
    }
}

// MARK: - Right Panel (artwork + info)
private struct RightPanel: View {
    @ObservedObject var viewModel: MusicPlayerViewModel
    let geo: GeometryProxy

    var body: some View {
        VStack(spacing: 0) {
            Spacer()

            if let song = viewModel.currentSong {
                // Artwork
                AsyncImage(url: URL(string: song.coverXL.isEmpty ? song.cover : song.coverXL)) { phase in
                    switch phase {
                    case .success(let img):
                        img.resizable().aspectRatio(contentMode: .fill)
                    case .failure:
                        RoundedRectangle(cornerRadius: 28)
                            .fill(viewModel.dominantColors.primary.opacity(0.35))
                            .overlay(Image(systemName: "music.note")
                                .font(.system(size: 32)).foregroundColor(.white.opacity(0.3)))
                    default:
                        RoundedRectangle(cornerRadius: 28)
                            .fill(Color(hex: "#111111").opacity(0.4))
                            .overlay(ProgressView().tint(viewModel.dominantColors.accent))
                    }
                }
                .frame(width: 148, height: 148)
                .clipShape(RoundedRectangle(cornerRadius: 28, style: .continuous))
                .overlay(
                    RoundedRectangle(cornerRadius: 28, style: .continuous)
                        .stroke(Color.white.opacity(0.55), lineWidth: 2)
                )
                .shadow(color: .black.opacity(0.4), radius: 32, x: 0, y: 16)
                .id(song.id)
                .transition(.scale(scale: 0.92).combined(with: .opacity))

                // Song title
                VStack(spacing: 5) {
                    Text(song.title)
                        .font(.system(size: 17, weight: .bold))
                        .foregroundColor(Color(hex: "#1A1A1A"))
                        .tracking(-0.4)
                        .multilineTextAlignment(.center)
                        .lineLimit(2)
                        .minimumScaleFactor(0.8)

                    Text(song.artist.uppercased())
                        .font(.system(size: 10, weight: .bold))
                        .foregroundColor(Color(hex: "#1A1A1A").opacity(0.5))
                        .tracking(4)
                        .multilineTextAlignment(.center)
                        .lineLimit(1)
                }
                .padding(.top, 20)
                .padding(.horizontal, 16)
                .animation(.easeInOut(duration: 0.4), value: song.id)

            } else {
                // Empty state
                VStack(spacing: 10) {
                    Image(systemName: "record.circle")
                        .font(.system(size: 44))
                        .foregroundColor(Color(hex: "#1A1A1A").opacity(0.2))
                    Text("Nothing playing")
                        .font(.system(size: 13))
                        .foregroundColor(Color(hex: "#1A1A1A").opacity(0.35))
                }
            }

            Spacer()
        }
        .frame(width: geo.size.width * 0.24)
        .animation(.spring(response: 0.4, dampingFraction: 0.8), value: viewModel.currentSong?.id)
    }
}

// MARK: - Color helpers
private extension Color {
    init(hex: String) {
        let h = hex.trimmingCharacters(in: CharacterSet.alphanumerics.inverted)
        var int: UInt64 = 0
        Scanner(string: h).scanHexInt64(&int)
        let a, r, g, b: UInt64
        switch h.count {
        case 3:  (a,r,g,b) = (255,(int>>8)*17,(int>>4 & 0xF)*17,(int & 0xF)*17)
        case 6:  (a,r,g,b) = (255,int>>16,int>>8 & 0xFF,int & 0xFF)
        case 8:  (a,r,g,b) = (int>>24,int>>16 & 0xFF,int>>8 & 0xFF,int & 0xFF)
        default: (a,r,g,b) = (255,0,0,0)
        }
        self.init(.sRGB, red: Double(r)/255, green: Double(g)/255, blue: Double(b)/255, opacity: Double(a)/255)
    }
    init(r: Int, g: Int, b: Int) {
        self.init(.sRGB, red: Double(r)/255, green: Double(g)/255, blue: Double(b)/255)
    }
}

#Preview {
    MusicPlayerView(viewModel: MusicPlayerViewModel())
        .frame(width: 1100, height: 700)
}
