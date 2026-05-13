import AVFoundation
import CoreText
import MediaPlayer
import SwiftUI
import AppKit

private final class SessionAudioCache {
    static let shared = SessionAudioCache()

    private let fileManager = FileManager.default
    private let cacheDirectory: URL

    private init() {
        let cachesDirectory = fileManager.urls(for: .cachesDirectory, in: .userDomainMask).first!
        cacheDirectory = cachesDirectory.appendingPathComponent("bitsongs-session-audio", isDirectory: true)
        resetCacheForNewLaunch()
    }

    func cachedFileURL(for songID: String) -> URL? {
        let fileURL = cacheDirectory.appendingPathComponent("\(songID).m4a")
        return fileManager.fileExists(atPath: fileURL.path) ? fileURL : nil
    }

    func cacheIfNeeded(songID: String, remoteURL: URL, headers: [String: String]? = nil) async {
        guard cachedFileURL(for: songID) == nil else { return }

        var request = URLRequest(url: remoteURL)
        request.timeoutInterval = 60
        headers?.forEach { request.setValue($1, forHTTPHeaderField: $0) }

        do {
            let (temporaryURL, response) = try await URLSession.shared.download(for: request)
            guard let httpResponse = response as? HTTPURLResponse,
                  (200...299).contains(httpResponse.statusCode) else { return }

            let destinationURL = cacheDirectory.appendingPathComponent("\(songID).m4a")
            if fileManager.fileExists(atPath: destinationURL.path) {
                try? fileManager.removeItem(at: destinationURL)
            }
            try fileManager.moveItem(at: temporaryURL, to: destinationURL)
        } catch {
            // Session caching is best-effort and should not interrupt playback.
        }
    }

    private func resetCacheForNewLaunch() {
        if fileManager.fileExists(atPath: cacheDirectory.path) {
            try? fileManager.removeItem(at: cacheDirectory)
        }
        try? fileManager.createDirectory(at: cacheDirectory, withIntermediateDirectories: true)
    }
}

/// Main ViewModel managing the music player state, audio streaming, and theming
class MusicPlayerViewModel: ObservableObject {
    private enum StorageKeys {
        static let lastPlayedSong = "bitsongs.lastPlayedSong"
        static let recentSearches = "bitsongs.recentSearches"
    }

    // MARK: - Published Properties
    @Published var songs: [Song] = []
    @Published var currentSongIndex: Int = 0
    @Published var isPlaying: Bool = false
    @Published var currentTime: TimeInterval = 0
    @Published var duration: TimeInterval = 0
    @Published var searchText: String = ""
    @Published var isSearching: Bool = false
    @Published var dominantColors: ColorExtractor.DominantColors = .default
    @Published var isLoading: Bool = false
    @Published var isBuffering: Bool = false
    @Published var errorMessage: String?
    @Published var searchResults: [Song] = []
    @Published var isSearchLoading: Bool = false
    @Published var lyrics: LyricsResponse?
    @Published var isLyricsLoading: Bool = false
    @Published var serverConnected: Bool = false
    @Published var recommendations: [Song] = []
    @Published var upNextRecommendations: [Song] = []
    @Published var recentSearches: [String] = []
    @Published var recentSongs: [Song] = []
    @Published var showUpNext: Bool = false
    @Published var fontsLoaded: Bool = false

    // MARK: - Audio
    private var player: AVPlayer?
    private var playerItem: AVPlayerItem?
    private var timeObserver: Any?
    private var statusObserver: NSKeyValueObservation?
    private var bufferingObserver: NSKeyValueObservation?
    private var itemEndObserver: Any?
    private var itemFailedObserver: Any?
    private var itemStalledObserver: Any?
    private var colorExtractionTask: Task<Void, Never>?
    private var expectedSongDuration: TimeInterval = 0
    private var didTriggerAutoAdvanceForCurrentSong = false
    private var activeStreamInfo: StreamInfo?
    private var hasRetriedPlaybackWithFallback = false
    private var streamInfoCache: [String: StreamInfo] = [:]
    private var playbackHistory: [String] = []
    private let sessionAudioCache = SessionAudioCache.shared

    // Tracks the song ID being loaded to prevent race conditions
    private var loadingSongID: String?

    // MARK: - Network
    private let networkService = NetworkService.shared

