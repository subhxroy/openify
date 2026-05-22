/* ==========================================================================
   Openify Renderer - Application Logic, Audio Streaming & Dynamic Color Theming
   ========================================================================== */

// --- Configuration ---
const BASE_URL = 'http://localhost:8000';

// --- State Management ---
let state = {
  songs: [],
  currentSongIndex: -1,
  isPlaying: false,
  isBuffering: false,
  searchText: '',
  searchResults: [],
  playbackHistory: [],
  upNextRecommendations: [],
  
  // Playlist & Recommendations additions
  activeTab: 'home', // 'home' | 'playlists' | 'recommend'
  currentPlaylistId: null,
  selectedSongForOverlay: null,
  currentQueueSource: 'chart', // 'chart' | 'search' | 'playlist' | 'recommend_behavior' | 'recommend_content'
  behaviorRecommendations: [],
  contentRecommendations: []
};

// --- DOM Elements ---
const songsContainer = document.getElementById('songs-container');
const loadingIndicator = document.getElementById('loading-indicator');
const errorContainer = document.getElementById('error-container');
const errorMessage = document.getElementById('error-message');
const retryBtn = document.getElementById('retry-btn');
const listHeader = document.getElementById('list-header');

const searchInput = document.getElementById('search-input');
const searchClearBtn = document.getElementById('search-clear-btn');

const vinylDiscContainer = document.getElementById('vinyl-disc-container');
const vinylDisc = document.getElementById('vinyl-disc');
const vinylCenterImage = document.getElementById('vinyl-center-image');
const needleArm = document.getElementById('needle-arm');

const playPauseBtn = document.getElementById('play-pause-btn');
const playIcon = document.getElementById('play-icon');
const pauseIcon = document.getElementById('pause-icon');
const prevBtn = document.getElementById('prev-btn');
const nextBtn = document.getElementById('next-btn');

const seekBarWrapper = document.getElementById('seek-bar-wrapper');
const seekBarFill = document.getElementById('seek-bar-fill');
const seekBarHandle = document.getElementById('seek-bar-handle');
const currentTimeText = document.getElementById('current-time');
const durationTimeText = document.getElementById('duration-time');
const bufferingStatus = document.getElementById('buffering-status');

const volumeSlider = document.getElementById('volume-slider');
const volumeToggleBtn = document.getElementById('volume-toggle-btn');
const volumeHighIcon = document.getElementById('volume-high-icon');
const volumeMuteIcon = document.getElementById('volume-mute-icon');

const largeAlbumArt = document.getElementById('large-album-art');
const albumArtFallback = document.getElementById('album-art-fallback');
const songTitleText = document.getElementById('song-title');
const songArtistText = document.getElementById('song-artist');

// Tab buttons
const tabHome = document.getElementById('tab-home');
const tabPlaylists = document.getElementById('tab-playlists');
const tabRecommend = document.getElementById('tab-recommend');

// Subview containers
const playlistsContainer = document.getElementById('playlists-container');
const playlistsList = document.getElementById('playlists-list');
const newPlaylistInput = document.getElementById('new-playlist-input');
const createPlaylistBtn = document.getElementById('create-playlist-btn');

const playlistDetailContainer = document.getElementById('playlist-detail-container');
const playlistBackBtn = document.getElementById('playlist-back-btn');
const deletePlaylistBtn = document.getElementById('delete-playlist-btn');
const playlistDetailName = document.getElementById('playlist-detail-name');
const playlistDetailDesc = document.getElementById('playlist-detail-desc');
const playlistSongsContainer = document.getElementById('playlist-songs-container');

const recommendationsContainer = document.getElementById('recommendations-container');
const recBehaviorContainer = document.getElementById('rec-behavior-container');
const recContentContainer = document.getElementById('rec-content-container');

// Overlay elements
const addToPlaylistOverlay = document.getElementById('add-to-playlist-overlay');
const overlayPlaylistsList = document.getElementById('overlay-playlists-list');
const closeOverlayBtn = document.getElementById('close-overlay-btn');

// --- HTML5 Audio Setup ---
const audio = new Audio();
audio.crossOrigin = "anonymous";
audio.volume = parseFloat(volumeSlider.value);
let isDraggingSeek = false;

