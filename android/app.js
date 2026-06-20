/* ==========================================================================
   Openify Mobile app.js - State, Audio Player, Canvas, and Swipe Logic
   ========================================================================== */

// --- Configuration ---
const BASE_URL = (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1')
  ? 'http://localhost:8000'
  : 'https://openify-production-8e41.up.railway.app';
const DEFAULT_AVATAR = "data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24'><rect width='24' height='24' fill='%231e293b'/><circle cx='12' cy='8' r='4' fill='%23a3e635'/><path d='M12,14 C8.13,14 5,16.24 5,19 L19,19 C19,16.24 15.87,14 12,14 Z' fill='%23a3e635'/></svg>";

// Your web app's Firebase configuration
const firebaseConfig = {
  apiKey: "AIzaSyDMEIqoluzY4EkdyoOx5ELn9jFrDPwjoKE",
  authDomain: "openify-player.firebaseapp.com",
  projectId: "openify-player",
  storageBucket: "openify-player.firebasestorage.app",
  messagingSenderId: "895922637527",
  appId: "1:895922637527:web:f6688c0b5398d0ce8a3e92",
  measurementId: "G-DQN3BKJWN5"
};

// Initialize Firebase Compat
firebase.initializeApp(firebaseConfig);
const auth = firebase.auth();
const db = firebase.firestore();

// Enable Firestore offline persistence
db.enablePersistence().catch((err) => {
  if (err.code === 'failed-precondition') {
    console.warn("Firestore persistence failed: Multiple tabs open.");
  } else if (err.code === 'unimplemented') {
    console.warn("Firestore persistence failed: Browser doesn't support it.");
  }
});

// --- State Management ---
let isRestoringState = false;
let state = {
  songs: [],
  queue: [], // active cloned queue
  currentSongIndex: -1,
  isPlaying: false,
  isBuffering: false,
  searchText: '',
  searchResults: [],
  playbackHistory: [],
  upNextRecommendations: [],
  lyricsAbortController: null,
  
  // Tab/Navigation
  activeTab: 'home', // 'home' | 'search' | 'library' | 'profile'
  
  // Playlist states
  currentPlaylistId: null,
  selectedSongForOverlay: null,
  currentQueueSource: 'chart', // 'chart' | 'search' | 'playlist' | 'recommend_behavior' | 'recommend_content'
  behaviorRecommendations: [],
  contentRecommendations: [],
  downloadedSongsList: [],
  libraryFilter: 'all',
  
  // Lyrics state
  lyricsType: 'none',
  parsedLyrics: [],
  activeLyricIndex: -1,

  // Shuffle & Repeat
  isShuffle: false,
  repeatMode: 'none', // 'none' | 'all' | 'one'

  // Social / Profile stats
  followersCount: 0,
  followingCount: 0,
  isFollowing: false
};

let currentObjectURL = null;
let playUrlCache = {}; // Global cache: songId -> { url, streamInfo }

// --- HTML5 Audio Setup ---
let audio = new Audio();
const isInitialIOS = /iPad|iPhone|iPod/.test(navigator.userAgent) && !window.MSStream;
const isInitialSafari = /^((?!chrome|android).)*safari/i.test(navigator.userAgent);
if (isInitialIOS || isInitialSafari) {
  audio.removeAttribute('crossorigin');
} else {
  audio.crossOrigin = "anonymous";
}
let isDraggingSeek = false;
let fadeInterval = null;
let targetVolume = 0.75;

// --- DOM Elements ---
const mainContent = document.querySelector('.main-content');
const globalLoading = document.getElementById('global-loading');
const globalError = document.getElementById('global-error');
const errorText = document.getElementById('error-text');
const retryBtn = document.getElementById('retry-btn');
const greetingText = document.getElementById('greeting-text');

// Tabs & Content
const tabButtons = document.querySelectorAll('.nav-tab-btn');
const tabContentHome = document.getElementById('tab-content-home');
const tabContentSearch = document.getElementById('tab-content-search');
const tabContentLibrary = document.getElementById('tab-content-library');
const tabContentProfile = document.getElementById('tab-content-profile');

// Home page lists
const quickPlaylistsGrid = document.getElementById('quick-playlists-grid');
const trendingScroll = document.getElementById('trending-scroll');
const recommendedScroll = document.getElementById('recommended-scroll');

// Search Tab
const searchInput = document.getElementById('mobile-search-input');
const searchClearBtn = document.getElementById('search-clear-btn');
const categoriesContainer = document.getElementById('search-categories-container');
const resultsContainer = document.getElementById('search-results-container');
const resultsList = document.getElementById('search-results-list');
const categoryCards = document.querySelectorAll('.category-card');

// Library Tab
const showPlaylistCreateBtn = document.getElementById('show-playlist-create-modal');
const libraryPlaylistsList = document.getElementById('library-playlists-list');

// Playlist Detail Subpage
const playlistDetailPanel = document.getElementById('mobile-playlist-detail');
const playlistBackBtn = document.getElementById('playlist-back-btn');
const deletePlaylistBtn = document.getElementById('delete-playlist-btn');
const playlistNameInput = document.getElementById('playlist-detail-name');
const playlistDetailCount = document.getElementById('playlist-detail-count');
const playlistPlayAllBtn = document.getElementById('playlist-play-all-btn');
const playlistSongsList = document.getElementById('playlist-songs-list');

// Firebase Elements
const authContainer = document.getElementById('auth-container');
const profileContainer = document.getElementById('profile-container');
const authTabSignIn = document.getElementById('auth-tab-signin');
const authTabSignUp = document.getElementById('auth-tab-signup');
const authFieldName = document.getElementById('auth-field-name');
const authInputName = document.getElementById('auth-input-name');
const authInputEmail = document.getElementById('auth-input-email');
const authInputPassword = document.getElementById('auth-input-password');
const authErrorMsg = document.getElementById('auth-error-msg');
const authSubmitBtn = document.getElementById('auth-submit-btn');
const authGoogleBtn = document.getElementById('auth-google-btn');
const authSignoutBtn = document.getElementById('auth-signout-btn');
const authSyncForceBtn = document.getElementById('auth-sync-force-btn');
const syncDashboardStatus = document.getElementById('sync-dashboard-status');
const cloudSyncIcon = document.getElementById('cloud-sync-icon');
const profileUserAvatar = document.getElementById('profile-user-avatar');
const profileUserName = document.getElementById('profile-user-name');
const profileUserEmail = document.getElementById('profile-user-email');
const profilePlaylistsCount = document.getElementById('profile-playlists-count');
const headerUserAvatar = document.getElementById('header-user-avatar');

// Lyrics Elements
const panelLyricsContainer = document.getElementById('panel-lyrics-container');

// Visualizer Elements
const mobileVisualizerCanvas = document.getElementById('mobile-visualizer-canvas');

// Mini Player
const miniPlayer = document.getElementById('mini-player');
const miniProgressFill = document.getElementById('mini-progress-fill');
const miniPlayerInfoTrigger = document.getElementById('mini-player-info-trigger');
const miniCover = document.getElementById('mini-cover');
const miniTitle = document.getElementById('mini-title');
const miniArtist = document.getElementById('mini-artist');
const miniPlayBtn = document.getElementById('mini-play-btn');
const miniPlayIcon = document.getElementById('mini-play-icon');
const miniPauseIcon = document.getElementById('mini-pause-icon');
const miniNextBtn = document.getElementById('mini-next-btn');
const miniCloseBtn = document.getElementById('mini-close-btn');

// Download & Settings Elements
const panelDownloadBtn = document.getElementById('panel-download-btn');
const downloadIconHollow = document.getElementById('download-icon-hollow');
const downloadIconSolid = document.getElementById('download-icon-solid');
const downloadIconLoading = document.getElementById('download-icon-loading');
const settingOfflineMode = document.getElementById('setting-toggle-offlinemode');

// Fullscreen Now Playing Overlay
const nowPlayingPanel = document.getElementById('now-playing-panel');
const panelCloseBtn = document.getElementById('panel-close-btn');
const panelMenuBtn = document.getElementById('panel-menu-btn');
const panelTitle = document.getElementById('panel-title');
const panelArtist = document.getElementById('panel-artist');
const panelFavBtn = document.getElementById('panel-fav-btn');
const favIconOutline = document.getElementById('fav-icon-outline');
const favIconSolid = document.getElementById('fav-icon-solid');

// Turntable mobile
const mobileVinylDisc = document.getElementById('mobile-vinyl-disc');
const mobileVinylArt = document.getElementById('mobile-vinyl-art');
const mobileNeedleArm = document.getElementById('mobile-needle-arm');

// Fullscreen sliders & controls
const panelSeekBarWrapper = document.getElementById('panel-seek-bar-wrapper');
const panelSeekFill = document.getElementById('panel-seek-fill');
const panelSeekHandle = document.getElementById('panel-seek-handle');
const panelCurrentTime = document.getElementById('panel-current-time');
const panelDurationTime = document.getElementById('panel-duration-time');
const panelBufferingText = document.getElementById('panel-buffering-text');

const panelPrevBtn = document.getElementById('panel-prev-btn');
const panelPlayPauseBtn = document.getElementById('panel-play-pause-btn');
const panelPlayIcon = document.getElementById('panel-play-icon');
const panelPauseIcon = document.getElementById('panel-pause-icon');
const panelNextBtn = document.getElementById('panel-next-btn');

const panelVolumeToggle = document.getElementById('panel-volume-toggle');
const panelVolHigh = document.getElementById('panel-vol-high');
const panelVolMute = document.getElementById('panel-vol-mute');
const panelVolumeSlider = document.getElementById('panel-volume-slider');

// Playlist overlays
const addToPlaylistOverlay = document.getElementById('add-to-playlist-overlay');
const overlayPlaylistsList = document.getElementById('overlay-playlists-list');
const closeOverlayBtn = document.getElementById('close-overlay-btn');

// Modal Playlist Create
const createPlaylistModal = document.getElementById('create-playlist-modal');
const modalCancelBtn = document.getElementById('modal-cancel-btn');
const modalCreateBtn = document.getElementById('modal-create-btn');
const modalNewPlaylistInput = document.getElementById('new-playlist-input');

// --- Initialization ---
document.addEventListener('DOMContentLoaded', () => {
  setGreeting();
  setupAudioListeners();
  setupUIEventListeners();
  setupStarDriftBackground();
  setupSwipeGestures();
  setupLibraryFilters();
  initializePreferences();
  
  // Initialize Offline DB and load downloaded songs
  initOfflineDb().then(() => {
    return getAllDownloadedSongs();
  }).then(downloadedSongs => {
    state.downloadedSongsList = downloadedSongs;
    
    // Load setting state from localStorage if any
    if (settingOfflineMode) {
      const savedOffline = localStorage.getItem('openify_offline_mode') === 'true';
      settingOfflineMode.checked = savedOffline;
      
      settingOfflineMode.addEventListener('change', () => {
        localStorage.setItem('openify_offline_mode', settingOfflineMode.checked);
        showToast(settingOfflineMode.checked ? "Offline Mode Enabled" : "Offline Mode Disabled");
        loadChartSongs(); // Reload/re-render to apply offline constraints
        renderLibraryPlaylists();
      });
    }
    
    // Restore saved state (tabs, queue, search results, etc.) if any
    if (typeof loadAppState === 'function') {
      loadAppState();
    }
    
    loadChartSongs();
    renderQuickPlaylists();
    renderLibraryPlaylists();
  }).catch(err => {
    console.error("IndexedDB initialization failed:", err);
    loadChartSongs();
    renderQuickPlaylists();
  });

  setupFirebaseUI();
  setupFirebaseAuthStateObserver();
});

// --- Greeting based on time ---
function setGreeting(user = null) {
  const name = user ? (user.displayName || user.email.split('@')[0]) : "Guest";
  if (greetingText) {
    greetingText.textContent = `Hi, ${name}`;
  }
}

// --- API Calls ---
async function loadChartSongs() {
  showLoading(true);
  showError(false);
  if (checkOffline()) {
    showLoading(false);
    showToast("App is in Offline Mode.");
    renderTrendingSongs([]);
    return;
  }
  try {
    const res = await fetch(`${BASE_URL}/api/mobile/chart`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    
    // Preserve the loaded/playing song if the source is 'chart'
    if (state.currentSongIndex !== -1 && state.currentQueueSource === 'chart') {
      const currentList = getCurrentList();
      const currentSong = currentList[state.currentSongIndex];
      if (currentSong) {
        // Find if this song exists in the new chart
        const newIdx = data.findIndex(s => s.id === currentSong.id);
        if (newIdx !== -1) {
          // If it exists, update index to match the new position
          state.songs = data;
          state.currentSongIndex = newIdx;
        } else {
          // If it doesn't exist, prepend the current song to the chart so it remains at index 0,
          // and update currentSongIndex to 0
          data.unshift(currentSong);
          state.songs = data;
          state.currentSongIndex = 0;
        }
      } else {
        state.songs = data;
      }
    } else {
      state.songs = data;
    }
    
    showLoading(false);
    renderTrendingSongs(state.songs);
    
    if (state.songs.length > 0) {
      // If no song is currently loaded, load the first chart song as default
      if (state.currentSongIndex === -1) {
        loadSong(0, false);
      } else {
        updateActiveRowHighlight();
      }
    } else {
      showError(true, "No chart songs found on server.");
    }
  } catch (err) {
    showLoading(false);
    showError(true, "Server offline or unreachable");
    console.error("Failed to load chart songs:", err);
  }
}

let searchAbortController = null;
async function performSearch(query) {
  if (!query) {
    state.searchText = '';
    state.searchResults = [];
    categoriesContainer.classList.remove('hidden');
    resultsContainer.classList.add('hidden');
    searchClearBtn.classList.add('hidden');
    saveAppState();
    return;
  }

  if (checkOffline()) {
    showToast("Search is unavailable in Offline Mode.");
    return;
  }

  if (searchAbortController) {
    searchAbortController.abort();
  }
  searchAbortController = new AbortController();
  const signal = searchAbortController.signal;

  showLoading(true);
  searchClearBtn.classList.remove('hidden');
  categoriesContainer.classList.add('hidden');
  resultsContainer.classList.remove('hidden');

  try {
    const res = await fetch(`${BASE_URL}/api/mobile/search?q=${encodeURIComponent(query)}`, { signal });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    state.searchResults = Array.isArray(data) ? data : [];
    showLoading(false);
    
    renderSongsList(state.searchResults, resultsList, 'search');
    saveAppState();
  } catch (err) {
    if (err.name === 'AbortError') return;
    showLoading(false);
    renderSongsList([], resultsList, 'search');
    console.error("Search error:", err);
  }
}

async function loadUpNext(songId) {
  try {
    const res = await fetch(`${BASE_URL}/api/mobile/up_next?song_id=${songId}&limit=10`);
    if (res.ok) {
      const data = await res.json();
      state.upNextRecommendations = Array.isArray(data) ? data.filter(s => s.title && s.title !== "Unknown") : [];
    }
  } catch (err) {
    console.error("UpNext load failed:", err);
    state.upNextRecommendations = [];
  }
}

async function loadRecommendations(songId) {
  try {
    const res = await fetch(`${BASE_URL}/api/mobile/recommend?song_id=${songId}`);
    if (res.ok) {
      const data = await res.json();
      state.behaviorRecommendations = data && Array.isArray(data.behavior_based) ? data.behavior_based : [];
      state.contentRecommendations = data && Array.isArray(data.content_based) ? data.content_based : [];
      
      // Update the For You tab lists
      renderForYouTab();
      // Update Home scroll recommendations
      renderHomeScrollRecommendations();
    }
  } catch (err) {
    console.error("Recommendations load failed:", err);
    state.behaviorRecommendations = [];
    state.contentRecommendations = [];
  }
}

// --- Player Logic ---

function getSourceList() {
  if (state.currentQueueSource === 'playlist') {
    if (state.currentPlaylistId === 'downloads') {
      return state.downloadedSongsList || [];
    }
    const playlists = PlaylistStore.getPlaylists();
    const pl = playlists.find(p => p.id === state.currentPlaylistId);
    return pl ? pl.songs : [];
  } else if (state.currentQueueSource === 'search') {
    return state.searchResults || [];
  } else if (state.currentQueueSource === 'recommend_behavior') {
    return state.behaviorRecommendations || [];
  } else if (state.currentQueueSource === 'recommend_content') {
    return state.contentRecommendations || [];
  } else if (state.currentQueueSource === 'recommend_merged') {
    return [...state.behaviorRecommendations, ...state.contentRecommendations].slice(0, 6);
  } else {
    return state.songs || [];
  }
}

function getCurrentList() {
  if (state.queue && state.queue.length > 0) {
    return state.queue;
  }
  return getSourceList();
}

// --- Pre-resolution & Caching Optimizations ---
async function preResolveSongUrl(song) {
  if (!song || !song.id) return;
  if (playUrlCache[song.id]) return; // Already cached

  if (window.navigator.onLine === false || (settingOfflineMode && settingOfflineMode.checked)) {
    return;
  }

  try {
    const downloaded = await isSongDownloaded(song.id);
    if (downloaded) return; // Plays instantly from IndexedDB
  } catch (e) {}

  const playUrl = `${BASE_URL}/api/mobile/play?id=${song.id}&artist=${encodeURIComponent(song.artist)}&title=${encodeURIComponent(song.title)}`;
  
  try {
    const res = await fetch(playUrl);
    if (res.ok) {
      const streamInfo = await res.json();
      let finalUrl = streamInfo.url;
      if (BASE_URL.startsWith('https://') && finalUrl.startsWith('http://')) {
        finalUrl = finalUrl.replace('http://', 'https://');
      }
      playUrlCache[song.id] = { url: finalUrl, streamInfo };
      console.log(`Pre-resolved stream URL for: ${song.title}`);
    }
  } catch (err) {
    console.warn("Failed to pre-resolve stream URL:", err);
  }
}

async function precacheNextSongs() {
  if (window.navigator.onLine === false || (settingOfflineMode && settingOfflineMode.checked)) {
    return;
  }
  const list = getCurrentList();
  if (list.length === 0 || state.currentSongIndex === -1) return;

  const nextIndices = [];
  if (state.isShuffle) {
    for (let i = 0; i < Math.min(2, list.length); i++) {
      const randIdx = Math.floor(Math.random() * list.length);
      if (randIdx !== state.currentSongIndex && !nextIndices.includes(randIdx)) {
        nextIndices.push(randIdx);
      }
    }
  } else {
    const nextIdx1 = (state.currentSongIndex + 1) % list.length;
    const nextIdx2 = (state.currentSongIndex + 2) % list.length;
    nextIndices.push(nextIdx1);
    if (nextIdx2 !== nextIdx1) {
      nextIndices.push(nextIdx2);
    }
  }

  nextIndices.forEach(async (idx) => {
    const nextSong = list[idx];
    if (!nextSong) return;

    preResolveSongUrl(nextSong);

    try {
      const downloaded = await isSongDownloaded(nextSong.id);
      if (downloaded) return;

      fetch(`${BASE_URL}/api/mobile/cache_song`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: nextSong.id,
          artist: nextSong.artist,
          title: nextSong.title
        })
      }).catch(() => {});
    } catch (e) {}
  });
}