    // MARK: - Search debounce
    private var searchTask: Task<Void, Never>?
    private let defaults = UserDefaults.standard

    // MARK: - Computed Properties
    var currentSong: Song? {
        guard !songs.isEmpty, currentSongIndex >= 0, currentSongIndex < songs.count else { return nil }
        return songs[currentSongIndex]
    }

    var upNextSongs: [Song] {
        if !upNextRecommendations.isEmpty { return upNextRecommendations }
        guard !songs.isEmpty else { return [] }
        let nextIndex = currentSongIndex + 1
        if nextIndex < songs.count { return Array(songs[nextIndex...]) }
        return []
    }

    var progress: Double {
        guard duration > 0 else { return 0 }
        return currentTime / duration
    }

    var currentTimeString: String { formatTime(currentTime) }
    var durationString: String { formatTime(duration) }
    var remainingTimeString: String { formatTime(max(0, duration - currentTime)) }

    // MARK: - Initialization
    init() {
        setupRemoteCommands()
        loadRecentSearches()
        loadCustomFonts()
        loadChartSongs()
    }

    deinit {
        if let observer = timeObserver { player?.removeTimeObserver(observer) }
        statusObserver?.invalidate()
        bufferingObserver?.invalidate()
        if let observer = itemEndObserver { NotificationCenter.default.removeObserver(observer) }
        if let observer = itemFailedObserver { NotificationCenter.default.removeObserver(observer) }
        if let observer = itemStalledObserver { NotificationCenter.default.removeObserver(observer) }
        NotificationCenter.default.removeObserver(self)
    }

    // MARK: - Audio Session (macOS: no AVAudioSession needed)

    // MARK: - Load Chart Songs
    func loadChartSongs() {
        isLoading = true
        errorMessage = nil
        Task { @MainActor in
            do {
                let chartSongs = try await networkService.getChart()
                self.serverConnected = true
                self.recommendations = []
                self.upNextRecommendations = []
                self.isLoading = false
                self.restoreStartupSong(from: chartSongs)
            } catch {
                self.serverConnected = false
                self.errorMessage = "Failed to load songs: \(error.localizedDescription)"
                self.isLoading = false
            }
        }
    }

    // MARK: - Search
    func onSearchTextChanged(_ text: String) {
    searchTask?.cancel()

    if text.isEmpty {
        searchResults = []
        isSearchLoading = false
        isSearching = false
        return
    }

    // Set searching true automatically when user types
    isSearching = true
    isSearchLoading = true

    searchTask = Task { @MainActor in
        do { try await Task.sleep(nanoseconds: 400_000_000) } catch { return }
        guard !Task.isCancelled else { return }
        do {
            let results = try await networkService.searchSongs(query: text)
            if !Task.isCancelled {
                self.searchResults = results
                self.isSearchLoading = false
            }
        } catch {
            if !Task.isCancelled {
                self.searchResults = []
                self.isSearchLoading = false
            }
        }
    }
}