// --- Volume Fading & Visualizer State ---
let fadeInterval = null;
let targetVolume = parseFloat(volumeSlider.value);
let audioCtx = null;
let analyser = null;
let source = null;

// --- Initialize App ---
document.addEventListener('DOMContentLoaded', () => {
  setupAudioListeners();
  setupUIEventListeners();
  setupStarDriftBackground();
  loadChartSongs();
});

// --- API Calls ---

async function loadChartSongs() {
  showLoading(true);
  showError(false);
  try {
    const res = await fetch(`${BASE_URL}/api/mobile/chart`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    state.songs = data;
    showLoading(false);
    
    if (state.songs.length > 0) {
      renderSongsList(state.songs);
      // Auto-load first song but do not play until user clicks
      loadSong(0, false);
    } else {
      showError(true, "No chart songs found on server.");
    }
  } catch (err) {
    showLoading(false);
    showError(true, err.message);
  }
}

async function performSearch(query) {
  if (!query) {
    state.searchText = '';
    renderSongsList(state.songs);
    listHeader.textContent = 'TRENDING';
    searchClearBtn.classList.add('hidden');
    return;
  }

  showLoading(true);
  searchClearBtn.classList.remove('hidden');
  try {
    const res = await fetch(`${BASE_URL}/api/mobile/search?q=${encodeURIComponent(query)}`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    state.searchResults = data;
    showLoading(false);
    
    listHeader.textContent = 'RESULTS';
    renderSongsList(state.searchResults);
  } catch (err) {
    showLoading(false);
    renderSongsList([]);
    console.error("Search error:", err);
  }
}

async function loadUpNext(songId) {
  try {
    const res = await fetch(`${BASE_URL}/api/mobile/up_next?song_id=${songId}&limit=10`);
    if (res.ok) {
      const data = await res.json();
      // Filter out songs with unknown/empty titles
      state.upNextRecommendations = data.filter(s => s.title && s.title !== "Unknown");
    }
  } catch (err) {
    console.error("UpNext load failed:", err);
    state.upNextRecommendations = [];
  }
}

// --- Player Logic ---

function getCurrentList() {
  if (state.currentQueueSource === 'playlist') {
    const playlists = PlaylistStore.getPlaylists();
    const pl = playlists.find(p => p.id === state.currentPlaylistId);
    return pl ? pl.songs : [];
  } else if (state.currentQueueSource === 'search') {
    return state.searchResults;
  } else if (state.currentQueueSource === 'recommend_behavior') {
    return state.behaviorRecommendations;
  } else if (state.currentQueueSource === 'recommend_content') {
    return state.contentRecommendations;
  } else {
    return state.songs;
  }
}

async function loadRecommendations(songId) {
  try {
    const res = await fetch(`${BASE_URL}/api/mobile/recommend?song_id=${songId}`);
    if (res.ok) {
      const data = await res.json();
      state.behaviorRecommendations = data.behavior_based || [];
      state.contentRecommendations = data.content_based || [];
      
      // Update the recommendations view if active
      if (state.activeTab === 'recommend') {
        renderRecommendations();
      }
    }
  } catch (err) {
    console.error("Recommendations load failed:", err);
    state.behaviorRecommendations = [];
    state.contentRecommendations = [];
  }
}

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
  
  const stepTime = 16; // ~60fps
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

function initVisualizer() {
  if (audioCtx) return;
  
  try {
    const AudioContext = window.AudioContext || window.webkitAudioContext;
    audioCtx = new AudioContext();
    
    analyser = audioCtx.createAnalyser();
    analyser.fftSize = 256;
    
    source = audioCtx.createMediaElementSource(audio);
    source.connect(analyser);
    analyser.connect(audioCtx.destination);
    
    drawVisualizer();
  } catch (e) {
    console.error("Failed to initialize AudioContext visualizer:", e);
  }
}

function drawVisualizer() {
  const canvas = document.getElementById('visualizer-canvas');
  if (!canvas) return;
  
  const ctx = canvas.getContext('2d');
  const bufferLength = analyser.frequencyBinCount;
  const dataArray = new Uint8Array(bufferLength);
  
  function draw() {
    requestAnimationFrame(draw);
    
    const rect = canvas.getBoundingClientRect();
    if (canvas.width !== rect.width || canvas.height !== rect.height) {
      canvas.width = rect.width;
      canvas.height = rect.height;
    }
    
    analyser.getByteFrequencyData(dataArray);
    
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    
    const centerX = canvas.width / 2;
    const centerY = canvas.height / 2;
    const innerRadius = 215; // Vinyl container is 440px wide, so radius is 220. We start at 215.
    
    const accentRgb = getComputedStyle(document.documentElement).getPropertyValue('--accent-rgb').trim() || '106, 90, 205';
    
    // Average volume for pulse
    let sum = 0;
    for (let i = 0; i < bufferLength; i++) {
      sum += dataArray[i];
    }
    const average = sum / bufferLength;
    const pulse = (average / 255) * 15;
    
    // Pulse ambient shadow behind vinyl
    if (average > 0) {
      ctx.beginPath();
      ctx.arc(centerX, centerY, innerRadius + pulse, 0, 2 * Math.PI);
      ctx.fillStyle = `rgba(${accentRgb}, ${0.1 + (average / 255) * 0.2})`;
      ctx.shadowBlur = 30 + pulse * 2;
      ctx.shadowColor = `rgba(${accentRgb}, 0.5)`;
      ctx.fill();
      ctx.shadowBlur = 0;
    }
    
    // Radial bars
    const numBars = 80;
    for (let i = 0; i < numBars; i++) {
      const dataIdx = Math.floor((i < numBars / 2 ? i : numBars - i) * (bufferLength / 2 / (numBars / 2)));
      const value = dataArray[dataIdx];
      const percent = value / 255;
      const barHeight = percent * 25;
      
      if (barHeight <= 0) continue;
      
      const angle = (i * 2 * Math.PI) / numBars;
      
      const x1 = centerX + Math.cos(angle) * innerRadius;
      const y1 = centerY + Math.sin(angle) * innerRadius;
      const x2 = centerX + Math.cos(angle) * (innerRadius + barHeight);
      const y2 = centerY + Math.sin(angle) * (innerRadius + barHeight);
      
      ctx.strokeStyle = `rgba(${accentRgb}, ${0.4 + percent * 0.6})`;
      ctx.lineWidth = 3;
      ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.moveTo(x1, y1);
      ctx.lineTo(x2, y2);
      ctx.stroke();
    }
  }
  
  draw();
}

function loadSong(index, shouldPlay = true) {
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

  // Update Right Panel UI
  songTitleText.textContent = song.title;
  songArtistText.textContent = song.artist;
  
  const coverUrl = song.cover_xl || song.cover;
  if (coverUrl) {
    largeAlbumArt.src = coverUrl;
    largeAlbumArt.classList.remove('hidden');
    albumArtFallback.classList.add('hidden');
    
    // Dynamic color extraction
    extractDominantColors(coverUrl);
    
    // Vinyl Center Label Art
    vinylCenterImage.style.backgroundImage = `url('${coverUrl}')`;
  } else {
    largeAlbumArt.classList.add('hidden');
    albumArtFallback.classList.remove('hidden');
    vinylCenterImage.style.backgroundImage = 'none';
    resetColorsToDefault();
  }

  // Pre-load recommendations / Up Next
  loadUpNext(song.id);
  loadRecommendations(song.id);

  // Update active song row highlight
  updateActiveRowHighlight();

  // Reset progress slider
  updateSeekBarProgress(0);
  currentTimeText.textContent = '0:00';
  durationTimeText.textContent = formatTime(song.duration || 0);

  // Fetch Stream Info from Server
  setBuffering(true);
  
  const playUrl = `${BASE_URL}/api/mobile/play?id=${song.id}&artist=${encodeURIComponent(song.artist)}&title=${encodeURIComponent(song.title)}${previousSongId ? `&previous_song_id=${previousSongId}` : ''}`;
  
  fetch(playUrl)
    .then(res => {
      if (!res.ok) throw new Error("Stream unreachable");
      return res.json();
    })
    .then(streamInfo => {
      audio.src = streamInfo.url;
      if (shouldPlay) {
        audio.volume = 0;
        audio.play().then(() => {
          setPlayingState(true);
          fadeTo(targetVolume, 400);
        }).catch(err => {
          console.warn("Audio play failed on start:", err);
          setPlayingState(false);
          setBuffering(false);
        });
      } else {
        audio.volume = targetVolume;
        setPlayingState(false);
        setBuffering(false);
      }
    })
    .catch(err => {
      console.error("Failed to load stream url:", err);
      setBuffering(false);
      setPlayingState(false);
    });
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

  // If we have custom upNext recommendations loaded, use the first one
  if (state.upNextRecommendations.length > 0 && state.currentQueueSource !== 'playlist') {
    const nextRecSong = state.upNextRecommendations.shift();
    // Add it to our current list so it stays in queue
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
      console.error("Audio resume failed:", err);
    });
  }
}