async function loadSong(index, shouldPlay = true) {
  // Clear fadeInterval and clean up the old Audio element to prevent memory/listener leaks
  if (fadeInterval) {
    clearInterval(fadeInterval);
    fadeInterval = null;
  }
  if (audio) {
    cleanupAudio(audio);
  }
  setupAudioListeners();
  const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent) && !window.MSStream;
  const isSafari = /^((?!chrome|android).)*safari/i.test(navigator.userAgent);
  if (isIOS || isSafari) {
    audio.removeAttribute('crossorigin');
  } else {
    audio.crossOrigin = "anonymous";
  }

  // Bless the audio element synchronously during the user gesture callback
  // to bypass iOS Safari's asynchronous playback restriction.
  if (shouldPlay && audio && (isIOS || isSafari)) {
    try {
      audio.play().then(() => {
        audio.pause();
      }).catch(() => {});
    } catch (e) {}
  }

  if (!shouldPlay) {
    audio.addEventListener('loadedmetadata', () => {
      const savedTime = localStorage.getItem('openify_last_time');
      if (savedTime) {
        const timeVal = parseFloat(savedTime);
        audio.currentTime = timeVal;
        setTimeout(() => {
          const progress = audio.duration ? (audio.currentTime / audio.duration) : 0;
          updateSeekBarProgress(progress);
          panelCurrentTime.textContent = formatTime(audio.currentTime);
        }, 150);
      }
    }, { once: true });
  }

  const list = getCurrentList();
  if (index < 0 || index >= list.length) return;

  const previousSongId = state.currentSongIndex !== -1 && list[state.currentSongIndex] 
    ? list[state.currentSongIndex].id 
    : null;

  // Track playback history
  if (state.currentSongIndex !== -1 && state.currentSongIndex !== index && list[state.currentSongIndex]) {
    state.playbackHistory.push(list[state.currentSongIndex].id);
  }

  state.currentSongIndex = index;
  const song = list[index];

  // Update system media session controls and save state
  if (typeof updateMediaSession === 'function') {
    updateMediaSession(song);
  }
  if (typeof saveAppState === 'function') {
    saveAppState();
  }

  // Save to localStorage
  localStorage.setItem('openify_last_song_id', song.id);
  localStorage.setItem('openify_last_song', JSON.stringify(song));

  // Update Mini Player UI
  miniTitle.textContent = song.title;
  miniArtist.textContent = song.artist;
  
  // Update Full Player UI
  panelTitle.textContent = song.title;
  panelArtist.textContent = song.artist;

  const coverUrl = song.cover_xl || song.cover;
  if (coverUrl) {
    miniCover.src = coverUrl;
    mobileVinylArt.style.backgroundImage = `url('${coverUrl}')`;
    
    // Dynamic HSL color extraction
    extractDominantColors(coverUrl);
  } else {
    miniCover.src = '';
    mobileVinylArt.style.backgroundImage = 'none';
    resetColorsToDefault();
  }

  // Check Favorite status
  updateFavoriteHeartIcon(song.id);

  // Pre-load recommendations
  loadUpNext(song.id);
  loadRecommendations(song.id);

  // Update lists highlight
  updateActiveRowHighlight();

  // Reset Seekbars
  updateSeekBarProgress(0);
  panelCurrentTime.textContent = '0:00';
  panelDurationTime.textContent = formatTime(song.duration || 0);

  // Update download button state
  const downloaded = await isSongDownloaded(song.id);
  updateDownloadIconState(downloaded ? 'solid' : 'hollow');

  // Fetch synced scrolling lyrics
  fetchLyricsForSong(song.artist, song.title, song.id);

  setBuffering(true);
  miniPlayer.classList.remove('hidden');

  targetVolume = parseFloat(panelVolumeSlider.value);

  // Clean up old object URL to prevent memory leaks
  if (currentObjectURL) {
    URL.revokeObjectURL(currentObjectURL);
    currentObjectURL = null;
  }

  if (downloaded) {
    try {
      const downloadedData = await getDownloadedSong(song.id);
      if (downloadedData && downloadedData.audioBlob) {
        currentObjectURL = URL.createObjectURL(downloadedData.audioBlob);
        audio.src = currentObjectURL;
        
        if (shouldPlay) {
          audio.volume = 0;
          initMobileVisualizer();
          if (audioCtx && audioCtx.state === 'suspended') {
            audioCtx.resume();
          }
          audio.play().then(() => {
            setPlayingState(true);
            fadeTo(targetVolume, 400);
            setBuffering(false);
          }).catch(err => {
            console.warn("Play blocked/failed:", err);
            setPlayingState(false);
            setBuffering(false);
          });
        } else {
          audio.volume = targetVolume;
          setPlayingState(false);
          setBuffering(false);
        }
        return; // Local playback started successfully
      }
    } catch (err) {
      console.error("Local playback failed, trying network fallback:", err);
    }
  }

  // Intercept if offline
  if (checkOffline()) {
    showToast("This song is not downloaded. Turn off Offline Mode to stream.");
    setBuffering(false);
    setPlayingState(false);
    return;
  }

  const playUrl = `${BASE_URL}/api/mobile/play?id=${song.id}&artist=${encodeURIComponent(song.artist)}&title=${encodeURIComponent(song.title)}${previousSongId ? `&previous_song_id=${previousSongId}` : ''}`;

  // Check in-memory cache first (instant playback)
  if (playUrlCache[song.id]) {
    const cachedUrl = playUrlCache[song.id].url;
    audio.src = cachedUrl;
    if (shouldPlay) {
      audio.volume = 0;
      initMobileVisualizer();
      if (audioCtx && audioCtx.state === 'suspended') {
        audioCtx.resume();
      }
      audio.play().then(() => {
        setPlayingState(true);
        fadeTo(targetVolume, 400);
        setBuffering(false);
      }).catch(err => {
        console.warn("Cached play blocked/failed:", err);
        setPlayingState(false);
        setBuffering(false);
      });
    } else {
      audio.volume = targetVolume;
      setPlayingState(false);
      setBuffering(false);
    }
    if (shouldPlay) {
      scrobbleTrackToLastfm(song);
    }
    // Record history & trigger backend cache task in background
    fetch(playUrl).catch(() => {});
    precacheNextSongs();
    return;
  }

  // Trigger stream play online
  fetch(playUrl)
    .then(res => {
      if (!res.ok) throw new Error("Stream unreachable");
      return res.json();
    })
    .then(streamInfo => {
      let finalUrl = streamInfo.url;
      if (BASE_URL.startsWith('https://') && finalUrl.startsWith('http://')) {
        finalUrl = finalUrl.replace('http://', 'https://');
      }
      // Populate frontend cache
      playUrlCache[song.id] = { url: finalUrl, streamInfo };

      audio.src = finalUrl;
      if (shouldPlay) {
        audio.volume = 0;
        initMobileVisualizer();
        if (audioCtx && audioCtx.state === 'suspended') {
          audioCtx.resume();
        }
        audio.play().then(() => {
          setPlayingState(true);
          fadeTo(targetVolume, 400);
          setBuffering(false);
        }).catch(err => {
          console.warn("Play blocked/failed:", err);
          setPlayingState(false);
          setBuffering(false);
        });
      } else {
        audio.volume = targetVolume;
        setPlayingState(false);
        setBuffering(false);
      }
      precacheNextSongs();
    })
    .catch(err => {
      console.error("Failed to load stream url:", err);
      setBuffering(false);
      setPlayingState(false);
    });
  if (shouldPlay) {
    scrobbleTrackToLastfm(song);
  }
}

function playNext() {
  if (state.isPlaying) {
    fadeTo(0, 200, () => {
      triggerPlayNext();
    });
  } else {
    triggerPlayNext();
  }
}

function triggerPlayNext() {
  const list = getCurrentList();
  if (list.length === 0) return;

  if (state.isShuffle) {
    let nextIndex = state.currentSongIndex;
    if (list.length > 1) {
      while (nextIndex === state.currentSongIndex) {
        nextIndex = Math.floor(Math.random() * list.length);
      }
    } else {
      nextIndex = 0;
    }
    loadSong(nextIndex, true);
    return;
  }

  // Up Next recommendations injection
  if (state.upNextRecommendations.length > 0 && state.currentQueueSource === 'chart') {
    const nextRecSong = state.upNextRecommendations.shift();
    const activeList = getCurrentList();
    const existingIdx = activeList.findIndex(s => s.id === nextRecSong.id);
    if (existingIdx !== -1) {
      loadSong(existingIdx, true);
    } else {
      activeList.push(nextRecSong);
      loadSong(activeList.length - 1, true);
    }
    return;
  }

  const nextIndex = (state.currentSongIndex + 1) % list.length;
  loadSong(nextIndex, true);
}

function playPrevious() {
  if (state.isPlaying) {
    fadeTo(0, 200, () => {
      triggerPlayPrevious();
    });
  } else {
    triggerPlayPrevious();
  }
}

function triggerPlayPrevious() {
  const list = getCurrentList();
  if (list.length === 0) return;

  if (audio.currentTime > 3) {
    audio.currentTime = 0;
    audio.volume = 0;
    fadeTo(targetVolume, 400);
    return;
  }

  if (state.playbackHistory.length > 0) {
    const prevId = state.playbackHistory.pop();
    const prevIdx = list.findIndex(s => s.id === prevId);
    if (prevIdx !== -1) {
      loadSong(prevIdx, true);
      return;
    }
  }

  const prevIndex = state.currentSongIndex > 0 ? state.currentSongIndex - 1 : list.length - 1;
  loadSong(prevIndex, true);
}

function togglePlayPause() {
  if (state.currentSongIndex === -1) {
    const list = getCurrentList();
    if (list.length > 0) loadSong(0, true);
    return;
  }

  if (state.isPlaying) {
    setPlayingState(false);
    fadeTo(0, 400, () => {
      audio.pause();
    });
  } else {
    audio.volume = 0;
    audio.play().then(() => {
      setPlayingState(true);
      fadeTo(targetVolume, 400);
    }).catch(err => {
      console.error("Audio play failed:", err);
    });
  }
}

function setPlayingState(playing) {
  state.isPlaying = playing;
  if (playing) {
    // Mini
    miniPlayIcon.classList.add('hidden');
    miniPauseIcon.classList.remove('hidden');
    
    // Panel
    panelPlayIcon.classList.add('hidden');
    panelPauseIcon.classList.remove('hidden');
    
    // Turntable animations
    mobileVinylDisc.classList.add('playing');
    mobileNeedleArm.classList.add('playing');
  } else {
    // Mini
    miniPlayIcon.classList.remove('hidden');
    miniPauseIcon.classList.add('hidden');
    
    // Panel
    panelPlayIcon.classList.remove('hidden');
    panelPauseIcon.classList.add('hidden');
    
    // Turntable animations
    mobileVinylDisc.classList.remove('playing');
    mobileNeedleArm.classList.remove('playing');
  }
  
  if (typeof updatePlaybackState === 'function') {
    updatePlaybackState();
  }
}

function setBuffering(buffering) {
  state.isBuffering = buffering;
  if (buffering) {
    panelBufferingText.classList.remove('hidden');
  } else {
    panelBufferingText.classList.add('hidden');
  }
}

function updateFavoriteHeartIcon(songId) {
  const favorites = PlaylistStore.getPlaylists().find(p => p.id === 'favorites');
  const isFav = favorites ? favorites.songs.some(s => s.id === songId) : false;
  if (isFav) {
    favIconOutline.classList.add('hidden');
    favIconSolid.classList.remove('hidden');
  } else {
    favIconOutline.classList.remove('hidden');
    favIconSolid.classList.add('hidden');
  }
}

function toggleFavorite() {
  const list = getCurrentList();
  if (state.currentSongIndex === -1 || list.length === 0) return;
  const song = list[state.currentSongIndex];
  
  const favorites = PlaylistStore.getPlaylists().find(p => p.id === 'favorites');
  if (!favorites) return;

  const isFav = favorites.songs.some(s => s.id === song.id);
  if (isFav) {
    PlaylistStore.removeSongFromPlaylist('favorites', song.id);
  } else {
    PlaylistStore.addSongToPlaylist('favorites', song);
  }
  
  updateFavoriteHeartIcon(song.id);
  renderQuickPlaylists();
  
  // If Library view is open, reload it
  if (state.activeTab === 'library') {
    renderLibraryPlaylists();
    if (playlistDetailPanel.classList.contains('active') && state.currentPlaylistId === 'favorites') {
      showPlaylistDetail('favorites');
    }
  }
}