    // MARK: - Load & Play Song
    func loadAndPlaySong(at index: Int, from songList: [Song]? = nil, recordHistory: Bool = true) {
        let previousSongID = shouldTrackCurrentSongForRecommendations ? currentSong?.id : nil
        let list = songList ?? songs
        guard index >= 0, index < list.count else { return }
        let previousCurrentSong = currentSong

        if let songList = songList {
            let song = songList[index]
            if let existingIndex = songs.firstIndex(where: { $0.id == song.id }) {
                currentSongIndex = existingIndex
            } else {
                songs.append(song)
                currentSongIndex = songs.count - 1
            }
        } else {
            currentSongIndex = index
        }

        guard let song = currentSong else { return }

        if recordHistory, let prev = previousCurrentSong, prev.id != song.id {
            playbackHistory.append(prev.id)
        }

        persistLastPlayedSong(song)
        loadingSongID = song.id

        stopPlayback()
        currentTime = 0
        duration = TimeInterval(song.duration)
        expectedSongDuration = TimeInterval(song.duration)
        didTriggerAutoAdvanceForCurrentSong = false
        hasRetriedPlaybackWithFallback = false
        activeStreamInfo = nil
        isBuffering = true
        errorMessage = nil

        extractColorsFromURL(song.coverXL.isEmpty ? song.cover : song.coverXL)
        updateNowPlayingInfo()

        // Session cache (fastest path)
        if let cachedFileURL = sessionAudioCache.cachedFileURL(for: song.id) {
            let info = StreamInfo(source: "session-cache", url: cachedFileURL.absoluteString, directURL: nil, headers: nil, error: nil)
            self.activeStreamInfo = info
            self.setupAVPlayer(with: info)
            self.loadRecommendations(songId: song.id)
            self.loadUpNext(songId: song.id)
            self.loadLyrics(artist: song.artist, title: song.title)
            return
        }

        // Stream info cache
        if let cachedStreamInfo = streamInfoCache[song.id] {
            self.activeStreamInfo = cachedStreamInfo
            self.setupAVPlayer(with: cachedStreamInfo)
            self.loadRecommendations(songId: song.id)
            self.loadUpNext(songId: song.id)
            self.loadLyrics(artist: song.artist, title: song.title)
            return
        }

        // Fetch from server
        Task { @MainActor in
            do {
                let streamInfo = try await networkService.getStreamURL(song: song, previousSongID: previousSongID)
                guard URL(string: streamInfo.url) != nil else { throw NetworkError.noStreamURL }

                // FIX: Race condition guard — user may have skipped while we were fetching
                guard self.loadingSongID == song.id, self.currentSong?.id == song.id else { return }

                self.activeStreamInfo = streamInfo
                self.streamInfoCache[song.id] = streamInfo
                self.setupAVPlayer(with: streamInfo)

                Task { await self.networkService.cacheSong(song) }
                if let cacheTarget = self.cacheTarget(from: streamInfo) {
                    Task { await self.sessionAudioCache.cacheIfNeeded(songID: song.id, remoteURL: cacheTarget.url, headers: cacheTarget.headers) }
                }

                self.loadRecommendations(songId: song.id)
                self.loadUpNext(songId: song.id)
                self.loadLyrics(artist: song.artist, title: song.title)

            } catch {
                guard self.loadingSongID == song.id, self.currentSong?.id == song.id else { return }
                self.isBuffering = false
                self.isPlaying = false
                self.errorMessage = "Failed to play: \(error.localizedDescription)"
                print("Stream error: \(error)")
            }
        }
    }