function setPlayingState(playing) {
  state.isPlaying = playing;
  if (playing) {
    playIcon.classList.add('hidden');
    pauseIcon.classList.remove('hidden');
    vinylDisc.classList.add('playing');
    needleArm.classList.add('playing');
  } else {
    playIcon.classList.remove('hidden');
    pauseIcon.classList.add('hidden');
    vinylDisc.classList.remove('playing');
    needleArm.classList.remove('playing');
  }
}

function setBuffering(buffering) {
  state.isBuffering = buffering;
  if (buffering) {
    bufferingStatus.classList.remove('hidden');
  } else {
    bufferingStatus.classList.add('hidden');
  }
}

// --- Audio Listeners ---

function setupAudioListeners() {
  audio.addEventListener('timeupdate', () => {
    if (isDraggingSeek) return;
    const progress = audio.duration ? (audio.currentTime / audio.duration) : 0;
    updateSeekBarProgress(progress);
    currentTimeText.textContent = formatTime(audio.currentTime);
  });

  audio.addEventListener('durationchange', () => {
    durationTimeText.textContent = formatTime(audio.duration || 0);
  });

  audio.addEventListener('ended', () => {
    playNext();
  });

  audio.addEventListener('waiting', () => {
    setBuffering(true);
  });

  audio.addEventListener('playing', () => {
    setBuffering(false);
    setPlayingState(true);
    initVisualizer();
    if (audioCtx && audioCtx.state === 'suspended') {
      audioCtx.resume();
    }
  });

  audio.addEventListener('stalled', () => {
    setBuffering(true);
  });

  audio.addEventListener('canplay', () => {
    setBuffering(false);
  });

  audio.addEventListener('error', (e) => {
    console.error("Audio playback error occurred:", e);
    setBuffering(false);
    setPlayingState(false);
  });
}