// --- Audio Listener Setup ---
let lastTimeSave = 0;
function onAudioTimeUpdate() {
  if (isDraggingSeek) return;
  const progress = audio.duration ? (audio.currentTime / audio.duration) : 0;
  updateSeekBarProgress(progress);
  panelCurrentTime.textContent = formatTime(audio.currentTime);
  updateLyricsHighlight();

  const now = Date.now();
  if (now - lastTimeSave > 2000) {
    localStorage.setItem('openify_last_time', audio.currentTime);
    lastTimeSave = now;
  }
}

function onAudioDurationChange() {
  panelDurationTime.textContent = formatTime(audio.duration || 0);
}

function onAudioEnded() {
  if (state.repeatMode === 'one') {
    loadSong(state.currentSongIndex, true);
  } else {
    const list = getCurrentList();
    if (state.repeatMode === 'none' && state.currentSongIndex === list.length - 1) {
      setPlayingState(false);
    } else {
      playNext();
    }
  }
}

function onAudioWaiting() {
  setBuffering(true);
}

function onAudioPlaying() {
  setBuffering(false);
  setPlayingState(true);
  initMobileVisualizer();
}

function onAudioStalled() {
  setBuffering(true);
}

function onAudioCanPlay() {
  setBuffering(false);
}

function onAudioError(e) {
  console.error("Audio element error event:", e);
  if (audio && audio.error) {
    console.error("Audio error code:", audio.error.code);
    console.error("Audio error message:", audio.error.message);
  }
  setBuffering(false);
  setPlayingState(false);
}

function onAudioSeeked() {
  updateLyricsHighlight();
}

function setupAudioListeners() {
  audio.addEventListener('timeupdate', onAudioTimeUpdate);
  audio.addEventListener('durationchange', onAudioDurationChange);
  audio.addEventListener('ended', onAudioEnded);
  audio.addEventListener('waiting', onAudioWaiting);
  audio.addEventListener('playing', onAudioPlaying);
  audio.addEventListener('stalled', onAudioStalled);
  audio.addEventListener('canplay', onAudioCanPlay);
  audio.addEventListener('error', onAudioError);
  audio.addEventListener('seeked', onAudioSeeked);
}

function cleanupAudio(oldAudio) {
  if (fadeInterval) {
    clearInterval(fadeInterval);
    fadeInterval = null;
  }
  if (!oldAudio) return;
  try {
    oldAudio.pause();
  } catch(e) {}
  oldAudio.removeEventListener('timeupdate', onAudioTimeUpdate);
  oldAudio.removeEventListener('durationchange', onAudioDurationChange);
  oldAudio.removeEventListener('ended', onAudioEnded);
  oldAudio.removeEventListener('waiting', onAudioWaiting);
  oldAudio.removeEventListener('playing', onAudioPlaying);
  oldAudio.removeEventListener('stalled', onAudioStalled);
  oldAudio.removeEventListener('canplay', onAudioCanPlay);
  oldAudio.removeEventListener('error', onAudioError);
  oldAudio.src = '';
}

function updateSeekBarProgress(progress) {
  const percent = progress * 100;
  // Mini line bar
  miniProgressFill.style.width = `${percent}%`;
  // Full Player
  panelSeekFill.style.width = `${percent}%`;
  panelSeekHandle.style.left = `${percent}%`;
}

// --- UI Rendering ---

// Render trending horizontal scroll
function renderTrendingSongs(songsList) {
  trendingScroll.innerHTML = '';
  if (!songsList || songsList.length === 0) {
    trendingScroll.innerHTML = '<div class="text-center w-full py-6 text-on-surface-variant text-xs font-semibold">Offline. Play downloaded songs in Library tab.</div>';
    return;
  }
  songsList.forEach((song, i) => {
    const card = document.createElement('div');
    card.className = 'song-card';
    const coverUrl = song.cover_medium || song.cover;
    card.innerHTML = `
      <div class="song-card-art-wrapper">
        ${coverUrl ? `<img src="${coverUrl}" class="song-card-art" alt="${escapeHTML(song.title)}">` : `
          <div class="song-card-fallback">
            <svg viewBox="0 0 24 24" width="24" height="24" fill="currentColor">
              <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2z"/>
            </svg>
          </div>
        `}
        <div class="song-card-play-overlay">
          <div class="song-card-play-btn">
            <svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor">
              <path d="M8 5v14l11-7z"/>
            </svg>
          </div>
        </div>
      </div>
      <div class="song-card-title">${escapeHTML(song.title)}</div>
      <div class="song-card-artist">${escapeHTML(song.artist)}</div>
    `;
    card.addEventListener('click', () => {
      state.currentQueueSource = 'chart';
      state.queue = [...state.songs];
      loadSong(i, true);
    });
    card.addEventListener('mouseenter', () => {
      preResolveSongUrl(song);
    });
    card.addEventListener('touchstart', () => {
      preResolveSongUrl(song);
    }, { passive: true });
    trendingScroll.appendChild(card);
  });
  
  // Pre-resolve top 3 trending songs
  songsList.slice(0, 3).forEach(song => {
    preResolveSongUrl(song);
  });
}

// Render recommended scroll (Home tab)
function renderHomeScrollRecommendations() {
  recommendedScroll.innerHTML = '';
  const merged = [...state.behaviorRecommendations, ...state.contentRecommendations].slice(0, 6);
  if (merged.length === 0) {
    recommendedScroll.innerHTML = `<div class="glass-card rounded-xl p-6 text-center text-sm text-on-surface-variant">Play some songs to build customized recommendations.</div>`;
    return;
  }

  merged.forEach((song, i) => {
    const row = document.createElement('div');
    row.className = 'mobile-song-row';
    const coverUrl = song.cover || song.cover_small;
    const formattedIdx = String(i + 1).padStart(2, '0');

    row.innerHTML = `
      <div class="row-index-container">
        <span class="index-num">${formattedIdx}</span>
        <svg class="row-playing-icon" viewBox="0 0 24 24" width="11" height="11" fill="currentColor">
          <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-1 14H9V8h2v8zm4 0h-2V8h2v8z"/>
        </svg>
      </div>
      ${coverUrl ? `<img src="${coverUrl}" class="row-art" alt="cover">` : `
        <div class="row-art-fallback">
          <span class="material-symbols-outlined text-[16px]">music_note</span>
        </div>
      `}
      <div class="row-info">
        <div class="row-title">${escapeHTML(song.title)}</div>
        <div class="row-artist">${escapeHTML(song.artist)}</div>
      </div>
      <div class="row-actions">
        <button class="row-action-btn add" title="Add to playlist">
          <svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor">
            <path d="M19 13h-6v6h-2v-6H5v-2h6V5h2v6h6v2z"/>
          </svg>
        </button>
      </div>
    `;

    row.addEventListener('click', (e) => {
      if (e.target.closest('.row-action-btn')) return;
      state.currentQueueSource = 'recommend_merged';
      state.queue = [...state.behaviorRecommendations, ...state.contentRecommendations].slice(0, 6);
      loadSong(i, true);
    });
    row.addEventListener('mouseenter', () => {
      preResolveSongUrl(song);
    });
    row.addEventListener('touchstart', () => {
      preResolveSongUrl(song);
    }, { passive: true });

    const addBtn = row.querySelector('.row-action-btn');
    if (addBtn) {
      addBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        showAddToPlaylistOverlay(song);
      });
    }

    recommendedScroll.appendChild(row);
  });
  
  // Pre-resolve first 2 recommendations
  merged.slice(0, 2).forEach(song => {
    preResolveSongUrl(song);
  });
}


// Render general songs lists (Search, Recommendations, Playlist details)
function renderSongsList(songsList, container, queueSource, playlistId = null) {
  container.innerHTML = '';
  if (songsList.length === 0) {
    container.innerHTML = '<div style="padding: 20px; text-align: center; color: rgba(255,255,255,0.25); font-size:11px;">No songs in this list</div>';
    return;
  }

  const currentList = getCurrentList();
  const currentSong = state.currentSongIndex !== -1 ? currentList[state.currentSongIndex] : null;

  songsList.forEach((song, i) => {
    const isCurrentActive = currentSong && song && song.id === currentSong.id && state.currentQueueSource === queueSource;
    const row = document.createElement('div');
    row.className = `mobile-song-row ${isCurrentActive ? 'active' : ''}`;
    
    const formattedIdx = String(i + 1).padStart(2, '0');
    const coverUrl = song.cover || song.cover_small;

    // Action button
    let actionBtnHtml = '';
    if (playlistId) {
      // Remove button
      actionBtnHtml = `
        <button class="row-action-btn remove" title="Remove from playlist">
          <svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor">
            <path d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z"/>
          </svg>
        </button>
      `;
    } else {
      // Add button
      actionBtnHtml = `
        <button class="row-action-btn add" title="Add to playlist">
          <svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor">
            <path d="M19 13h-6v6h-2v-6H5v-2h6V5h2v6h6v2z"/>
          </svg>
        </button>
      `;
    }

    row.innerHTML = `
      <div class="row-index-container">
        <span class="index-num">${formattedIdx}</span>
        <svg class="row-playing-icon" viewBox="0 0 24 24" width="11" height="11" fill="currentColor">
          <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-1 14H9V8h2v8zm4 0h-2V8h2v8z"/>
        </svg>
      </div>
      ${coverUrl ? `<img src="${coverUrl}" class="row-art" alt="cover">` : `
        <div class="row-art-fallback">
          <svg viewBox="0 0 24 24" width="14" height="14" fill="currentColor">
            <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm0 14.5c-2.49 0-4.5-2.01-4.5-4.5S9.51 7.5 12 7.5s4.5 2.01 4.5 4.5-2.01 4.5-4.5 4.5zm0-5.5c-.55 0-1 .45-1 1s.45 1 1 1 1-.45 1-1-.45-1-1-1z"/>
          </svg>
        </div>
      `}
      <div class="row-info">
        <div class="row-title">${escapeHTML(song.title)}</div>
        <div class="row-artist">${escapeHTML(song.artist)}</div>
      </div>
      <div class="row-actions">
        ${actionBtnHtml}
      </div>
    `;

    // Row play trigger
    row.addEventListener('click', (e) => {
      if (e.target.closest('.row-action-btn')) return;
      state.currentQueueSource = queueSource;
      if (queueSource === 'playlist') {
        state.currentPlaylistId = playlistId;
      }
      state.queue = [...songsList];
      loadSong(i, true);
    });
    row.addEventListener('mouseenter', () => {
      preResolveSongUrl(song);
    });
    row.addEventListener('touchstart', () => {
      preResolveSongUrl(song);
    }, { passive: true });

    // Action button handlers
    const actionBtn = row.querySelector('.row-action-btn');
    if (actionBtn) {
      actionBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        if (playlistId) {
          if (playlistId === 'downloads') {
            removeDownload(song.id).then(() => {
              playlistDetailCount.textContent = `${state.downloadedSongsList.length} song${state.downloadedSongsList.length === 1 ? '' : 's'}`;
              renderSongsList(state.downloadedSongsList, playlistSongsList, 'playlist', 'downloads');
            });
          } else {
            PlaylistStore.removeSongFromPlaylist(playlistId, song.id);
            const pl = PlaylistStore.getPlaylists().find(p => p.id === playlistId);
            if (pl) {
              playlistDetailCount.textContent = `${pl.songs.length} song${pl.songs.length === 1 ? '' : 's'}`;
              renderSongsList(pl.songs, playlistSongsList, 'playlist', playlistId);
              renderLibraryPlaylists();
              renderQuickPlaylists();
            }
          }
        } else {
          showAddToPlaylistOverlay(song);
        }
      });
    }

    container.appendChild(row);
  });

  // Pre-resolve top 3 songs in this rendered list
  songsList.slice(0, 3).forEach(song => {
    preResolveSongUrl(song);
  });
}

function updateActiveRowHighlight() {
  const currentList = getCurrentList();
  const currentSong = state.currentSongIndex !== -1 ? currentList[state.currentSongIndex] : null;

  const highlightContainer = (container, queueSource) => {
    if (!container) return;
    const rows = container.querySelectorAll('.mobile-song-row');
    rows.forEach((row, idx) => {
      const list = queueSource === 'search' ? state.searchResults :
                   queueSource === 'playlist' ? (
                     state.currentPlaylistId === 'downloads'
                     ? state.downloadedSongsList
                     : (PlaylistStore.getPlaylists().find(p => p.id === state.currentPlaylistId)?.songs || [])
                   ) :
                   queueSource === 'recommend_behavior' ? state.behaviorRecommendations :
                   queueSource === 'recommend_content' ? state.contentRecommendations :
                   queueSource === 'recommend_merged' ? [...state.behaviorRecommendations, ...state.contentRecommendations].slice(0, 6) : [];
      const song = list[idx];
      if (currentSong && song && song.id === currentSong.id && state.currentQueueSource === queueSource) {
        row.classList.add('active');
      } else {
        row.classList.remove('active');
      }
    });
  };

  highlightContainer(resultsList, 'search');
  highlightContainer(playlistSongsList, 'playlist');
  highlightContainer(recommendedScroll, 'recommend_merged');
}

// Render Quick Playlists Grid (Home tab)
function renderQuickPlaylists() {
  if (!quickPlaylistsGrid) return;
  quickPlaylistsGrid.innerHTML = '';
  const playlists = PlaylistStore.getPlaylists().slice(0, 6);
  
  playlists.forEach(pl => {
    const card = document.createElement('div');
    card.className = 'quick-playlist-card';
    card.innerHTML = `
      <div class="quick-playlist-art">
        <svg viewBox="0 0 24 24" width="20" height="20" fill="currentColor">
          <path d="M4 6H2v14c0 1.1.9 2 2 2h14v-2H4V6zm16-4H8c-1.1 0-2 .9-2 2v12c0 1.1.9 2 2 2h12c1.1 0 2-.9 2-2V4c0-1.1-.9-2-2-2zm0 14H8V4h12v12z"/>
        </svg>
      </div>
      <div class="quick-playlist-info">
        <div class="quick-playlist-name">${escapeHTML(pl.name)}</div>
      </div>
    `;
    card.addEventListener('click', () => {
      // Shift tab to Library and open Playlist Detail directly!
      switchTab('library');
      showPlaylistDetail(pl.id);
    });
    quickPlaylistsGrid.appendChild(card);
  });
}