    // MARK: - AVPlayer Setup
    private func setupAVPlayer(with streamInfo: StreamInfo) {
        // Clean up all previous observers
        if let observer = timeObserver { player?.removeTimeObserver(observer); timeObserver = nil }
        statusObserver?.invalidate(); statusObserver = nil
        bufferingObserver?.invalidate(); bufferingObserver = nil
        if let observer = itemEndObserver { NotificationCenter.default.removeObserver(observer); itemEndObserver = nil }
        if let observer = itemFailedObserver { NotificationCenter.default.removeObserver(observer); itemFailedObserver = nil }
        if let observer = itemStalledObserver { NotificationCenter.default.removeObserver(observer); itemStalledObserver = nil }

        guard let playbackURL = playbackURL(from: streamInfo) else {
            errorMessage = "Playback URL unavailable"
            isBuffering = false
            return
        }

        var assetOptions: [String: Any] = ["AVURLAssetOutOfBandMIMETypeKey": "audio/mp4"]
        if let directURL = streamInfo.directURL,
           let headers = streamInfo.headers,
           URL(string: directURL)?.absoluteString == playbackURL.absoluteString,
           !headers.isEmpty {
            assetOptions["AVURLAssetHTTPHeaderFieldsKey"] = headers
        }

        let asset = AVURLAsset(url: playbackURL, options: assetOptions)
        playerItem = AVPlayerItem(asset: asset)
        playerItem?.preferredForwardBufferDuration = 15

        guard let playerItem else { return }

        if player == nil {
            player = AVPlayer(playerItem: playerItem)
        } else {
            player?.replaceCurrentItem(with: playerItem)
        }

        // FIX: false prevents AVPlayer from holding off playback "waiting to minimize stalling"
        // which is the primary cause of the stuck-on-pause issue
        player?.automaticallyWaitsToMinimizeStalling = false



        // FIX: play() is called ONLY from readyToPlay observer — never from loadAndPlaySong.
        // This is the single authoritative place that starts playback.
        statusObserver = playerItem.observe(\.status, options: [.new]) { [weak self] item, _ in
            DispatchQueue.main.async {
                guard let self else { return }
                switch item.status {
                case .readyToPlay:
                    self.isBuffering = false
                    let streamDuration = item.duration.seconds
                    if streamDuration.isFinite && streamDuration > 0 {
                        self.duration = self.expectedSongDuration > 0
                            ? min(self.expectedSongDuration, streamDuration)
                            : streamDuration
                    }
                    // Authoritative play() call
                    self.play()
                    self.updateNowPlayingInfo()

                case .failed:
                    if let currentSongID = self.currentSong?.id {
                        self.streamInfoCache.removeValue(forKey: currentSongID)
                    }
                    if self.retryPlaybackUsingFallbackIfNeeded() { return }
                    self.isBuffering = false
                    self.isPlaying = false
                    self.errorMessage = "Playback failed"
                    print("Player item failed: \(item.error?.localizedDescription ?? "unknown")")
                default:
                    break
                }
            }
        }

        // FIX: When buffer refills after a stall, resume player if it paused itself
        bufferingObserver = playerItem.observe(\.isPlaybackLikelyToKeepUp, options: [.new]) { [weak self] item, _ in
            DispatchQueue.main.async {
                guard let self else { return }
                if item.isPlaybackLikelyToKeepUp && self.isPlaying {
                    self.isBuffering = false
                    if self.player?.timeControlStatus == .paused {
                        self.player?.play()
                    }
                }
            }
        }

        // Periodic time observer
        timeObserver = player?.addPeriodicTimeObserver(
            forInterval: CMTime(seconds: 0.5, preferredTimescale: 600),
            queue: .main
        ) { [weak self] time in
            guard let self else { return }
            let seconds = time.seconds
            guard seconds.isFinite else { return }
            self.currentTime = seconds

            if let item = self.playerItem {
                let actuallyBuffering = !item.isPlaybackLikelyToKeepUp && self.isPlaying
                if self.isBuffering != actuallyBuffering { self.isBuffering = actuallyBuffering }
            }

            // FIX: Sync isPlaying with AVPlayer's real state — catches silent pauses
            if let player = self.player, !self.isBuffering {
                let actuallyPlaying = player.timeControlStatus == .playing
                if self.isPlaying != actuallyPlaying { self.isPlaying = actuallyPlaying }
            }

            if self.shouldAutoAdvanceAtExpectedEnd {
                self.didTriggerAutoAdvanceForCurrentSong = true
                self.playNext()
            }
        }

        // Natural end of song
        itemEndObserver = NotificationCenter.default.addObserver(
            forName: .AVPlayerItemDidPlayToEndTime,
            object: playerItem,
            queue: .main
        ) { [weak self] _ in
            self?.didTriggerAutoAdvanceForCurrentSong = true
            self?.playNext()
        }

        itemFailedObserver = NotificationCenter.default.addObserver(
            forName: .AVPlayerItemFailedToPlayToEndTime,
            object: playerItem,
            queue: .main
        ) { [weak self] _ in
            guard let self else { return }
            if let id = self.currentSong?.id { self.streamInfoCache.removeValue(forKey: id) }
            if self.retryPlaybackUsingFallbackIfNeeded() { return }
            self.isBuffering = false
            self.isPlaying = false
            self.errorMessage = "Playback failed"
        }

        // FIX: On stall, set buffering true and force-resume after 1.5s if still playing
        itemStalledObserver = NotificationCenter.default.addObserver(
            forName: .AVPlayerItemPlaybackStalled,
            object: playerItem,
            queue: .main
        ) { [weak self] _ in
            guard let self, self.isPlaying else { return }
            self.isBuffering = true
            DispatchQueue.main.asyncAfter(deadline: .now() + 1.5) { [weak self] in
                guard let self, self.isPlaying else { return }
                if self.player?.timeControlStatus != .playing { self.player?.play() }
            }
        }
    }

    private func playbackURL(from streamInfo: StreamInfo) -> URL? {
        if let directURL = streamInfo.directURL, let url = URL(string: directURL) { return url }
        return URL(string: streamInfo.url)
    }