// --- UI Rendering ---

function renderSongsList(songsList, container = songsContainer, queueSource = 'chart', playlistId = null) {
  container.innerHTML = '';
  if (songsList.length === 0) {
    container.innerHTML = '<div class="loading-text" style="padding: 20px; text-align: center; color: rgba(255,255,255,0.3); font-size:11px;">No songs yet.</div>';
    return;
  }

  const currentList = getCurrentList();
  const currentSong = state.currentSongIndex !== -1 ? currentList[state.currentSongIndex] : null;

  songsList.forEach((song, i) => {
    const isCurrentActive = currentSong && song && song.id === currentSong.id && state.currentQueueSource === queueSource;
    const row = document.createElement('div');
    row.className = `song-row ${isCurrentActive ? 'active' : ''}`;
    row.dataset.index = i;

    const formattedIdx = String(i + 1).padStart(2, '0');

    // Create action buttons: add to playlist or remove from playlist
    let actionBtnHtml = '';
    if (playlistId) {
      actionBtnHtml = `
        <button class="btn-row-action remove" title="Remove from playlist">
          <svg viewBox="0 0 24 24" width="12" height="12" fill="currentColor">
            <path d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z"/>
          </svg>
        </button>
      `;
    } else {
      actionBtnHtml = `
        <button class="btn-row-action add" title="Add to playlist">
          <svg viewBox="0 0 24 24" width="12" height="12" fill="currentColor">
            <path d="M19 13h-6v6h-2v-6H5v-2h6V5h2v6h6v2z"/>
          </svg>
        </button>
      `;
    }

    row.innerHTML = `
      <div class="song-index">${formattedIdx}</div>
      <div class="play-state-indicator">
        <svg class="row-play-icon" viewBox="0 0 24 24">
          <path d="M8 5v14l11-7z"/>
        </svg>
      </div>
      <div class="song-meta">
        <div class="song-row-title">${escapeHTML(song.title)}</div>
        <div class="song-row-artist">${escapeHTML(song.artist)}</div>
      </div>
      <div class="song-row-actions">
        ${actionBtnHtml}
      </div>
    `;

    // Click handler for row to play song
    row.addEventListener('click', (e) => {
      // If clicking action buttons, do not trigger play
      if (e.target.closest('.btn-row-action')) return;
      state.currentQueueSource = queueSource;
      // If we are in playlist detail or recommendation, we need to load from that queue
      if (queueSource === 'playlist') {
        state.currentPlaylistId = playlistId;
      }
      loadSong(i, true);
    });

    // Action button handler
    const actionBtn = row.querySelector('.btn-row-action');
    if (actionBtn) {
      actionBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        if (playlistId) {
          PlaylistStore.removeSongFromPlaylist(playlistId, song.id);
          // Re-render playlist view
          const pl = PlaylistStore.getPlaylists().find(p => p.id === playlistId);
          if (pl) {
            playlistDetailDesc.textContent = `${pl.songs.length} song${pl.songs.length === 1 ? '' : 's'}`;
            renderSongsList(pl.songs, playlistSongsContainer, 'playlist', playlistId);
          }
        } else {
          showAddToPlaylistOverlay(song, e);
        }
      });
    }

    container.appendChild(row);
  });
}