// Render Library Playlists
function renderLibraryPlaylists() {
  libraryPlaylistsList.innerHTML = '';
  const filter = state.libraryFilter || 'all';
  const playlists = PlaylistStore.getPlaylists();

  // Update Pulse Mix hero card count
  const pulseMixCount = document.getElementById('pulse-mix-count');
  if (pulseMixCount) {
    const favPl = playlists.find(p => p.id === 'favorites');
    const favCount = favPl ? favPl.songs.length : 0;
    pulseMixCount.textContent = `${favCount} track${favCount === 1 ? '' : 's'} â€¢ Updated just now`;
  }
  
  // 1. Virtual Playlist "Downloaded Songs"
  if (filter === 'all' || filter === 'downloads') {
    const dlSongsCount = state.downloadedSongsList ? state.downloadedSongsList.length : 0;
    const row = document.createElement('div');
    row.className = 'playlist-row-item virtual-downloaded';
    row.innerHTML = `
      <div class="playlist-row-art virtual-downloaded-art" style="background: linear-gradient(135deg, #00C6FF, #0072FF); display: flex; align-items: center; justify-content: center; border-radius: 8px;">
        <span class="material-symbols-outlined text-[20px] text-white">download</span>
      </div>
      <div class="playlist-row-info">
        <div class="playlist-row-name">Downloaded Songs</div>
        <div class="playlist-row-count">${dlSongsCount} song${dlSongsCount === 1 ? '' : 's'}</div>
      </div>
    `;
    row.addEventListener('click', () => {
      showPlaylistDetail('downloads');
    });
    libraryPlaylistsList.appendChild(row);
  }

  // 2. Custom/Favorites Playlists from PlaylistStore
  playlists.forEach(pl => {
    if (filter === 'favorites' && pl.id !== 'favorites') return;
    if (filter === 'playlists' && pl.id === 'favorites') return;
    if (filter === 'downloads') return; // handled above

    const row = document.createElement('div');
    row.className = 'playlist-row-item';
    
    const isFav = pl.id === 'favorites';
    const artContent = isFav 
      ? `<div class="playlist-row-art favorites-art" style="background: linear-gradient(135deg, #ec4899, #f43f5e); display: flex; align-items: center; justify-content: center; border-radius: 8px;">
           <span class="material-symbols-outlined text-[20px] text-white">favorite</span>
         </div>`
      : `<div class="playlist-row-art" style="background: linear-gradient(135deg, #3b82f6, #8b5cf6); display: flex; align-items: center; justify-content: center; border-radius: 8px;">
           <svg viewBox="0 0 24 24" width="20" height="20" fill="currentColor" class="text-white">
             <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm1 17h-2v-2h2v2zm2.07-7.75l-.9.92C13.45 12.9 13 13.5 13 15h-2v-.5c0-1.1.45-2.1 1.17-2.83l1.24-1.26c.37-.36.59-.86.59-1.41 0-1.1-.9-2-2-2s-2 .9-2 2H7c0-2.76 2.24-5 5-5s5 2.24 5 5c0 1.04-.42 1.99-1.07 2.75z"/>
           </svg>
         </div>`;

    row.innerHTML = `
      ${artContent}
      <div class="playlist-row-info">
        <div class="playlist-row-name">${escapeHTML(pl.name)}</div>
        <div class="playlist-row-count">${pl.songs.length} song${pl.songs.length === 1 ? '' : 's'}</div>
      </div>
    `;
    row.addEventListener('click', () => {
      showPlaylistDetail(pl.id);
    });
    libraryPlaylistsList.appendChild(row);
  });
}

// Show Playlist Detail overlay (Slide-in mobile subpage)
function showPlaylistDetail(playlistId) {
  state.currentPlaylistId = playlistId;
  let pl;
  if (playlistId === 'downloads') {
    pl = {
      id: 'downloads',
      name: 'Downloaded Songs',
      songs: state.downloadedSongsList || []
    };
  } else {
    pl = PlaylistStore.getPlaylists().find(p => p.id === playlistId);
  }
  if (!pl) return;

  // Toggle detail visibility
  playlistDetailPanel.classList.add('active');

  // Fill in detail header
  playlistNameInput.value = pl.name;
  if (playlistId === 'downloads') {
    playlistNameInput.setAttribute('readonly', 'true');
  } else {
    playlistNameInput.removeAttribute('readonly');
  }
  playlistDetailCount.textContent = `${pl.songs.length} song${pl.songs.length === 1 ? '' : 's'}`;

  // Hide delete button if favorites or downloads
  deletePlaylistBtn.style.display = (playlistId === 'favorites' || playlistId === 'downloads') ? 'none' : 'block';

  // Render song rows
  renderSongsList(pl.songs, playlistSongsList, 'playlist', playlistId);
  saveAppState();
}

// renderForYouTab stub is defined above to prevent crash as this layout uses Home tab scrolls for recommendations

// --- Playlist Overlay Bottom Sheet ---
function showAddToPlaylistOverlay(song) {
  state.selectedSongForOverlay = song;
  overlayPlaylistsList.innerHTML = '';
  
  const playlists = PlaylistStore.getPlaylists();
  playlists.forEach(pl => {
    const btn = document.createElement('button');
    btn.className = 'bottom-sheet-item';
    btn.textContent = pl.name;
    btn.addEventListener('click', () => {
      PlaylistStore.addSongToPlaylist(pl.id, state.selectedSongForOverlay);
      hideAddToPlaylistOverlay();
      
      // Update UI
      renderLibraryPlaylists();
      renderQuickPlaylists();
      
      // If active playlist detail is currently displaying the updated playlist, reload it
      if (playlistDetailPanel.classList.contains('active') && state.currentPlaylistId === pl.id) {
        showPlaylistDetail(pl.id);
      }
    });
    overlayPlaylistsList.appendChild(btn);
  });

  addToPlaylistOverlay.classList.remove('translate-y-full');
}

function hideAddToPlaylistOverlay() {
  addToPlaylistOverlay.classList.add('translate-y-full');
  state.selectedSongForOverlay = null;
}

// --- Tab Switching ---
function switchTab(tabName) {
  state.activeTab = tabName;

  let subtitle = "Ready for some music?";
  if (tabName === 'search') subtitle = "Find your favorites";
  else if (tabName === 'library') subtitle = "Your music catalog";
  else if (tabName === 'profile') subtitle = "Your profile & settings";
  const subEl = document.querySelector('.header-subtitle');
  if (subEl) subEl.textContent = subtitle;

  // Active buttons
  tabButtons.forEach(btn => {
    btn.classList.toggle('active', btn.dataset.tab === tabName);
  });

  // Toggles content divs
  tabContentHome.classList.toggle('hidden', tabName !== 'home');
  tabContentSearch.classList.toggle('hidden', tabName !== 'search');
  tabContentLibrary.classList.toggle('hidden', tabName !== 'library');
  tabContentProfile.classList.toggle('hidden', tabName !== 'profile');

  // Trigger loads / renders
  if (tabName === 'home') {
    renderQuickPlaylists();
  } else if (tabName === 'library') {
    renderLibraryPlaylists();
  }

  // Save app state
  if (typeof saveAppState === 'function') {
    saveAppState();
  }
}

// --- Event Listeners Setup ---
function setupUIEventListeners() {
  // Navigation tabs
  tabButtons.forEach(btn => {
    btn.addEventListener('click', () => {
      // If opening library, close playlist detail panel first
      if (btn.dataset.tab === 'library') {
        playlistDetailPanel.classList.remove('active');
      }
      switchTab(btn.dataset.tab);
    });
  });

  // Mini player tap opens Now Playing
  miniPlayer.addEventListener('click', (e) => {
    if (e.target.closest('#mini-play-btn, #mini-next-btn, #mini-close-btn')) {
      return;
    }
    nowPlayingPanel.classList.add('active');
    initMobileVisualizer();
  });

  // Close mini player
  miniCloseBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    audio.pause();
    setPlayingState(false);
    miniPlayer.classList.add('hidden');
  });

  // Close Now Playing
  panelCloseBtn.addEventListener('click', () => {
    nowPlayingPanel.classList.remove('active');
  });

  // Now Playing menu (three dots) opens Add to Playlist
  if (panelMenuBtn) {
    panelMenuBtn.addEventListener('click', () => {
      const currentList = getCurrentList();
      const currentSong = state.currentSongIndex !== -1 ? currentList[state.currentSongIndex] : null;
      if (currentSong) {
        showAddToPlaylistOverlay(currentSong);
      } else {
        showToast("No song currently playing");
      }
    });
  }

  // Download button in now playing panel
  if (panelDownloadBtn) {
    panelDownloadBtn.addEventListener('click', () => {
      toggleDownloadCurrentSong();
    });
  }

  // Playback control mini
  miniPlayBtn.addEventListener('click', togglePlayPause);
  miniNextBtn.addEventListener('click', playNext);

  // Playback control full screen panel
  panelPlayPauseBtn.addEventListener('click', togglePlayPause);
  panelPrevBtn.addEventListener('click', playPrevious);
  panelNextBtn.addEventListener('click', playNext);

  // Heart Favorite btn
  panelFavBtn.addEventListener('click', toggleFavorite);

  // Playlist detail close button
  playlistBackBtn.addEventListener('click', () => {
    playlistDetailPanel.classList.remove('active');
    renderLibraryPlaylists();
    saveAppState();
  });

  // Playlist delete
  deletePlaylistBtn.addEventListener('click', () => {
    if (state.currentPlaylistId && state.currentPlaylistId !== 'favorites' && state.currentPlaylistId !== 'downloads') {
      if (confirm("Delete this playlist?")) {
        PlaylistStore.deletePlaylist(state.currentPlaylistId);
        playlistDetailPanel.classList.remove('active');
        renderLibraryPlaylists();
        renderQuickPlaylists();
      }
    }
  });

  // Playlist inline renaming
  playlistNameInput.addEventListener('blur', () => {
    const newName = playlistNameInput.value.trim();
    if (newName && state.currentPlaylistId) {
      if (state.currentPlaylistId === 'downloads' || state.currentPlaylistId === 'favorites') return;
      PlaylistStore.renamePlaylist(state.currentPlaylistId, newName);
      renderLibraryPlaylists();
      renderQuickPlaylists();
    }
  });

  playlistNameInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      playlistNameInput.blur();
    }
  });

  // Play playlist button in details
  playlistPlayAllBtn.addEventListener('click', () => {
    const songs = getSourceList();
    if (songs.length > 0) {
      state.currentQueueSource = 'playlist';
      state.queue = [...songs];
      loadSong(0, true);
    }
  });

  // Search input debouncing
  let searchTimeout = null;
  searchInput.addEventListener('input', (e) => {
    const val = e.target.value;
    state.searchText = val;
    
    if (searchTimeout) clearTimeout(searchTimeout);

    if (val.trim() === '') {
      performSearch('');
      return;
    }

    searchTimeout = setTimeout(() => {
      performSearch(val.trim());
    }, 450);
  });

  searchClearBtn.addEventListener('click', () => {
    searchInput.value = '';
    performSearch('');
  });

  // Category card clicks performs direct searches
  categoryCards.forEach(card => {
    card.addEventListener('click', () => {
      const q = card.dataset.query;
      searchInput.value = q;
      performSearch(q);
    });
  });

  // Playlist Add Overlay bottom sheet close
  closeOverlayBtn.addEventListener('click', hideAddToPlaylistOverlay);

  // Close overlay on click outside container
  document.addEventListener('touchstart', (e) => {
    if (!addToPlaylistOverlay.classList.contains('translate-y-full') && 
        !addToPlaylistOverlay.contains(e.target) && 
        !e.target.closest('.row-action-btn')) {
      hideAddToPlaylistOverlay();
    }
  });

  // Show Playlist create modal
  showPlaylistCreateBtn.addEventListener('click', () => {
    createPlaylistModal.classList.remove('hidden');
    modalNewPlaylistInput.value = '';
    modalNewPlaylistInput.focus();
  });

  // Modal actions
  modalCancelBtn.addEventListener('click', () => {
    createPlaylistModal.classList.add('hidden');
  });

  modalCreateBtn.addEventListener('click', () => {
    const name = modalNewPlaylistInput.value.trim();
    if (name) {
      PlaylistStore.createPlaylist(name);
      createPlaylistModal.classList.add('hidden');
      renderLibraryPlaylists();
      renderQuickPlaylists();
    }
  });

  modalNewPlaylistInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      const name = modalNewPlaylistInput.value.trim();
      if (name) {
        PlaylistStore.createPlaylist(name);
        createPlaylistModal.classList.add('hidden');
        renderLibraryPlaylists();
        renderQuickPlaylists();
      }
    }
  });

  // Volume slider in Panel
  panelVolumeSlider.addEventListener('input', (e) => {
    const vol = parseFloat(e.target.value);
    if (fadeInterval) {
      clearInterval(fadeInterval);
      fadeInterval = null;
    }
    targetVolume = vol;
    audio.volume = vol;
    updateVolumeIcon(vol);
    saveAppState();
  });

  panelVolumeToggle.addEventListener('click', () => {
    if (audio.muted) {
      audio.muted = false;
      panelVolMute.classList.add('hidden');
      panelVolHigh.classList.remove('hidden');
      panelVolumeSlider.value = audio.volume;
    } else {
      audio.muted = true;
      panelVolHigh.classList.add('hidden');
      panelVolMute.classList.remove('hidden');
      panelVolumeSlider.value = 0;
    }
    saveAppState();
  });

  // Seekbar seeking panel
  panelSeekBarWrapper.addEventListener('touchstart', (e) => {
    isDraggingSeek = true;
    handleSeekUpdate(e.touches[0]);

    const onTouchMove = (moveEvent) => {
      handleSeekUpdate(moveEvent.touches[0]);
    };

    const onTouchEnd = (endEvent) => {
      isDraggingSeek = false;
      handleSeekUpdate(endEvent.changedTouches[0], true);
      document.removeEventListener('touchmove', onTouchMove);
      document.removeEventListener('touchend', onTouchEnd);
    };

    document.addEventListener('touchmove', onTouchMove);
    document.addEventListener('touchend', onTouchEnd);
  });

  // Support click-to-seek too
  panelSeekBarWrapper.addEventListener('click', (e) => {
    handleSeekUpdate(e, true);
  });

  // Global Retry btn
  retryBtn.addEventListener('click', () => {
    loadChartSongs();
  });

  // --- Hero Cards & Navigation Buttons ---

  // Discover Weekly bento card play button
  const bentoPlayBtn = document.getElementById('bento-play-btn');
  const discoverBentoCard = document.getElementById('discover-bento-card');
  if (bentoPlayBtn) {
    bentoPlayBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      if (state.songs.length > 0) {
        state.currentQueueSource = 'chart';
        loadSong(0, true);
      }
    });
  }
  if (discoverBentoCard) {
    discoverBentoCard.addEventListener('click', () => {
      if (state.songs.length > 0) {
        state.currentQueueSource = 'chart';
        loadSong(0, true);
      }
    });
  }

  // Pulse Mix / Openify Favorites card (Library tab)
  const pulseMixCard = document.getElementById('pulse-mix-card');
  const pulseMixPlayBtn = document.getElementById('pulse-mix-play-btn');
  if (pulseMixPlayBtn) {
    pulseMixPlayBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      const favPlaylist = PlaylistStore.getPlaylists().find(p => p.id === 'favorites');
      if (favPlaylist && favPlaylist.songs.length > 0) {
        state.queue = [...favPlaylist.songs];
        state.currentQueueSource = 'playlist';
        loadSong(0, true);
      } else {
        showToast('No favorites yet. Add some songs first!');
      }
    });
  }
  if (pulseMixCard) {
    pulseMixCard.addEventListener('click', () => {
      showPlaylistDetail('favorites');
    });
  }

  // See All Trending button
  const seeAllTrendingBtn = document.getElementById('home-see-all-trending');
  if (seeAllTrendingBtn) {
    seeAllTrendingBtn.addEventListener('click', () => {
      switchTab('search');
      searchInput.value = 'Trending';
      performSearch('Trending');
    });
  }

  // Search results "Back to Browse" clear button
  const searchResultsClear = document.getElementById('search-results-clear');
  if (searchResultsClear) {
    searchResultsClear.addEventListener('click', () => {
      searchInput.value = '';
      performSearch('');
    });
  }

  // Home category chips (All / New Releases / Trending)
  const homeCategoryChips = document.querySelectorAll('.category-chip');
  homeCategoryChips.forEach(chip => {
    chip.addEventListener('click', () => {
      // Update active styling
      homeCategoryChips.forEach(c => {
        c.classList.remove('bg-primary-container', 'text-on-primary');
        c.classList.add('bg-surface-container/40', 'border', 'border-white/10', 'text-on-surface-variant');
      });
      chip.classList.add('bg-primary-container', 'text-on-primary');
      chip.classList.remove('bg-surface-container/40', 'border', 'border-white/10', 'text-on-surface-variant');

      const category = chip.dataset.category;
      if (category === 'all') {
        // Show all chart songs
        renderTrendingSongs(state.songs);
      } else if (category === 'new' || category === 'trending') {
        // Trigger search with category keyword
        switchTab('search');
        searchInput.value = category === 'new' ? 'New Releases' : 'Trending';
        performSearch(searchInput.value);
      }
    });
  });

  // Shuffle & Repeat buttons
  const panelShuffleBtn = document.getElementById('panel-shuffle-btn');
  const panelRepeatBtn = document.getElementById('panel-repeat-btn');
  if (panelShuffleBtn) {
    panelShuffleBtn.addEventListener('click', toggleShuffle);
  }
  if (panelRepeatBtn) {
    panelRepeatBtn.addEventListener('click', toggleRepeat);
  }

  // Notifications icon click
  const notificationsBtn = document.getElementById('header-notifications-btn');
  if (notificationsBtn) {
    notificationsBtn.addEventListener('click', () => {
      showToast("You're up to date! No new notifications.");
    });
  }

  // Settings gear & avatar redirects to profile/account
  const headerSettingsBtn = document.getElementById('header-settings-btn');
  if (headerSettingsBtn) {
    headerSettingsBtn.addEventListener('click', () => {
      switchTab('profile');
      setTimeout(() => {
        const settingsSection = document.getElementById('settings-section');
        const mainContainer = document.querySelector('main');
        if (settingsSection && mainContainer) {
          const topPos = settingsSection.getBoundingClientRect().top - mainContainer.getBoundingClientRect().top + mainContainer.scrollTop - 16;
          mainContainer.scrollTo({
            top: topPos,
            behavior: 'smooth'
          });
        }
      }, 50);
    });
  }
  const headerAvatarContainer = document.getElementById('header-user-avatar-container');
  if (headerAvatarContainer) {
    headerAvatarContainer.addEventListener('click', () => {
      switchTab('profile');
    });
  }

  // Profile simulated Follow button
  const profileFollowBtn = document.getElementById('profile-follow-btn');
  if (profileFollowBtn) {
    profileFollowBtn.addEventListener('click', () => {
      state.isFollowing = !state.isFollowing;
      if (state.isFollowing) {
        state.followersCount++;
        showToast("Following user");
      } else {
        state.followersCount--;
        showToast("Unfollowed user");
      }
      updateProfileStats();
    });
  }

  // Theme Selector listener
  const selectTheme = document.getElementById('setting-select-theme');
  if (selectTheme) {
    selectTheme.addEventListener('change', (e) => {
      const val = e.target.value;
      applyAppTheme(val);
      const label = document.getElementById('current-theme-label');
      if (label) {
        const option = selectTheme.options[selectTheme.selectedIndex];
        label.textContent = option ? option.textContent : 'Dynamic Extraction';
      }
    });
  }

  // EQ Preset Selector listener
  const selectEQ = document.getElementById('setting-select-eq');
  if (selectEQ) {
    selectEQ.addEventListener('change', (e) => {
      const val = e.target.value;
      applyEQPreset(val);
      const label = document.getElementById('current-eq-label');
      if (label) {
        const option = selectEQ.options[selectEQ.selectedIndex];
        label.textContent = option ? option.textContent : 'Flat';
      }
    });
  }

  // Visualizer Style Selector listener
  const selectVisualizer = document.getElementById('setting-select-visualizer');
  if (selectVisualizer) {
    selectVisualizer.addEventListener('change', (e) => {
      const val = e.target.value;
      visualizerStyle = val;
      localStorage.setItem('openify_visualizer_style', val);
      const label = document.getElementById('current-visualizer-label');
      if (label) {
        const option = selectVisualizer.options[selectVisualizer.selectedIndex];
        label.textContent = option ? option.textContent : 'Radial Ring';
      }
    });
  }

  // Sleep Timer listeners
  const settingItemSleepTimer = document.getElementById('setting-item-sleeptimer');
  const sleeptimerOverlay = document.getElementById('sleeptimer-overlay');
  const closeSleeptimerOverlayBtn = document.getElementById('close-sleeptimer-overlay-btn');
  
  if (settingItemSleepTimer && sleeptimerOverlay) {
    settingItemSleepTimer.addEventListener('click', () => {
      sleeptimerOverlay.classList.remove('translate-y-full');
      updateSleepTimerUI();
    });
  }
  
  if (closeSleeptimerOverlayBtn && sleeptimerOverlay) {
    closeSleeptimerOverlayBtn.addEventListener('click', () => {
      sleeptimerOverlay.classList.add('translate-y-full');
    });
  }

  const optionBtns = document.querySelectorAll('.sleeptimer-option-btn');
  optionBtns.forEach(btn => {
    btn.addEventListener('click', () => {
      const minutes = btn.dataset.minutes;
      if (minutes === 'off') {
        setSleepTimer('off');
      } else {
        setSleepTimer(parseInt(minutes));
      }
      if (sleeptimerOverlay) sleeptimerOverlay.classList.add('translate-y-full');
    });
  });

  const customSetBtn = document.getElementById('sleeptimer-custom-set-btn');
  const customInput = document.getElementById('sleeptimer-custom-input');
  if (customSetBtn && customInput) {
    customSetBtn.addEventListener('click', () => {
      const minutes = parseInt(customInput.value);
      if (minutes > 0) {
        setSleepTimer(minutes);
        customInput.value = '';
        if (sleeptimerOverlay) sleeptimerOverlay.classList.add('translate-y-full');
      } else {
        showToast("Enter a valid number of minutes");
      }
    });
  }

  // Last.fm input listener
  const inputLastfm = document.getElementById('setting-input-lastfm');
  if (inputLastfm) {
    inputLastfm.addEventListener('input', (e) => {
      const username = e.target.value.trim();
      localStorage.setItem('openify_lastfm_user', username);
      updateLastfmProfileUI(username);
    });
  }

  // Initialize profile stats rendering
  updateProfileStats();
}