    private func cacheTarget(from streamInfo: StreamInfo) -> (url: URL, headers: [String: String]?)? {
        if streamInfo.source == "session-cache" { return nil }
        if let directURL = streamInfo.directURL, let url = URL(string: directURL) { return (url, streamInfo.headers) }
        if let url = URL(string: streamInfo.url) { return (url, nil) }
        return nil
    }

    private func retryPlaybackUsingFallbackIfNeeded() -> Bool {
        guard !hasRetriedPlaybackWithFallback,
              let streamInfo = activeStreamInfo,
              let directURL = streamInfo.directURL,
              let direct = URL(string: directURL),
              let fallback = URL(string: streamInfo.url),
              direct.absoluteString != fallback.absoluteString
        else { return false }

        hasRetriedPlaybackWithFallback = true
        isBuffering = true
        print("Retrying playback with proxy fallback URL")
        let fallbackStreamInfo = StreamInfo(source: streamInfo.source, url: streamInfo.url, directURL: nil, headers: nil, error: streamInfo.error)
        activeStreamInfo = fallbackStreamInfo
        setupAVPlayer(with: fallbackStreamInfo)
        return true
    }

    // MARK: - Playback Controls
    func togglePlayPause() {
        HapticManager.playButtonTap()
        if isPlaying {
            pause()
        } else {
            if player?.currentItem != nil {
                play()
            } else if currentSong != nil {
                loadAndPlaySong(at: currentSongIndex)
            }
        }
    }

    func play() {
        player?.play()
        isPlaying = true
        updateNowPlayingInfo()
    }

    func pause() {
        player?.pause()
        isPlaying = false
        updateNowPlayingInfo()
    }

    private func stopPlayback() {
        player?.pause()
        player?.replaceCurrentItem(with: nil)
        isPlaying = false
        isBuffering = false
    }

    // MARK: - Next / Previous
    func playNext() {
        HapticManager.playSelection()
        guard !songs.isEmpty else { return }

        if !upNextRecommendations.isEmpty {
            let nextSong = upNextRecommendations.removeFirst()
            if let existingIndex = songs.firstIndex(where: { $0.id == nextSong.id }) {
                loadAndPlaySong(at: existingIndex)
            } else {
                songs.append(nextSong)
                loadAndPlaySong(at: songs.count - 1)
            }
            return
        }

        let nextIndex = (currentSongIndex + 1) % songs.count
        loadAndPlaySong(at: nextIndex)
    }

    func playPrevious() {
        HapticManager.playSelection()
        guard !songs.isEmpty else { return }
        if currentTime > 3 {
            seek(to: 0)
        } else {
            if let previousSongID = playbackHistory.popLast(),
               let previousIndex = songs.firstIndex(where: { $0.id == previousSongID }) {
                loadAndPlaySong(at: previousIndex, recordHistory: false)
            } else {
                let prevIndex = currentSongIndex > 0 ? currentSongIndex - 1 : songs.count - 1
                loadAndPlaySong(at: prevIndex, recordHistory: false)
            }
        }
    }

    func seek(to time: TimeInterval) {
        let cmTime = CMTime(seconds: time, preferredTimescale: 600)
        player?.seek(to: cmTime, toleranceBefore: .zero, toleranceAfter: .zero)
        currentTime = time
        updateNowPlayingInfo()
    }

    func setVolume(_ volume: Float) {
        player?.volume = max(0, min(1, volume))
    }

    func seekToProgress(_ progress: Double) {
        let time = progress * duration
        seek(to: max(0, min(time, duration)))
    }

    // MARK: - Song Selection
    func selectSong(_ song: Song, from list: [Song]? = nil) {
        HapticManager.playSuccess()
        let songList = list ?? songs
        if let index = songList.firstIndex(where: { $0.id == song.id }) {
            loadAndPlaySong(at: index, from: list)
        }
    }

    func saveRecentSearch(_ query: String) {
        let trimmedQuery = query.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmedQuery.isEmpty else { return }
        let updated = [trimmedQuery] + recentSearches.filter { $0.caseInsensitiveCompare(trimmedQuery) != .orderedSame }
        let trimmed = Array(updated.prefix(10))
        recentSearches = trimmed
        defaults.set(trimmed, forKey: StorageKeys.recentSearches)
    }

    func useRecentSearch(_ query: String) {
        searchText = query
        onSearchTextChanged(query)
    }