function updateActiveRowHighlight() {
  const currentList = getCurrentList();
  const currentSong = state.currentSongIndex !== -1 ? currentList[state.currentSongIndex] : null;

  // Helper to highlight a container's rows
  const highlightContainer = (container, queueSource) => {
    const rows = container.querySelectorAll('.song-row');
    rows.forEach((row, idx) => {
      const list = queueSource === 'chart' ? (state.searchText ? state.searchResults : state.songs) :
                   queueSource === 'search' ? state.searchResults :
                   queueSource === 'playlist' ? (PlaylistStore.getPlaylists().find(p => p.id === state.currentPlaylistId)?.songs || []) :
                   queueSource === 'recommend_behavior' ? state.behaviorRecommendations :
                   queueSource === 'recommend_content' ? state.contentRecommendations : [];
      const song = list[idx];
      if (currentSong && song && song.id === currentSong.id && state.currentQueueSource === queueSource) {
        row.classList.add('active');
      } else {
        row.classList.remove('active');
      }
    });
  };

  highlightContainer(songsContainer, state.searchText ? 'search' : 'chart');
  highlightContainer(playlistSongsContainer, 'playlist');
  highlightContainer(recBehaviorContainer, 'recommend_behavior');
  highlightContainer(recContentContainer, 'recommend_content');
}

function updateSeekBarProgress(progress) {
  const percent = progress * 100;
  seekBarFill.style.width = `${percent}%`;
  seekBarHandle.style.left = `${percent}%`;
}

// --- DOM Event Listeners ---

// Tab Switching
function switchTab(tabName) {
  state.activeTab = tabName;
  
  // Highlight tab buttons
  tabHome.classList.toggle('active', tabName === 'home');
  tabPlaylists.classList.toggle('active', tabName === 'playlists');
  tabRecommend.classList.toggle('active', tabName === 'recommend');

  // Toggle container views
  // Home view elements (header + songs list)
  listHeader.classList.toggle('hidden', tabName !== 'home');
  songsContainer.classList.toggle('hidden', tabName !== 'home');

  // Playlists list view
  playlistsContainer.classList.toggle('hidden', tabName !== 'playlists');
  playlistDetailContainer.classList.add('hidden'); // Always hide detail when toggling tab

  // Recommendations view
  recommendationsContainer.classList.toggle('hidden', tabName !== 'recommend');

  if (tabName === 'playlists') {
    renderPlaylists();
  } else if (tabName === 'recommend') {
    renderRecommendations();
  } else if (tabName === 'home') {
    // Re-render home list to match active play indicators
    renderSongsList(state.searchText ? state.searchResults : state.songs, songsContainer, state.searchText ? 'search' : 'chart');
  }
}