function toggleShuffle() {
  state.isShuffle = !state.isShuffle;
  updateShuffleRepeatUI();
  showToast(state.isShuffle ? "Shuffle Enabled" : "Shuffle Disabled");
  if (typeof saveAppState === 'function') {
    saveAppState();
  }
}

function toggleRepeat() {
  if (state.repeatMode === 'none') {
    state.repeatMode = 'all';
    showToast("Repeat All");
  } else if (state.repeatMode === 'all') {
    state.repeatMode = 'one';
    showToast("Repeat One");
  } else {
    state.repeatMode = 'none';
    showToast("Repeat Disabled");
  }
  updateShuffleRepeatUI();
  if (typeof saveAppState === 'function') {
    saveAppState();
  }
}

function updateProfileStats() {
  const followersEl = document.getElementById('profile-followers-count');
  const followingEl = document.getElementById('profile-following-count');
  const followBtn = document.getElementById('profile-follow-btn');
  
  if (followersEl) {
    if (state.followersCount >= 1000) {
      followersEl.textContent = (state.followersCount / 1000).toFixed(1) + 'k';
    } else {
      followersEl.textContent = state.followersCount;
    }
  }
  if (followingEl) {
    followingEl.textContent = state.followingCount;
  }
  if (followBtn) {
    if (state.isFollowing) {
      followBtn.textContent = 'Following';
      followBtn.classList.remove('bg-primary-container', 'text-on-primary');
      followBtn.classList.add('bg-surface-container-high', 'text-on-surface-variant', 'border', 'border-white/10');
    } else {
      followBtn.textContent = 'Follow';
      followBtn.classList.add('bg-primary-container', 'text-on-primary');
      followBtn.classList.remove('bg-surface-container-high', 'text-on-surface-variant', 'border', 'border-white/10');
    }
  }
}

function handleSeekUpdate(touchOrClick, performSeek = false) {
  const rect = panelSeekBarWrapper.getBoundingClientRect();
  const clickX = touchOrClick.clientX - rect.left;
  const progress = Math.max(0, Math.min(1, clickX / rect.width));
  
  updateSeekBarProgress(progress);
  panelCurrentTime.textContent = formatTime(progress * (audio.duration || 0));

  if (performSeek && audio.duration) {
    audio.currentTime = progress * audio.duration;
  }
}

function updateVolumeIcon(vol) {
  if (vol === 0) {
    panelVolHigh.classList.add('hidden');
    panelVolMute.classList.remove('hidden');
  } else {
    panelVolMute.classList.add('hidden');
    panelVolHigh.classList.remove('hidden');
  }
}

// --- Swipe Gestures ---
function setupSwipeGestures() {
  let miniPlayerStartY = 0;
  let headerStartY = 0;
  
  // Swipe up on mini player opens now playing
  miniPlayer.addEventListener('touchstart', (e) => {
    miniPlayerStartY = e.touches[0].clientY;
  });

  miniPlayer.addEventListener('touchend', (e) => {
    const endY = e.changedTouches[0].clientY;
    const diffY = endY - miniPlayerStartY;
    // Swipe up (negative Y movement)
    if (diffY < -40) {
      nowPlayingPanel.classList.add('active');
      initMobileVisualizer();
    }
  });

  // Swipe down on Now Playing Header dismisses it
  const header = document.querySelector('.panel-header');
  if (header) {
    header.addEventListener('touchstart', (e) => {
      headerStartY = e.touches[0].clientY;
    });

    header.addEventListener('touchend', (e) => {
      const endY = e.changedTouches[0].clientY;
      const diffY = endY - headerStartY;
      // Swipe down (positive Y movement)
      if (diffY > 40) {
        nowPlayingPanel.classList.remove('active');
      }
    });
  }
}

// --- Dynamic Color Extraction ---
function extractDominantColors(imgUrl) {
  const currentTheme = localStorage.getItem('openify_app_theme') || 'dynamic';
  if (currentTheme !== 'dynamic') {
    const coverUrl = imgUrl;
    if (mobileVinylArt) {
      mobileVinylArt.style.backgroundImage = `url('${coverUrl}')`;
    }
    return;
  }
  const img = new Image();
  img.onload = () => {
    try {
      const canvas = document.createElement('canvas');
      canvas.width = 50;
      canvas.height = 50;
      const ctx = canvas.getContext('2d');
      ctx.drawImage(img, 0, 0, 50, 50);
      const imgData = ctx.getImageData(0, 0, 50, 50).data;

      const buckets = {};
      for (let y = 0; y < 50; y += 2) {
        for (let x = 0; x < 50; x += 2) {
          const idx = (y * 50 + x) * 4;
          const r = imgData[idx] / 255.0;
          const g = imgData[idx + 1] / 255.0;
          const b = imgData[idx + 2] / 255.0;

          const qr = Math.floor(r * 8) * 32;
          const qg = Math.floor(g * 8) * 32;
          const qb = Math.floor(b * 8) * 32;
          const key = `${qr}-${qg}-${qb}`;

          if (buckets[key]) {
            buckets[key].r += r;
            buckets[key].g += g;
            buckets[key].b += b;
            buckets[key].count++;
          } else {
            buckets[key] = { r, g, b, count: 1 };
          }
        }
      }

      const sorted = Object.values(buckets).sort((a, b) => b.count - a.count);
      if (sorted.length === 0) return;

      const primary = sorted[0];
      const secondary = sorted[1] || primary;
      const accent = sorted[2] || secondary;

      // Extract colors mapping values
      const pr = (primary.r / primary.count) * 0.7;
      const pg = (primary.g / primary.count) * 0.7;
      const pb = (primary.b / primary.count) * 0.7;

      const sr = (secondary.r / secondary.count) * 0.6;
      const sg = (secondary.g / secondary.count) * 0.6;
      const sb = (secondary.b / secondary.count) * 0.6;

      const ar = Math.min((accent.r / accent.count) * 1.3, 1.0);
      const ag = Math.min((accent.g / accent.count) * 1.3, 1.0);
      const ab = Math.min((accent.b / accent.count) * 1.3, 1.0);

      const br = (primary.r / primary.count) * 0.15;
      const bg = (primary.g / primary.count) * 0.15;
      const bb = (primary.b / primary.count) * 0.15;

      const colorBackground = `rgb(${Math.round(br * 255)}, ${Math.round(bg * 255)}, ${Math.round(bb * 255)})`;
      const colorSecondary = `rgb(${Math.round(sr * 255)}, ${Math.round(sg * 255)}, ${Math.round(sb * 255)})`;
      const colorAccent = `rgb(${Math.round(ar * 255)}, ${Math.round(ag * 255)}, ${Math.round(ab * 255)})`;

      const root = document.documentElement;
      root.style.setProperty('--primary-color', colorBackground);
      root.style.setProperty('--secondary-color', colorSecondary);
      root.style.setProperty('--accent-color', colorAccent);

      // Accent RGB and Primary RGB for radial gradients
      root.style.setProperty('--accent-rgb', `${Math.round(ar * 255)}, ${Math.round(ag * 255)}, ${Math.round(ab * 255)}`);
      root.style.setProperty('--primary-rgb', `${Math.round(br * 255)}, ${Math.round(bg * 255)}, ${Math.round(bb * 255)}`);
      
      // Sync color extraction variables to playlist rows art/buttons
      const playlistRowArtElements = document.querySelectorAll('.playlist-row-art, .playlist-art-placeholder, .quick-playlist-art');
      playlistRowArtElements.forEach(el => {
        el.style.backgroundColor = colorAccent;
      });
    } catch (e) {
      console.warn("Luminance color extraction failed:", e);
    }
  };
  img.onerror = () => {
    resetColorsToDefault();
  };
  img.src = imgUrl;
}

function resetColorsToDefault() {
  const currentTheme = localStorage.getItem('openify_app_theme') || 'dynamic';
  if (currentTheme !== 'dynamic') {
    applyAppTheme(currentTheme);
    return;
  }
  const root = document.documentElement;
  root.style.setProperty('--primary-color', '#212842');
  root.style.setProperty('--secondary-color', '#2b3352');
  root.style.setProperty('--accent-color', '#6a5acd');
  root.style.setProperty('--accent-rgb', '106, 90, 205');
  root.style.setProperty('--primary-rgb', '33, 40, 66');
}

// --- Star Drift Background Particles (GalaxySidebar visual representation) ---
function setupStarDriftBackground() {
  const canvas = document.getElementById('stars-canvas');
  if (!canvas) return;

  const ctx = canvas.getContext('2d');
  let animationId = null;
  let stars = [];

  function resizeCanvas() {
    canvas.width = canvas.parentElement.clientWidth;
    canvas.height = canvas.parentElement.clientHeight;
    generateStars();
  }

  function generateStars() {
    stars = [];
    const count = 75; // Optimized for mobile viewport sizes
    for (let i = 0; i < count; i++) {
      stars.push({
        x: Math.random() * canvas.width,
        y: Math.random() * canvas.height,
        size: Math.random() * 1.2 + 0.4,
        opacity: Math.random() * 0.45 + 0.15,
        speed: Math.random() * 0.12 + 0.04
      });
    }
  }

  function draw() {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    
    stars.forEach(star => {
      ctx.fillStyle = `rgba(255, 255, 255, ${star.opacity})`;
      ctx.fillRect(star.x, star.y, star.size, star.size);

      // Drift stars
      star.y += star.speed;
      if (star.y > canvas.height) {
        star.y = 0;
        star.x = Math.random() * canvas.width;
      }
    });

    animationId = requestAnimationFrame(draw);
  }

  window.addEventListener('resize', resizeCanvas);
  resizeCanvas();
  draw();

  // Cancel animation on visibilitychange to save power
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) {
      if (animationId) {
        cancelAnimationFrame(animationId);
        animationId = null;
      }
    } else {
      if (!animationId) {
        draw();
      }
    }
  });
}

// --- Utilities ---
function formatTime(seconds) {
  if (isNaN(seconds) || !isFinite(seconds)) return '0:00';
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  return `${mins}:${secs.toString().padStart(2, '0')}`;
}

function showLoading(show) {
  if (show) {
    globalLoading.classList.remove('hidden');
  } else {
    globalLoading.classList.add('hidden');
  }
}