    func selectUpNextSong(_ song: Song) {
        HapticManager.playLightTap()
        upNextRecommendations.removeAll { $0.id == song.id }
        if let index = songs.firstIndex(where: { $0.id == song.id }) {
            loadAndPlaySong(at: index)
        } else {
            songs.append(song)
            loadAndPlaySong(at: songs.count - 1)
        }
    }

    // MARK: - Search UI
    func beginSearch() {
        withAnimation(.easeInOut(duration: 0.3)) { isSearching = true }
    }

    func cancelSearch() {
    searchTask?.cancel()
    withAnimation(.easeInOut(duration: 0.3)) {
        searchText = ""
        isSearching = false
        searchResults = []
        isSearchLoading = false
    }
    HapticManager.playLightTap()
}

    func toggleUpNext() {
        withAnimation(.spring(response: 0.35, dampingFraction: 0.8)) { showUpNext.toggle() }
        HapticManager.playLightTap()
    }

    // MARK: - Recommendations
    private func loadRecommendations(songId: String) {
    Task { @MainActor in
        do {
            let recs = try await networkService.getRecommendations(songId: songId)
            self.recommendations = (recs.behaviorBased + recs.contentBased).filter {
                !$0.title.isEmpty && $0.title != "Unknown"
            }
        } catch { self.recommendations = [] }
    }
}

    private func loadUpNext(songId: String) {
    Task { @MainActor in
        do {
            let upNext = try await networkService.getUpNext(songId: songId, limit: 10)
            // Filter out songs with unknown/empty titles
            self.upNextRecommendations = upNext.filter { 
                !$0.title.isEmpty && $0.title != "Unknown" 
            }
        } catch { self.upNextRecommendations = [] }
    }
}

    // MARK: - Startup Restore
    private func restoreStartupSong(from chartSongs: [Song]) {
        let lastPlayedSong = loadLastPlayedSong()
        if let lastPlayedSong {
            let mergedSongs = [lastPlayedSong] + chartSongs.filter { $0.id != lastPlayedSong.id }
            songs = mergedSongs
            currentSongIndex = 0
            duration = TimeInterval(lastPlayedSong.duration)
            extractColorsFromURL(lastPlayedSong.coverXL.isEmpty ? lastPlayedSong.cover : lastPlayedSong.coverXL)
            loadRecommendations(songId: lastPlayedSong.id)
            loadUpNext(songId: lastPlayedSong.id)
            loadLyrics(artist: lastPlayedSong.artist, title: lastPlayedSong.title)
            return
        }
        songs = chartSongs
        guard let firstSong = chartSongs.first else { return }
        currentSongIndex = 0
        duration = TimeInterval(firstSong.duration)
        extractColorsFromURL(firstSong.coverXL.isEmpty ? firstSong.cover : firstSong.coverXL)
    }

    private func persistLastPlayedSong(_ song: Song) {
        guard let data = try? JSONEncoder().encode(song) else { return }
        defaults.set(data, forKey: StorageKeys.lastPlayedSong)
    }

    private func loadLastPlayedSong() -> Song? {
        guard let data = defaults.data(forKey: StorageKeys.lastPlayedSong) else { return nil }
        return try? JSONDecoder().decode(Song.self, from: data)
    }

    private func loadRecentSearches() {
        recentSearches = defaults.stringArray(forKey: StorageKeys.recentSearches) ?? []
    }

    // MARK: - Lyrics
    private func loadLyrics(artist: String, title: String) {
        isLyricsLoading = true
        Task { @MainActor in
            do {
                let result = try await networkService.getLyrics(artist: artist, title: title)
                self.lyrics = result
                self.isLyricsLoading = false
            } catch {
                self.lyrics = nil
                self.isLyricsLoading = false
            }
        }
    }

    // MARK: - Color Extraction
    private func extractColorsFromURL(_ urlString: String) {
        colorExtractionTask?.cancel()
        guard let url = URL(string: urlString) else { dominantColors = .default; return }
        colorExtractionTask = Task {
            do {
                let (data, _) = try await URLSession.shared.data(from: url)
                guard !Task.isCancelled else { return }
                if let image = NSImage(data: data) {
                    let colors = ColorExtractor.extractColors(from: image)
                    await MainActor.run {
                        withAnimation(.easeInOut(duration: 0.8)) { self.dominantColors = colors }
                    }
                }
            } catch {
                await MainActor.run { self.dominantColors = .default }
            }
        }
    }