// Render Playlists
function renderPlaylists() {
  playlistsList.innerHTML = '';
  const playlists = PlaylistStore.getPlaylists();
  if (playlists.length === 0) {
    playlistsList.innerHTML = '<div class="loading-text" style="padding: 20px; text-align: center; color: rgba(255,255,255,0.3); font-size:11px;">No playlists. Create one above!</div>';
    return;
  }

  playlists.forEach(pl => {
    const row = document.createElement('div');
    row.className = 'playlist-item-row';
    row.innerHTML = `
      <div class="playlist-item-icon">
        <svg viewBox="0 0 24 24" width="14" height="14" fill="currentColor">
          <path d="M4 6H2v14c0 1.1.9 2 2 2h14v-2H4V6zm16-4H8c-1.1 0-2 .9-2 2v12c0 1.1.9 2 2 2h12c1.1 0 2-.9 2-2V4c0-1.1-.9-2-2-2zm0 14H8V4h12v12z"/>
        </svg>
      </div>
      <div class="playlist-item-meta">
        <div class="playlist-item-name">${escapeHTML(pl.name)}</div>
        <div class="playlist-item-count">${pl.songs.length} song${pl.songs.length === 1 ? '' : 's'}</div>
      </div>
    `;
    row.addEventListener('click', () => {
      showPlaylistDetail(pl.id);
    });
    playlistsList.appendChild(row);
  });
}

// Show Playlist Detail View
function showPlaylistDetail(playlistId) {
  state.currentPlaylistId = playlistId;
  const pl = PlaylistStore.getPlaylists().find(p => p.id === playlistId);
  if (!pl) return;

  // Toggle views
  playlistsContainer.classList.add('hidden');
  playlistDetailContainer.classList.remove('hidden');

  // Fill details
  playlistDetailName.value = pl.name;
  playlistDetailDesc.textContent = `${pl.songs.length} song${pl.songs.length === 1 ? '' : 's'}`;

  // If this is the "favorites" playlist, disable delete button
  deletePlaylistBtn.style.display = playlistId === 'favorites' ? 'none' : 'flex';

  renderSongsList(pl.songs, playlistSongsContainer, 'playlist', playlistId);
}

// Render Recommendations
function renderRecommendations() {
  recBehaviorContainer.innerHTML = '';
  recContentContainer.innerHTML = '';

  const behaviorList = state.behaviorRecommendations || [];
  const contentList = state.contentRecommendations || [];

  if (behaviorList.length === 0 && contentList.length === 0) {
    const placeholder = `<div class="loading-text" style="padding: 30px; text-align: center; color: rgba(255,255,255,0.25); font-size: 11px;">Play a song to load recommendations!</div>`;
    recBehaviorContainer.innerHTML = placeholder;
    return;
  }

  renderSongsList(behaviorList, recBehaviorContainer, 'recommend_behavior');
  renderSongsList(contentList, recContentContainer, 'recommend_content');
}

// Add to Playlist Popover Overlay logic
function showAddToPlaylistOverlay(song, event) {
  state.selectedSongForOverlay = song;
  overlayPlaylistsList.innerHTML = '';

  const playlists = PlaylistStore.getPlaylists();
  
  playlists.forEach(pl => {
    const btn = document.createElement('button');
    btn.className = 'overlay-playlist-item';
    btn.textContent = pl.name;
    btn.addEventListener('click', () => {
      PlaylistStore.addSongToPlaylist(pl.id, state.selectedSongForOverlay);
      hideAddToPlaylistOverlay();
      
      // Update current playlist view if open
      if (state.activeTab === 'playlists' && state.currentPlaylistId === pl.id) {
        showPlaylistDetail(pl.id);
      } else if (state.activeTab === 'playlists') {
        renderPlaylists();
      }
    });
    overlayPlaylistsList.appendChild(btn);
  });

  // Position overlay near cursor or keep it centered (styles center it)
  addToPlaylistOverlay.classList.remove('hidden');
}