function showError(show, msg = '') {
  if (show) {
    errorText.textContent = msg;
    globalError.classList.remove('hidden');
  } else {
    globalError.classList.add('hidden');
  }
}

function escapeHTML(str) {
  if (!str) return '';
  return str.replace(/[&<>'"]/g, 
    tag => ({
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      "'": '&#39;',
      '"': '&quot;'
    }[tag] || tag)
  );
}

// --- Synced Lyrics Helper Functions ---
function parseLrc(lrcText) {
  if (!lrcText) return [];
  const lines = lrcText.split('\n');
  const result = [];
  const timeRegex = /\[(\d+):(\d+)(?:\.(\d+))?\]/g;

  lines.forEach(line => {
    const matches = [...line.matchAll(timeRegex)];
    if (matches.length === 0) return;
    const text = line.replace(timeRegex, '').trim();
    matches.forEach(match => {
      const minutes = parseInt(match[1], 10);
      const seconds = parseInt(match[2], 10);
      const milliseconds = match[3] ? parseInt(match[3].padEnd(3, '0').substring(0, 3), 10) : 0;
      const time = minutes * 60 + seconds + milliseconds / 1000;
      result.push({ time, text });
    });
  });

  result.sort((a, b) => a.time - b.time);
  return result;
}

async function fetchLyricsForSong(artist, title, songId = null) {
  panelLyricsContainer.innerHTML = '<p class="text-sm text-on-surface-variant py-10 opacity-60">Loading lyrics...</p>';
  state.lyricsType = 'none';
  state.parsedLyrics = [];
  state.activeLyricIndex = -1;

  const currentList = getCurrentList();
  const activeSong = state.currentSongIndex !== -1 ? currentList[state.currentSongIndex] : null;
  const activeSongId = activeSong ? activeSong.id : null;

  if (songId) {
    try {
      const cachedSong = await getDownloadedSong(songId);
      if (cachedSong && cachedSong.lyrics) {
        // Guard check: ensure this request is still relevant to the playing song
        if (activeSongId && songId !== activeSongId) return;

        const data = cachedSong.lyrics;
        state.lyricsType = data.type;
        if (data.type === 'synced') {
          state.parsedLyrics = parseLrc(data.text);
          renderSyncedLyrics();
        } else if (data.type === 'plain') {
          panelLyricsContainer.innerHTML = '';
          const lines = data.text.split('\n');
          lines.forEach(line => {
            const p = document.createElement('p');
            p.className = 'lyrics-line plain-line opacity-80 py-1 text-sm text-on-surface';
            p.textContent = line;
            panelLyricsContainer.appendChild(p);
          });
        } else {
          panelLyricsContainer.innerHTML = `<p class="text-sm text-on-surface-variant py-10 opacity-40">${escapeHTML(data.text || "No lyrics found.")}</p>`;
        }
        return;
      }
    } catch (err) {
      console.warn("Error reading cached lyrics:", err);
    }
  }

  try {
    if (state.lyricsAbortController) {
      state.lyricsAbortController.abort();
    }
    state.lyricsAbortController = new AbortController();
    const res = await fetch(`${BASE_URL}/api/mobile/lyrics?artist=${encodeURIComponent(artist)}&title=${encodeURIComponent(title)}`, { signal: state.lyricsAbortController.signal });
    if (!res.ok) throw new Error("Lyrics request failed");
    const data = await res.json();
    
    // Guard check: ensure this request is still relevant to the playing song
    if (activeSongId && songId && songId !== activeSongId) return;
    const latestList = getCurrentList();
    const latestActiveSong = state.currentSongIndex !== -1 ? latestList[state.currentSongIndex] : null;
    if (latestActiveSong && (latestActiveSong.title !== title || latestActiveSong.artist !== artist)) {
      return;
    }

    state.lyricsType = data.type;
    
    if (data.type === 'synced') {
      state.parsedLyrics = parseLrc(data.text);
      renderSyncedLyrics();
    } else if (data.type === 'plain') {
      panelLyricsContainer.innerHTML = '';
      const lines = data.text.split('\n');
      lines.forEach(line => {
        const p = document.createElement('p');
        p.className = 'lyrics-line plain-line opacity-80 py-1 text-sm text-on-surface';
        p.textContent = line;
        panelLyricsContainer.appendChild(p);
      });
    } else {
      panelLyricsContainer.innerHTML = `<p class="text-sm text-on-surface-variant py-10 opacity-40">${escapeHTML(data.text || "No lyrics found.")}</p>`;
    }
  } catch (err) {
    console.error("Lyrics fetch error:", err);
    panelLyricsContainer.innerHTML = '<p class="text-sm text-on-surface-variant py-10 opacity-40">Lyrics unavailable</p>';
  }
}

function renderSyncedLyrics() {
  panelLyricsContainer.innerHTML = '';
  if (state.parsedLyrics.length === 0) {
    panelLyricsContainer.innerHTML = '<p class="text-sm text-on-surface-variant py-10 opacity-40">No lyrics available.</p>';
    return;
  }

  state.parsedLyrics.forEach((lyric, idx) => {
    const p = document.createElement('p');
    p.className = 'lyrics-line';
    p.dataset.index = idx;
    p.textContent = lyric.text || '...';
    p.addEventListener('click', () => {
      if (audio.duration) {
        audio.currentTime = lyric.time;
      }
    });
    panelLyricsContainer.appendChild(p);
  });
}

function updateLyricsHighlight() {
  if (state.lyricsType !== 'synced' || state.parsedLyrics.length === 0) return;

  const currentTime = audio.currentTime;
  let activeIndex = -1;

  for (let i = 0; i < state.parsedLyrics.length; i++) {
    if (currentTime >= state.parsedLyrics[i].time) {
      activeIndex = i;
    } else {
      break;
    }
  }

  if (activeIndex !== state.activeLyricIndex) {
    state.activeLyricIndex = activeIndex;

    const lines = panelLyricsContainer.querySelectorAll('.lyrics-line');
    lines.forEach((line, idx) => {
      if (idx === activeIndex) {
        line.classList.add('active');
        const containerHeight = panelLyricsContainer.clientHeight;
        const lineTop = line.offsetTop;
        const lineHeight = line.clientHeight;
        panelLyricsContainer.scrollTo({
          top: lineTop - containerHeight / 2 + lineHeight / 2,
          behavior: 'smooth'
        });
      } else {
        line.classList.remove('active');
      }
    });
  }
}

function renderForYouTab() {
  // Staging stub for mobile. Recommended list is rendered in the Home tab scroll viewport.
}

// --- Audio Visualizer & Preferences Helper Functions ---
let audioCtx = null;
let analyser = null;
let source = null;

let mobileVisualizerRunning = false;

// preference variables
let visualizerStyle = localStorage.getItem('openify_visualizer_style') || 'radial';
let sleepTimerId = null;
let sleepTimeRemaining = 0; // in seconds
let sleepTimerIntervalId = null;
let eqBass = null;
let eqMid = null;
let eqTreble = null;

function applyEQPreset(presetName) {
  if (!eqBass || !eqMid || !eqTreble) return;
  const presets = {
    flat: { bass: 0, mid: 0, treble: 0 },
    bass: { bass: 7, mid: 0, treble: -2 },
    treble: { bass: -2, mid: 0, treble: 7 },
    vocal: { bass: -4, mid: 5, treble: 2 },
    dance: { bass: 6, mid: -2, treble: 5 },
    acoustic: { bass: 3, mid: 2, treble: 4 }
  };
  const settings = presets[presetName] || presets.flat;
  eqBass.gain.value = settings.bass;
  eqMid.gain.value = settings.mid;
  eqTreble.gain.value = settings.treble;
  localStorage.setItem('openify_eq_preset', presetName);
}

function applyAppTheme(themeName) {
  localStorage.setItem('openify_app_theme', themeName);
  
  if (themeName === 'dynamic') {
    const currentList = getCurrentList();
    const currentSong = state.currentSongIndex !== -1 ? currentList[state.currentSongIndex] : null;
    if (currentSong && (currentSong.cover_xl || currentSong.cover)) {
      extractDominantColors(currentSong.cover_xl || currentSong.cover);
    } else {
      resetColorsToDefault();
    }
    return;
  }
  
  const root = document.documentElement;
  const themeColors = {
    amoled: {
      primary: '#000000',
      secondary: '#121212',
      accent: '#a3e635',
      accentRgb: '163, 230, 53',
      primaryRgb: '0, 0, 0'
    },
    purple: {
      primary: '#120E2E',
      secondary: '#1B163F',
      accent: '#9D4EDD',
      accentRgb: '157, 78, 221',
      primaryRgb: '18, 14, 46'
    },
    green: {
      primary: '#051A10',
      secondary: '#0A2E1C',
      accent: '#1DB954',
      accentRgb: '29, 185, 84',
      primaryRgb: '5, 26, 16'
    },
    pink: {
      primary: '#240B13',
      secondary: '#3D1420',
      accent: '#FF4D80',
      accentRgb: '255, 77, 128',
      primaryRgb: '36, 11, 19'
    }
  };
  
  const colors = themeColors[themeName] || themeColors.amoled;
  root.style.setProperty('--primary-color', colors.primary);
  root.style.setProperty('--secondary-color', colors.secondary);
  root.style.setProperty('--accent-color', colors.accent);
  root.style.setProperty('--accent-rgb', colors.accentRgb);
  root.style.setProperty('--primary-rgb', colors.primaryRgb);
  
  const playlistRowArtElements = document.querySelectorAll('.playlist-row-art, .playlist-art-placeholder, .quick-playlist-art');
  playlistRowArtElements.forEach(el => {
    el.style.backgroundColor = colors.accent;
  });
}

function setSleepTimer(minutes) {
  if (sleepTimerId) {
    clearTimeout(sleepTimerId);
    sleepTimerId = null;
  }
  if (sleepTimerIntervalId) {
    clearInterval(sleepTimerIntervalId);
    sleepTimerIntervalId = null;
  }

  if (minutes === 'off') {
    sleepTimeRemaining = 0;
    updateSleepTimerUI();
    showToast("Sleep Timer turned off");
    localStorage.removeItem('openify_sleep_timer');
    return;
  }

  const durationMs = minutes * 60 * 1000;
  sleepTimeRemaining = minutes * 60;
  
  sleepTimerId = setTimeout(() => {
    if (state.isPlaying) {
      togglePlayPause();
      showToast("Sleep Timer triggered. Music paused.");
    }
    setSleepTimer('off');
  }, durationMs);

  sleepTimerIntervalId = setInterval(() => {
    sleepTimeRemaining--;
    if (sleepTimeRemaining <= 0) {
      clearInterval(sleepTimerIntervalId);
      sleepTimerIntervalId = null;
    }
    updateSleepTimerUI();
  }, 1000);

  updateSleepTimerUI();
  showToast(`Sleep Timer set for ${minutes} minutes`);
  localStorage.setItem('openify_sleep_timer', minutes);
}

function updateSleepTimerUI() {
  const label = document.getElementById('current-sleeptimer-label');
  const statusLabel = document.getElementById('overlay-sleeptimer-status');
  
  if (sleepTimeRemaining > 0) {
    const mins = Math.floor(sleepTimeRemaining / 60);
    const secs = sleepTimeRemaining % 60;
    const timeStr = `${mins}:${secs.toString().padStart(2, '0')} remaining`;
    
    if (label) label.textContent = timeStr;
    if (statusLabel) statusLabel.textContent = timeStr;
  } else {
    if (label) label.textContent = 'Off';
    if (statusLabel) statusLabel.textContent = 'Inactive';
  }
}

function scrobbleTrackToLastfm(song) {
  const username = localStorage.getItem('openify_lastfm_user');
  if (!username || !song) return;
  console.log(`[Last.fm] Scrobbling track: ${song.title} by ${song.artist} for user ${username}`);
}

function updateLastfmProfileUI(username) {
  const profileLastfm = document.getElementById('profile-user-lastfm');
  const profileLastfmLink = document.getElementById('profile-user-lastfm-link');
  if (profileLastfm && profileLastfmLink) {
    if (username) {
      profileLastfmLink.textContent = username;
      profileLastfmLink.href = `https://www.last.fm/user/${username}`;
      profileLastfm.classList.remove('hidden');
    } else {
      profileLastfm.classList.add('hidden');
    }
  }
}

function initializePreferences() {
  // Theme load
  const savedTheme = localStorage.getItem('openify_app_theme') || 'dynamic';
  const selectTheme = document.getElementById('setting-select-theme');
  if (selectTheme) {
    selectTheme.value = savedTheme;
    const label = document.getElementById('current-theme-label');
    if (label) {
      const option = selectTheme.options[selectTheme.selectedIndex];
      label.textContent = option ? option.textContent : 'Dynamic Extraction';
    }
  }
  applyAppTheme(savedTheme);

  // EQ load
  const savedEQ = localStorage.getItem('openify_eq_preset') || 'flat';
  const selectEQ = document.getElementById('setting-select-eq');
  if (selectEQ) {
    selectEQ.value = savedEQ;
    const label = document.getElementById('current-eq-label');
    if (label) {
      const option = selectEQ.options[selectEQ.selectedIndex];
      label.textContent = option ? option.textContent : 'Flat';
    }
  }

  // Visualizer load
  const savedVisualizer = localStorage.getItem('openify_visualizer_style') || 'radial';
  visualizerStyle = savedVisualizer;
  const selectVisualizer = document.getElementById('setting-select-visualizer');
  if (selectVisualizer) {
    selectVisualizer.value = savedVisualizer;
    const label = document.getElementById('current-visualizer-label');
    if (label) {
      const option = selectVisualizer.options[selectVisualizer.selectedIndex];
      label.textContent = option ? option.textContent : 'Radial Ring';
    }
  }

  // Last.fm load
  const savedLastfm = localStorage.getItem('openify_lastfm_user') || '';
  const inputLastfm = document.getElementById('setting-input-lastfm');
  if (inputLastfm) {
    inputLastfm.value = savedLastfm;
  }
  updateLastfmProfileUI(savedLastfm);
  
  // Sleep Timer init (Off by default on load)
  updateSleepTimerUI();
}

function initMobileVisualizer() {
  // Check if we are on iOS/Safari, or if visualizer style is disabled.
  // If so, we bypass Web Audio API to prevent audio playback block / silence bugs.
  const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent) && !window.MSStream;
  const isSafari = /^((?!chrome|android).)*safari/i.test(navigator.userAgent);
  if (isIOS || isSafari || visualizerStyle === 'none') {
    return;
  }

  try {
    if (!audioCtx) {
      const AudioContext = window.AudioContext || window.webkitAudioContext;
      audioCtx = new AudioContext();
    }
    
    if (!analyser) {
      analyser = audioCtx.createAnalyser();
      analyser.fftSize = 256;
    }

    if (!eqBass) {
      eqBass = audioCtx.createBiquadFilter();
      eqBass.type = 'lowshelf';
      eqBass.frequency.value = 200;
      eqBass.gain.value = 0;
    }
    if (!eqMid) {
      eqMid = audioCtx.createBiquadFilter();
      eqMid.type = 'peaking';
      eqMid.frequency.value = 1000;
      eqMid.Q.value = 1.0;
      eqMid.gain.value = 0;
    }
    if (!eqTreble) {
      eqTreble = audioCtx.createBiquadFilter();
      eqTreble.type = 'highshelf';
      eqTreble.frequency.value = 4000;
      eqTreble.gain.value = 0;
    }
    
    if (!source) {
      source = audioCtx.createMediaElementSource(audio);
      source.connect(eqBass);
      eqBass.connect(eqMid);
      eqMid.connect(eqTreble);
      eqTreble.connect(analyser);
      analyser.connect(audioCtx.destination);
    }

    // Apply saved EQ preset
    const savedPreset = localStorage.getItem('openify_eq_preset') || 'flat';
    applyEQPreset(savedPreset);
    
    if (!mobileVisualizerRunning) {
      mobileVisualizerRunning = true;
      drawMobileVisualizer();
    }
  } catch (e) {
    console.error("Failed to initialize Mobile AudioContext visualizer:", e);
  }
}