    // MARK: - Now Playing Info Center
    private func setupRemoteCommands() {
        let commandCenter = MPRemoteCommandCenter.shared()
        commandCenter.playCommand.addTarget { [weak self] _ in self?.play(); return .success }
        commandCenter.pauseCommand.addTarget { [weak self] _ in self?.pause(); return .success }
        commandCenter.nextTrackCommand.addTarget { [weak self] _ in self?.playNext(); return .success }
        commandCenter.previousTrackCommand.addTarget { [weak self] _ in self?.playPrevious(); return .success }
        commandCenter.changePlaybackPositionCommand.addTarget { [weak self] event in
            guard let event = event as? MPChangePlaybackPositionCommandEvent else { return .commandFailed }
            self?.seek(to: event.positionTime)
            return .success
        }
    }

    func updateNowPlayingInfo() {
        guard let song = currentSong else { return }
        var info = [String: Any]()
        info[MPMediaItemPropertyTitle] = song.title
        info[MPMediaItemPropertyArtist] = song.artist
        info[MPMediaItemPropertyAlbumTitle] = song.album
        info[MPMediaItemPropertyPlaybackDuration] = duration
        info[MPNowPlayingInfoPropertyElapsedPlaybackTime] = currentTime
        info[MPNowPlayingInfoPropertyPlaybackRate] = isPlaying ? 1.0 : 0.0
        MPNowPlayingInfoCenter.default().nowPlayingInfo = info

        let coverURL = song.coverXL.isEmpty ? song.cover : song.coverXL
        if let url = URL(string: coverURL) {
            Task {
                do {
                    let (data, _) = try await URLSession.shared.data(from: url)
                    if let image = NSImage(data: data) {
                        let artwork = MPMediaItemArtwork(boundsSize: image.size) { _ in image }
                        await MainActor.run {
                            var nowPlayingInfo = MPNowPlayingInfoCenter.default().nowPlayingInfo ?? [:]
                            nowPlayingInfo[MPMediaItemPropertyArtwork] = artwork
                            MPNowPlayingInfoCenter.default().nowPlayingInfo = nowPlayingInfo
                        }
                    }
                } catch {}
            }
        }
    }

    // MARK: - Helpers
    private func formatTime(_ time: TimeInterval) -> String {
        guard time.isFinite else { return "0:00" }
        let minutes = Int(time) / 60
        let seconds = Int(time) % 60
        return String(format: "%d:%02d", minutes, seconds)
    }

    private var shouldTrackCurrentSongForRecommendations: Bool {
        guard duration > 0 else { return false }
        return currentTime >= (duration / 2)
    }

    private var shouldAutoAdvanceAtExpectedEnd: Bool {
        guard !didTriggerAutoAdvanceForCurrentSong else { return false }
        guard isPlaying else { return false }
        guard expectedSongDuration > 0 else { return false }
        return currentTime >= max(expectedSongDuration - 1.5, 0)
    }

    // MARK: - Custom Font Loading
    private func loadCustomFonts() {
        let fonts = ["Jersey10-Regular", "Almendra-Regular"]
        Task {
            var loadedCount = 0
            for font in fonts { if self.registerFont(name: font) { loadedCount += 1 } }
            if loadedCount == fonts.count { DispatchQueue.main.async { self.fontsLoaded = true } }
        }
    }

    private func registerFont(name: String) -> Bool {
        if NSFont(name: name, size: 14) != nil { return true }
        if let bundleFontURL = Bundle.main.url(forResource: name, withExtension: "ttf") {
            var error: Unmanaged<CFError>?
            let registered = CTFontManagerRegisterFontsForURL(bundleFontURL as CFURL, .process, &error)
            return registered || NSFont(name: name, size: 14) != nil
        }
        guard let documentsPath = FileManager.default.urls(for: .documentDirectory, in: .userDomainMask).first else { return false }
        let fontUrl = documentsPath.appendingPathComponent("\(name).ttf")
        if FileManager.default.fileExists(atPath: fontUrl.path) {
            var error: Unmanaged<CFError>?
            CTFontManagerRegisterFontsForURL(fontUrl as CFURL, .process, &error)
            return true
        }
        return false
    }
}