function hideAddToPlaylistOverlay() {
  addToPlaylistOverlay.classList.add('hidden');
  state.selectedSongForOverlay = null;
}

function setupUIEventListeners() {
  // Playback Control Buttons
  playPauseBtn.addEventListener('click', togglePlayPause);
  prevBtn.addEventListener('click', playPrevious);
  nextBtn.addEventListener('click', playNext);

  // Tab switching
  tabHome.addEventListener('click', () => switchTab('home'));
  tabPlaylists.addEventListener('click', () => switchTab('playlists'));
  tabRecommend.addEventListener('click', () => switchTab('recommend'));

  // Playlist creation
  createPlaylistBtn.addEventListener('click', () => {
    const name = newPlaylistInput.value.trim();
    if (name) {
      PlaylistStore.createPlaylist(name);
      newPlaylistInput.value = '';
      renderPlaylists();
    }
  });

  newPlaylistInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      const name = newPlaylistInput.value.trim();
      if (name) {
        PlaylistStore.createPlaylist(name);
        newPlaylistInput.value = '';
        renderPlaylists();
      }
    }
  });

  // Playlist detail handlers
  playlistBackBtn.addEventListener('click', () => {
    playlistDetailContainer.classList.add('hidden');
    playlistsContainer.classList.remove('hidden');
    renderPlaylists();
  });

  deletePlaylistBtn.addEventListener('click', () => {
    if (state.currentPlaylistId && state.currentPlaylistId !== 'favorites') {
      if (confirm("Delete this playlist?")) {
        PlaylistStore.deletePlaylist(state.currentPlaylistId);
        playlistDetailContainer.classList.add('hidden');
        playlistsContainer.classList.remove('hidden');
        renderPlaylists();
      }
    }
  });

  playlistDetailName.addEventListener('blur', () => {
    const newName = playlistDetailName.value.trim();
    if (newName && state.currentPlaylistId) {
      PlaylistStore.renamePlaylist(state.currentPlaylistId, newName);
    }
  });

  playlistDetailName.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      playlistDetailName.blur();
    }
  });

  // Overlay closing
  closeOverlayBtn.addEventListener('click', hideAddToPlaylistOverlay);

  // Close overlay on click outside
  document.addEventListener('mousedown', (e) => {
    if (!addToPlaylistOverlay.classList.contains('hidden') && 
        !addToPlaylistOverlay.contains(e.target) && 
        !e.target.closest('.btn-row-action')) {
      hideAddToPlaylistOverlay();
    }
  });

  // Seek bar dragging / clicking
  seekBarWrapper.addEventListener('mousedown', (e) => {
    isDraggingSeek = true;
    handleSeekUpdate(e);

    const onMouseMove = (moveEvent) => {
      handleSeekUpdate(moveEvent);
    };

    const onMouseUp = (upEvent) => {
      isDraggingSeek = false;
      handleSeekUpdate(upEvent, true);
      document.removeEventListener('mousemove', onMouseMove);
      document.removeEventListener('mouseup', onMouseUp);
    };

    document.addEventListener('mousemove', onMouseMove);
    document.addEventListener('mouseup', onMouseUp);
  });

  // Volume slider
  volumeSlider.addEventListener('input', (e) => {
    const vol = parseFloat(e.target.value);
    audio.volume = vol;
    updateVolumeIcon(vol);
  });

  volumeToggleBtn.addEventListener('click', () => {
    if (audio.muted) {
      audio.muted = false;
      volumeMuteIcon.classList.add('hidden');
      volumeHighIcon.classList.remove('hidden');
      volumeSlider.value = audio.volume;
    } else {
      audio.muted = true;
      volumeHighIcon.classList.add('hidden');
      volumeMuteIcon.classList.remove('hidden');
      volumeSlider.value = 0;
    }
  });

  // Search input debouncing
  let searchTimeout = null;
  searchInput.addEventListener('input', (e) => {
    const text = e.target.value;
    state.searchText = text;
    
    if (searchTimeout) clearTimeout(searchTimeout);

    if (text.trim() === '') {
      performSearch('');
      return;
    }

    searchTimeout = setTimeout(() => {
      performSearch(text.trim());
    }, 400);
  });

  searchClearBtn.addEventListener('click', () => {
    searchInput.value = '';
    performSearch('');
  });

  // Retry server connection
  retryBtn.addEventListener('click', () => {
    loadChartSongs();
  });
}