function drawMobileVisualizer() {
  const canvas = document.getElementById('mobile-visualizer-canvas');
  if (!canvas) return;
  
  const ctx = canvas.getContext('2d');
  const bufferLength = analyser.frequencyBinCount;
  const dataArray = new Uint8Array(bufferLength);

  const rect = canvas.getBoundingClientRect();
  canvas.width = rect.width || 360;
  canvas.height = rect.height || 360;
  
  function draw() {
    if (!state.isPlaying || !nowPlayingPanel.classList.contains('active')) {
      mobileVisualizerRunning = false;
      return;
    }
    requestAnimationFrame(draw);
    
    const rect = canvas.getBoundingClientRect();
    if (canvas.width !== rect.width || canvas.height !== rect.height) {
      canvas.width = rect.width;
      canvas.height = rect.height;
    }
    
    const accentRgb = getComputedStyle(document.documentElement).getPropertyValue('--accent-rgb').trim() || '196, 242, 102';
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    
    if (visualizerStyle === 'none') {
      return;
    }

    if (visualizerStyle === 'wave') {
      analyser.getByteTimeDomainData(dataArray);
      ctx.lineWidth = 3;
      ctx.strokeStyle = `rgba(${accentRgb}, 0.85)`;
      ctx.shadowBlur = 10;
      ctx.shadowColor = `rgba(${accentRgb}, 0.5)`;
      ctx.beginPath();
      
      const sliceWidth = canvas.width / bufferLength;
      let x = 0;
      for (let i = 0; i < bufferLength; i++) {
        const v = dataArray[i] / 128.0;
        const y = (v * canvas.height) / 2;
        if (i === 0) {
          ctx.moveTo(x, y);
        } else {
          ctx.lineTo(x, y);
        }
        x += sliceWidth;
      }
      ctx.lineTo(canvas.width, canvas.height / 2);
      ctx.stroke();
      ctx.shadowBlur = 0;
      return;
    }

    if (visualizerStyle === 'bars') {
      analyser.getByteFrequencyData(dataArray);
      const barWidth = (canvas.width / bufferLength) * 2.0;
      let barHeight;
      let x = 0;
      for (let i = 0; i < bufferLength; i++) {
        barHeight = (dataArray[i] / 255.0) * canvas.height * 0.8;
        ctx.fillStyle = `rgba(${accentRgb}, ${0.5 + (barHeight / canvas.height) * 0.5})`;
        ctx.fillRect(x, canvas.height - barHeight, barWidth - 2, barHeight);
        x += barWidth;
      }
      return;
    }

    // Default: radial ring
    analyser.getByteFrequencyData(dataArray);
    const centerX = canvas.width / 2;
    const centerY = canvas.height / 2;
    const innerRadius = 135;
    
    let sum = 0;
    for (let i = 0; i < bufferLength; i++) {
      sum += dataArray[i];
    }
    const average = sum / bufferLength;
    const pulse = (average / 255) * 12;
    
    if (average > 0) {
      ctx.beginPath();
      ctx.arc(centerX, centerY, innerRadius + pulse, 0, 2 * Math.PI);
      ctx.fillStyle = `rgba(${accentRgb}, ${0.05 + (average / 255) * 0.15})`;
      ctx.shadowBlur = 20 + pulse * 2;
      ctx.shadowColor = `rgba(${accentRgb}, 0.4)`;
      ctx.fill();
      ctx.shadowBlur = 0;
    }
    
    const numBars = 60;
    for (let i = 0; i < numBars; i++) {
      const dataIdx = Math.floor((i < numBars / 2 ? i : numBars - i) * (bufferLength / 2 / (numBars / 2)));
      const value = dataArray[dataIdx];
      const percent = value / 255;
      const barHeight = percent * 20;
      
      if (barHeight <= 0) continue;
      
      const angle = (i * 2 * Math.PI) / numBars;
      
      const x1 = centerX + Math.cos(angle) * innerRadius;
      const y1 = centerY + Math.sin(angle) * innerRadius;
      const x2 = centerX + Math.cos(angle) * (innerRadius + barHeight);
      const y2 = centerY + Math.sin(angle) * (innerRadius + barHeight);
      
      ctx.strokeStyle = `rgba(${accentRgb}, ${0.3 + percent * 0.7})`;
      ctx.lineWidth = 2.5;
      ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.moveTo(x1, y1);
      ctx.lineTo(x2, y2);
      ctx.stroke();
    }
  }
  
  draw();
}

// --- Volume Fading Helper Functions ---
function fadeTo(volume, duration, onComplete) {
  if (fadeInterval) {
    clearInterval(fadeInterval);
    fadeInterval = null;
  }
  
  const startVolume = audio.volume;
  const diff = volume - startVolume;
  if (diff === 0 || duration <= 0) {
    audio.volume = volume;
    if (onComplete) onComplete();
    return;
  }
  
  const stepTime = 16;
  const steps = duration / stepTime;
  const stepAmount = diff / steps;
  let currentStep = 0;
  
  fadeInterval = setInterval(() => {
    currentStep++;
    let newVol = startVolume + stepAmount * currentStep;
    if (newVol < 0) newVol = 0;
    if (newVol > 1) newVol = 1;
    
    audio.volume = newVol;
    
    if (currentStep >= steps) {
      clearInterval(fadeInterval);
      fadeInterval = null;
      audio.volume = volume;
      if (onComplete) onComplete();
    }
  }, stepTime);
}

// --- Firebase Authentication & Synchronization ---
function setupFirebaseUI() {
  authTabSignIn.addEventListener('click', () => {
    authTabSignIn.classList.add('text-primary-container', 'border-b-2', 'border-primary-container');
    authTabSignIn.classList.remove('text-on-surface-variant');
    
    authTabSignUp.classList.remove('text-primary-container', 'border-b-2', 'border-primary-container');
    authTabSignUp.classList.add('text-on-surface-variant');
    
    authFieldName.classList.add('hidden');
    authSubmitBtn.textContent = 'Sign In';
    authErrorMsg.classList.add('hidden');
  });

  authTabSignUp.addEventListener('click', () => {
    authTabSignUp.classList.add('text-primary-container', 'border-b-2', 'border-primary-container');
    authTabSignUp.classList.remove('text-on-surface-variant');
    
    authTabSignIn.classList.remove('text-primary-container', 'border-b-2', 'border-primary-container');
    authTabSignIn.classList.add('text-on-surface-variant');
    
    authFieldName.classList.remove('hidden');
    authSubmitBtn.textContent = 'Register';
    authErrorMsg.classList.add('hidden');
  });

  authSubmitBtn.addEventListener('click', async () => {
    const email = authInputEmail.value.trim();
    const password = authInputPassword.value;
    const isRegister = authSubmitBtn.textContent === 'Register';
    
    if (!email || !password) {
      showAuthError("Please fill in email and password.");
      return;
    }
    
    if (isRegister) {
      const name = authInputName.value.trim();
      if (!name) {
        showAuthError("Please fill in your name.");
        return;
      }
      try {
        authSubmitBtn.disabled = true;
        authSubmitBtn.textContent = 'Registering...';
        const userCredential = await auth.createUserWithEmailAndPassword(email, password);
        await userCredential.user.updateProfile({
          displayName: name
        });
      } catch (err) {
        showAuthError(err.message);
      } finally {
        authSubmitBtn.disabled = false;
        authSubmitBtn.textContent = 'Register';
      }
    } else {
      try {
        authSubmitBtn.disabled = true;
        authSubmitBtn.textContent = 'Signing In...';
        await auth.signInWithEmailAndPassword(email, password);
      } catch (err) {
        showAuthError(err.message);
      } finally {
        authSubmitBtn.disabled = false;
        authSubmitBtn.textContent = 'Sign In';
      }
    }
  });

  authGoogleBtn.addEventListener('click', async () => {
    const provider = new firebase.auth.GoogleAuthProvider();
    try {
      authGoogleBtn.disabled = true;
      await auth.signInWithPopup(provider);
    } catch (err) {
      console.warn("Google Sign-In via popup failed, trying redirect:", err);
      try {
        await auth.signInWithRedirect(provider);
      } catch (redErr) {
        showAuthError("Google Sign-In failed: " + redErr.message);
      }
    } finally {
      authGoogleBtn.disabled = false;
    }
  });

  authSignoutBtn.addEventListener('click', async () => {
    try {
      await auth.signOut();
    } catch (err) {
      console.error("Sign out error:", err);
    }
  });

  authSyncForceBtn.addEventListener('click', () => {
    syncPlaylistsData(true);
  });
}

function showAuthError(msg) {
  authErrorMsg.textContent = msg;
  authErrorMsg.classList.remove('hidden');
}

function setupFirebaseAuthStateObserver() {
  auth.onAuthStateChanged(async (user) => {
    if (user) {
      authContainer.classList.add('hidden');
      profileContainer.classList.remove('hidden');
      authSignoutBtn.classList.remove('hidden');
      
      profileUserName.textContent = user.displayName || user.email.split('@')[0];
      profileUserEmail.textContent = user.email;
      if (user.photoURL) {
        profileUserAvatar.src = user.photoURL;
        headerUserAvatar.src = user.photoURL;
      } else {
        profileUserAvatar.src = DEFAULT_AVATAR;
        headerUserAvatar.src = DEFAULT_AVATAR;
      }
      setGreeting(user);
      
      cloudSyncIcon.textContent = 'cloud_done';
      cloudSyncIcon.classList.remove('opacity-40');
      cloudSyncIcon.title = 'Synced with Cloud';
      
      await syncPlaylistsData();
      
      PlaylistStore.onSave = async (playlists, affectedId, action) => {
        try {
          if (!auth.currentUser) return;
          const userId = auth.currentUser.uid;
          if (affectedId) {
            const docRef = db.collection('users').doc(userId).collection('playlists').doc(affectedId);
            if (action === 'delete') {
              await docRef.delete();
              console.log(`Firestore playlist ${affectedId} deleted successfully`);
            } else {
              const pl = playlists.find(p => p.id === affectedId);
              if (pl) {
                await docRef.set(JSON.parse(JSON.stringify(pl)));
                console.log(`Firestore playlist ${affectedId} updated (${action}) successfully`);
              }
            }
          } else {
            const batch = db.batch();
            playlists.forEach(pl => {
              const docRef = db.collection('users').doc(userId).collection('playlists').doc(pl.id);
              batch.set(docRef, JSON.parse(JSON.stringify(pl)));
            });
            await batch.commit();
            console.log("Firestore playlists fully synchronized successfully");
          }
        } catch (e) {
          console.error("Failed to sync playlists to Firestore:", e);
        }
      };
      
    } else {
      authContainer.classList.remove('hidden');
      profileContainer.classList.add('hidden');
      authSignoutBtn.classList.add('hidden');
      
      profileUserName.textContent = 'Guest';
      profileUserEmail.textContent = 'guest@openify.com';
      profileUserAvatar.src = DEFAULT_AVATAR;
      headerUserAvatar.src = DEFAULT_AVATAR;
      setGreeting(null);
      
      cloudSyncIcon.textContent = 'cloud_off';
      cloudSyncIcon.classList.add('opacity-40');
      cloudSyncIcon.title = 'Not Synced';
      
      PlaylistStore.onSave = null;
    }
  });
}

async function syncPlaylistsData(forceSync = false) {
  const user = auth.currentUser;
  if (!user) return;
  
  try {
    if (syncDashboardStatus) syncDashboardStatus.textContent = 'Syncing...';
    const userId = user.uid;
    const localPlaylists = PlaylistStore.getPlaylists();
    
    const snapshot = await db.collection('users').doc(userId).collection('playlists').get();
    const firestorePlaylists = [];
    snapshot.forEach(doc => {
      firestorePlaylists.push(doc.data());
    });
    
    const batch = db.batch();
    let hasUploads = false;
    let hasDownloads = false;
    
    localPlaylists.forEach(localPl => {
      const match = firestorePlaylists.find(f => f.id === localPl.id);
      if (!match) {
        const docRef = db.collection('users').doc(userId).collection('playlists').doc(localPl.id);
        batch.set(docRef, JSON.parse(JSON.stringify(localPl)));
        firestorePlaylists.push(localPl);
        hasUploads = true;
      } else {
        const localTime = localPl.updatedAt || 0;
        const matchTime = match.updatedAt || 0;
        if (forceSync || localTime > matchTime) {
          const docRef = db.collection('users').doc(userId).collection('playlists').doc(localPl.id);
          batch.set(docRef, JSON.parse(JSON.stringify(localPl)));
          hasUploads = true;
        }
      }
    });
    
    if (hasUploads) {
      await batch.commit();
    }
    
    // Filter out uploaded local playlists from the download loop to avoid self-comparison bug
    const originalFirestorePlaylists = firestorePlaylists.filter(f => 
      !localPlaylists.some(l => l.id === f.id) || 
      (f.updatedAt && f.updatedAt > (localPlaylists.find(l => l.id === f.id)?.updatedAt || 0))
    );
    
    let updatedLocalPlaylists = [...localPlaylists];
    originalFirestorePlaylists.forEach(fPl => {
      const localIdx = updatedLocalPlaylists.findIndex(l => l.id === fPl.id);
      if (localIdx === -1) {
        updatedLocalPlaylists.push(fPl);
        hasDownloads = true;
      } else {
        const localPl = updatedLocalPlaylists[localIdx];
        const localTime = localPl.updatedAt || 0;
        const fTime = fPl.updatedAt || 0;
        if (forceSync || fTime > localTime) {
          updatedLocalPlaylists[localIdx] = fPl;
          hasDownloads = true;
        }
      }
    });
    
    if (hasDownloads) {
      const originalOnSave = PlaylistStore.onSave;
      PlaylistStore.onSave = null;
      PlaylistStore.savePlaylists(updatedLocalPlaylists);
      PlaylistStore.onSave = originalOnSave;
    }
    
    profilePlaylistsCount.textContent = updatedLocalPlaylists.length;
    
    if (state.activeTab === 'library') {
      renderLibraryPlaylists();
      renderQuickPlaylists();
    }
    
    // Fetch personalized recommendations based on favorites if none are currently loaded
    if (state.behaviorRecommendations.length === 0 && state.contentRecommendations.length === 0) {
      const favorites = updatedLocalPlaylists.find(p => p.id === 'favorites');
      if (favorites && favorites.songs.length > 0) {
        const lastFav = favorites.songs[favorites.songs.length - 1];
        if (lastFav && lastFav.id) {
          console.log(`Preloading personalized recommendations based on last favorite track: ${lastFav.title}`);
          loadRecommendations(lastFav.id);
        }
      }
    }

    if (syncDashboardStatus) syncDashboardStatus.textContent = 'All synced';
    console.log("Two-way Firebase sync finished successfully.");
  } catch (err) {
    console.error("Error during Firestore sync:", err);
    if (syncDashboardStatus) syncDashboardStatus.textContent = 'Sync failed';
  }
}

// --- IndexedDB Offline Storage Helper Functions ---
let dbInstance = null;

function initOfflineDb() {
  return new Promise((resolve, reject) => {
    if (dbInstance) {
      resolve(dbInstance);
      return;
    }
    const request = indexedDB.open('openify_offline_db', 1);
    request.onupgradeneeded = (e) => {
      const db = e.target.result;
      if (!db.objectStoreNames.contains('songs')) {
        db.createObjectStore('songs', { keyPath: 'id' });
      }
    };
    request.onsuccess = (e) => {
      dbInstance = e.target.result;
      resolve(dbInstance);
    };
    request.onerror = (e) => {
      console.error("IndexedDB open error:", e.target.error);
      reject(e.target.error);
    };
  });
}

