/* ==========================================================================
   Openify Playlist Store - Local Storage database wrapper
   ========================================================================== */

const PlaylistStore = {
  KEY: 'openify_playlists',

  getPlaylists() {
    try {
      const data = localStorage.getItem(this.KEY);
      if (!data) {
        // Initialize with default Favorites playlist
        const defaults = [{
          id: 'favorites',
          name: 'My Favorites',
          description: 'Your favorite tracks',
          songs: [],
          updatedAt: Date.now()
        }];
        localStorage.setItem(this.KEY, JSON.stringify(defaults));
        return defaults;
      }
      return JSON.parse(data);
    } catch (e) {
      console.error("Failed to parse playlists:", e);
      return [];
    }
  },

  savePlaylists(playlists) {
    try {
      localStorage.setItem(this.KEY, JSON.stringify(playlists));
      // Dispatch storage event to keep views in sync if running multiple instances
      window.dispatchEvent(new Event('storage'));
    } catch (e) {
      console.error("Failed to save playlists:", e);
    }
  },

  createPlaylist(name, description = '') {
    if (!name.trim()) return null;
    const playlists = this.getPlaylists();
    const newPlaylist = {
      id: 'pl_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9),
      name: name.trim(),
      description: description.trim(),
      songs: [],
      updatedAt: Date.now()
    };
    playlists.push(newPlaylist);
    this.savePlaylists(playlists);
    return newPlaylist;
  },

  deletePlaylist(id) {
    if (id === 'favorites') return false; // Prevent deleting favorites
    let playlists = this.getPlaylists();
    playlists = playlists.filter(p => p.id !== id);
    this.savePlaylists(playlists);
    return true;
  },

  renamePlaylist(id, newName) {
    if (!newName.trim()) return false;
    const playlists = this.getPlaylists();
    const pl = playlists.find(p => p.id === id);
    if (pl) {
      pl.name = newName.trim();
      pl.updatedAt = Date.now();
      this.savePlaylists(playlists);
      return true;
    }
    return false;
  },

  addSongToPlaylist(playlistId, song) {
    if (!song || !song.id) return false;
    const playlists = this.getPlaylists();
    const pl = playlists.find(p => p.id === playlistId);
    if (pl) {
      // Check if song already exists in this playlist
      const exists = pl.songs.some(s => s.id === song.id);
      if (!exists) {
        // Deep copy song object to prevent reference pollution
        pl.songs.push(JSON.parse(JSON.stringify(song)));
        pl.updatedAt = Date.now();
        this.savePlaylists(playlists);
        return true;
      }
    }
    return false;
  },

  removeSongFromPlaylist(playlistId, songId) {
    const playlists = this.getPlaylists();
    const pl = playlists.find(p => p.id === playlistId);
    if (pl) {
      pl.songs = pl.songs.filter(s => s.id !== songId);
      pl.updatedAt = Date.now();
      this.savePlaylists(playlists);
      return true;
    }
    return false;
  }
};