function handleSeekUpdate(e, performSeek = false) {
  const rect = seekBarWrapper.getBoundingClientRect();
  const clickX = e.clientX - rect.left;
  const progress = Math.max(0, Math.min(1, clickX / rect.width));
  
  updateSeekBarProgress(progress);
  currentTimeText.textContent = formatTime(progress * (audio.duration || 0));

  if (performSeek && audio.duration) {
    audio.currentTime = progress * audio.duration;
  }
}

function updateVolumeIcon(vol) {
  if (vol === 0) {
    volumeHighIcon.classList.add('hidden');
    volumeMuteIcon.classList.remove('hidden');
  } else {
    volumeMuteIcon.classList.add('hidden');
    volumeHighIcon.classList.remove('hidden');
  }
}

// --- Dynamic Color Extraction ---

function extractDominantColors(imgUrl) {
  const img = new Image();
  // With webSecurity disabled in Electron, omit crossOrigin to allow normal loading
  // without CORS preflight while keeping canvas readable
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

      // Match SwiftUI extractor constants:
      // primary = rgb(r*0.7, g*0.7, b*0.7)
      // secondary = rgb(r*0.6, g*0.6, b*0.6)
      // accent = rgb(min(r*1.3, 1), min(g*1.3, 1), min(b*1.3, 1))
      // background = rgb(r*0.15, g*0.15, b*0.15)
      
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

      const luminance = (primary.r / primary.count) * 0.299 + (primary.g / primary.count) * 0.587 + (primary.b / primary.count) * 0.114;
      const textDark = luminance > 0.6 ? '#111111' : '#ffffff';

      // Apply style variables to document
      const root = document.documentElement;
      root.style.setProperty('--primary-color', colorBackground);
      root.style.setProperty('--secondary-color', colorSecondary);
      root.style.setProperty('--accent-color', colorAccent);
      root.style.setProperty('--text-dark', textDark);

      // Accent RGB and Primary RGB for radial transparency gradient glow
      root.style.setProperty('--accent-rgb', `${Math.round(ar * 255)}, ${Math.round(ag * 255)}, ${Math.round(ab * 255)}`);
      root.style.setProperty('--primary-rgb', `${Math.round(br * 255)}, ${Math.round(bg * 255)}, ${Math.round(bb * 255)}`);
    } catch (e) {
      console.warn("Dynamic colors extraction failed (CORS or canvas drawing error):", e);
    }
  };
  img.onerror = () => {
    resetColorsToDefault();
  };
  img.src = imgUrl;
}

function resetColorsToDefault() {
  const root = document.documentElement;
  root.style.setProperty('--primary-color', '#212842');
  root.style.setProperty('--secondary-color', '#2b3352');
  root.style.setProperty('--accent-color', '#6a5acd');
  root.style.setProperty('--text-dark', '#1A1A1A');
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
    const count = 120; // Matches macOS canvas count exactly
    for (let i = 0; i < count; i++) {
      stars.push({
        x: Math.random() * canvas.width,
        y: Math.random() * canvas.height,
        size: Math.random() * 1.3 + 0.5,
        opacity: Math.random() * 0.5 + 0.2,
        speed: Math.random() * 0.15 + 0.05
      });
    }
  }

  function draw() {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    
    // Draw space stars using fillRect to avoid expensive path creation and arc drawing
    stars.forEach(star => {
      ctx.fillStyle = `rgba(255, 255, 255, ${star.opacity})`;
      ctx.fillRect(star.x, star.y, star.size, star.size);

      // Drift stars downward slowly
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
    loadingIndicator.classList.remove('hidden');
  } else {
    loadingIndicator.classList.add('hidden');
  }
}

function showError(show, msg = '') {
  if (show) {
    errorMessage.textContent = msg;
    errorContainer.classList.remove('hidden');
    songsContainer.classList.add('hidden');
  } else {
    errorContainer.classList.add('hidden');
    songsContainer.classList.remove('hidden');
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