function getDownloadedSong(songId) {
  return new Promise(async (resolve) => {
    try {
      const db = await initOfflineDb();
      const transaction = db.transaction('songs', 'readonly');
      const store = transaction.objectStore('songs');
      const request = store.get(songId);
      request.onsuccess = (e) => {
        resolve(e.target.result || null);
      };
      request.onerror = () => {
        resolve(null);
      };
    } catch (err) {
      resolve(null);
    }
  });
}

function isSongDownloaded(songId) {
  return new Promise(async (resolve) => {
    try {
      const db = await initOfflineDb();
      const transaction = db.transaction('songs', 'readonly');
      const store = transaction.objectStore('songs');
      const request = store.getKey(songId);
      request.onsuccess = (e) => {
        resolve(e.target.result !== undefined);
      };
      request.onerror = () => {
        resolve(false);
      };
    } catch (err) {
      resolve(false);
    }
  });
}

function saveDownloadedSong(song, audioBlob, lyrics = null) {
  return new Promise(async (resolve, reject) => {
    try {
      const db = await initOfflineDb();
      const transaction = db.transaction('songs', 'readwrite');
      const store = transaction.objectStore('songs');
      const record = {
        id: song.id,
        title: song.title,
        artist: song.artist,
        album: song.album || '',
        cover: song.cover || '',
        cover_xl: song.cover_xl || '',
        duration: song.duration || 0,
        audioBlob: audioBlob,
        lyrics: lyrics,
        downloadedAt: Date.now()
      };
      const request = store.put(record);
      request.onsuccess = () => {
        resolve(true);
      };
      request.onerror = (e) => {
        reject(e.target.error);
      };
    } catch (err) {
      reject(err);
    }
  });
}

function deleteDownloadedSong(songId) {
  return new Promise(async (resolve, reject) => {
    try {
      const db = await initOfflineDb();
      const transaction = db.transaction('songs', 'readwrite');
      const store = transaction.objectStore('songs');
      const request = store.delete(songId);
      request.onsuccess = () => {
        resolve(true);
      };
      request.onerror = (e) => {
        reject(e.target.error);
      };
    } catch (err) {
      reject(err);
    }
  });
}

function getAllDownloadedSongs() {
  return new Promise(async (resolve) => {
    try {
      const db = await initOfflineDb();
      const transaction = db.transaction('songs', 'readonly');
      const store = transaction.objectStore('songs');
      const request = store.getAll();
      request.onsuccess = (e) => {
        resolve(e.target.result || []);
      };
      request.onerror = () => {
        resolve([]);
      };
    } catch (err) {
      resolve([]);
    }
  });
}

// --- Download Manager Logic ---
function updateDownloadIconState(status) {
  if (!downloadIconHollow || !downloadIconSolid || !downloadIconLoading) return;
  
  downloadIconHollow.classList.add('hidden');
  downloadIconSolid.classList.add('hidden');
  downloadIconLoading.classList.add('hidden');
  
  if (status === 'solid') {
    downloadIconSolid.classList.remove('hidden');
  } else if (status === 'loading') {
    downloadIconLoading.classList.remove('hidden');
  } else {
    downloadIconHollow.classList.remove('hidden');
  }
}

async function downloadSong(song) {
  updateDownloadIconState('loading');
  try {
    const playUrl = `${BASE_URL}/api/mobile/play?id=${song.id}&artist=${encodeURIComponent(song.artist)}&title=${encodeURIComponent(song.title)}`;
    const playRes = await fetch(playUrl);
    if (!playRes.ok) throw new Error("Failed to get stream url");
    const streamInfo = await playRes.json();
    
    const audioRes = await fetch(streamInfo.url);
    if (!audioRes.ok) throw new Error("Failed to download audio stream");
    const audioBlob = await audioRes.blob();
    
    let lyricsData = null;
    try {
      const lyricsRes = await fetch(`${BASE_URL}/api/mobile/lyrics?artist=${encodeURIComponent(song.artist)}&title=${encodeURIComponent(song.title)}`);
      if (lyricsRes.ok) {
        lyricsData = await lyricsRes.json();
      }
    } catch (err) {
      console.warn("Failed to download lyrics for caching:", err);
    }
    
    await saveDownloadedSong(song, audioBlob, lyricsData);
    state.downloadedSongsList = await getAllDownloadedSongs();
    updateDownloadIconState('solid');
    showToast(`"${song.title}" downloaded offline`);
    renderLibraryPlaylists();
  } catch (err) {
    console.error("Failed to download song:", err);
    updateDownloadIconState('hollow');
    showToast("Download failed. Check your network.");
  }
}

async function removeDownload(songId) {
  try {
    await deleteDownloadedSong(songId);
    state.downloadedSongsList = await getAllDownloadedSongs();
    updateDownloadIconState('hollow');
    showToast("Song removed from downloads");
    renderLibraryPlaylists();
  } catch (err) {
    console.error("Failed to delete song:", err);
    showToast("Failed to delete download");
  }
}

async function toggleDownloadCurrentSong() {
  const list = getCurrentList();
  const song = list[state.currentSongIndex];
  if (!song) return;
  
  const downloaded = await isSongDownloaded(song.id);
  if (downloaded) {
    await removeDownload(song.id);
  } else {
    await downloadSong(song);
  }
}

// --- Library Filters Setup ---
function setupLibraryFilters() {
  const chips = document.querySelectorAll('.library-filter-chip');
  chips.forEach(chip => {
    chip.addEventListener('click', () => {
      chips.forEach(c => {
        c.className = 'bg-surface-container-highest/40 text-on-surface-variant font-semibold text-xs uppercase tracking-wider px-5 py-2 rounded-full whitespace-nowrap border border-white/5 hover:bg-surface-container-highest transition-colors library-filter-chip';
      });
      chip.className = 'bg-primary-container text-on-primary font-semibold text-xs uppercase tracking-wider px-5 py-2 rounded-full whitespace-nowrap active-glow transition-all library-filter-chip';
      state.libraryFilter = chip.dataset.filter;
      renderLibraryPlaylists();
    });
  });
}

// --- Offline Check Helper ---
function checkOffline() {
  return settingOfflineMode && settingOfflineMode.checked;
}

// --- Dynamic Toast Component ---
function showToast(message) {
  let container = document.getElementById('toast-container');
  if (!container) {
    container = document.createElement('div');
    container.id = 'toast-container';
    container.className = 'fixed bottom-24 left-1/2 -translate-x-1/2 z-50 flex flex-col gap-2 pointer-events-none w-full max-w-xs px-4';
    document.body.appendChild(container);
  }
  
  const toast = document.createElement('div');
  toast.className = 'bg-surface-container-highest/90 backdrop-blur-md text-white text-xs font-semibold px-4 py-3 rounded-xl shadow-2xl border border-white/10 flex items-center justify-center transition-all duration-300 opacity-0 translate-y-2';
  toast.textContent = message;
  
  container.appendChild(toast);
  toast.offsetHeight; // trigger reflow
  
  toast.classList.remove('opacity-0', 'translate-y-2');
  
  setTimeout(() => {
    toast.classList.add('opacity-0', '-translate-y-2');
    setTimeout(() => {
      toast.remove();
    }, 300);
  }, 3000);
}

// --- State Persistence (Local Storage Cache) ---
function saveAppState() {
  if (isRestoringState) return;
  const stateToSave = {
    currentSongIndex: state.currentSongIndex,
    activeTab: state.activeTab,
    currentPlaylistId: state.currentPlaylistId,
    currentQueueSource: state.currentQueueSource,
    searchText: state.searchText,
    searchResults: state.searchResults,
    playbackHistory: state.playbackHistory,
    upNextRecommendations: state.upNextRecommendations,
    behaviorRecommendations: state.behaviorRecommendations,
    contentRecommendations: state.contentRecommendations,
    songs: state.songs,
    queue: state.queue,
    isShuffle: state.isShuffle,
    repeatMode: state.repeatMode,
    isPlaylistDetailActive: playlistDetailPanel ? playlistDetailPanel.classList.contains('active') : false,
    volume: targetVolume,
    isMuted: audio ? audio.muted : false
  };
  localStorage.setItem('openify_app_state', JSON.stringify(stateToSave));
}

function loadAppState() {
  const savedStateStr = localStorage.getItem('openify_app_state');
  if (!savedStateStr) return;
  isRestoringState = true;
  try {
    const savedState = JSON.parse(savedStateStr);
    
    state.songs = savedState.songs || state.songs;
    state.queue = savedState.queue || [];
    state.currentSongIndex = savedState.currentSongIndex !== undefined ? savedState.currentSongIndex : state.currentSongIndex;
    state.activeTab = savedState.activeTab || state.activeTab;
    state.currentPlaylistId = savedState.currentPlaylistId || state.currentPlaylistId;
    state.currentQueueSource = savedState.currentQueueSource || state.currentQueueSource;
    state.searchText = savedState.searchText || '';
    state.searchResults = savedState.searchResults || [];
    state.playbackHistory = savedState.playbackHistory || [];
    state.upNextRecommendations = savedState.upNextRecommendations || [];
    state.behaviorRecommendations = savedState.behaviorRecommendations || [];
    state.contentRecommendations = savedState.contentRecommendations || [];
    state.isShuffle = savedState.isShuffle !== undefined ? savedState.isShuffle : state.isShuffle;
    state.repeatMode = savedState.repeatMode || state.repeatMode;
    
    // Switch to active tab
    if (state.activeTab) {
      switchTab(state.activeTab);
    }
    
    // Restore search input and results if search text is present
    if (state.searchText && searchInput) {
      searchInput.value = state.searchText;
      searchClearBtn.classList.remove('hidden');
      categoriesContainer.classList.add('hidden');
      resultsContainer.classList.remove('hidden');
      renderSongsList(state.searchResults, resultsList, 'search');
    }
    
    // Restore playlist detail panel if active
    if (state.activeTab === 'library' && state.currentPlaylistId && savedState.isPlaylistDetailActive) {
      showPlaylistDetail(state.currentPlaylistId);
    }

    // Restore volume and mute states
    if (savedState.volume !== undefined) {
      targetVolume = savedState.volume;
      audio.volume = targetVolume;
      if (panelVolumeSlider) panelVolumeSlider.value = targetVolume;
      updateVolumeIcon(targetVolume);
    }
    if (savedState.isMuted !== undefined) {
      audio.muted = savedState.isMuted;
      if (audio.muted) {
        panelVolHigh.classList.add('hidden');
        panelVolMute.classList.remove('hidden');
        if (panelVolumeSlider) panelVolumeSlider.value = 0;
      } else {
        panelVolMute.classList.add('hidden');
        panelVolHigh.classList.remove('hidden');
        if (panelVolumeSlider) panelVolumeSlider.value = targetVolume;
      }
    }
    
    // Update shuffle and repeat UI elements
    updateShuffleRepeatUI();

    // Load the restored song into the player (without autoplaying)
    if (state.currentSongIndex !== -1) {
      loadSong(state.currentSongIndex, false);
    }
    
    // Highlight currently playing song row
    updateActiveRowHighlight();
  } catch (e) {
    console.error("Failed to load app state from localStorage:", e);
  } finally {
    isRestoringState = false;
  }
}

// --- Shuffle & Repeat UI Styling Helper ---
function updateShuffleRepeatUI() {
  const panelShuffleBtn = document.getElementById('panel-shuffle-btn');
  if (panelShuffleBtn) {
    if (state.isShuffle) {
      panelShuffleBtn.classList.add('text-primary-container');
      panelShuffleBtn.classList.remove('text-on-surface-variant');
    } else {
      panelShuffleBtn.classList.remove('text-primary-container');
      panelShuffleBtn.classList.add('text-on-surface-variant');
    }
  }

  const panelRepeatBtn = document.getElementById('panel-repeat-btn');
  if (panelRepeatBtn) {
    const icon = panelRepeatBtn.querySelector('span');
    if (state.repeatMode === 'none') {
      panelRepeatBtn.classList.remove('text-primary-container');
      panelRepeatBtn.classList.add('text-on-surface-variant');
      if (icon) icon.textContent = 'repeat';
    } else if (state.repeatMode === 'all') {
      panelRepeatBtn.classList.add('text-primary-container');
      panelRepeatBtn.classList.remove('text-on-surface-variant');
      if (icon) icon.textContent = 'repeat';
    } else if (state.repeatMode === 'one') {
      panelRepeatBtn.classList.add('text-primary-container');
      panelRepeatBtn.classList.remove('text-on-surface-variant');
      if (icon) icon.textContent = 'repeat_one';
    }
  }
}

// --- Media Session API (System lock screen / notification / controls) ---
function updateMediaSession(song) {
  if (!song) return;
  if ('mediaSession' in navigator) {
    navigator.mediaSession.metadata = new MediaMetadata({
      title: song.title || 'Unknown',
      artist: song.artist || 'Unknown',
      album: song.album || 'Single',
      artwork: [
        { src: song.cover || '', sizes: '200x200', type: 'image/jpeg' },
        { src: song.cover_xl || song.cover || '', sizes: '600x600', type: 'image/jpeg' }
      ]
    });

    // Set action handlers
    navigator.mediaSession.setActionHandler('play', () => togglePlayPause());
    navigator.mediaSession.setActionHandler('pause', () => togglePlayPause());
    navigator.mediaSession.setActionHandler('previoustrack', () => playPrevious());
    navigator.mediaSession.setActionHandler('nexttrack', () => playNext());
    
    try {
      navigator.mediaSession.setActionHandler('seekto', (details) => {
        if (details.fastSeek && 'fastSeek' in audio) {
          audio.fastSeek(details.seekTime);
        } else {
          audio.currentTime = details.seekTime;
        }
        updatePlaybackState();
      });
    } catch (e) {
      console.warn("MediaSession seekto not supported:", e);
    }
  }
}

function updatePlaybackState() {
  if ('mediaSession' in navigator) {
    navigator.mediaSession.playbackState = state.isPlaying ? 'playing' : 'paused';
  }
}

// --- Global Keyboard Shortcuts ---
document.addEventListener('keydown', (e) => {
  const activeEl = document.activeElement;
  if (activeEl && (activeEl.tagName === 'INPUT' || activeEl.tagName === 'TEXTAREA' || activeEl.isContentEditable)) {
    return;
  }

  switch (e.code) {
    case 'Space':
      e.preventDefault();
      togglePlayPause();
      break;
    case 'ArrowRight':
      e.preventDefault();
      if (audio) {
        audio.currentTime = Math.min(audio.duration || 0, audio.currentTime + 5);
        panelCurrentTime.textContent = formatTime(audio.currentTime);
      }
      break;
    case 'ArrowLeft':
      e.preventDefault();
      if (audio) {
        audio.currentTime = Math.max(0, audio.currentTime - 5);
        panelCurrentTime.textContent = formatTime(audio.currentTime);
      }
      break;
    case 'ArrowUp':
      e.preventDefault();
      if (audio) {
        const newVol = Math.min(1, audio.volume + 0.05);
        audio.volume = newVol;
        targetVolume = newVol;
        if (panelVolumeSlider) panelVolumeSlider.value = newVol;
        updateVolumeIcon(newVol);
      }
      break;
    case 'ArrowDown':
      e.preventDefault();
      if (audio) {
        const newVol = Math.max(0, audio.volume - 0.05);
        audio.volume = newVol;
        targetVolume = newVol;
        if (panelVolumeSlider) panelVolumeSlider.value = newVol;
        updateVolumeIcon(newVol);
      }
      break;
    case 'KeyM':
      e.preventDefault();
      if (panelVolumeToggle) panelVolumeToggle.click();
      break;
    case 'KeyL':
      e.preventDefault();
      toggleFavorite();
      break;
  }
});
