const express = require('express');
const path = require('path');
const fetch = require('node-fetch');
const querystring = require('querystring');
const fs = require('fs');

const app = express();
const PORT = 8888;

// Add JSON body parser middleware
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

const client_id = '912bb50a22594399a78e33880f0bb1f4';
const client_secret = '441304d2cbbc4330be2d0869f273c364';
const redirect_uri = 'http://127.0.0.1:8888/callback';

// Database file path
const DB_FILE = path.join(__dirname, 'songstats.json');

// Initialize database if it doesn't exist
function initializeDatabase() {
  if (!fs.existsSync(DB_FILE)) {
    fs.writeFileSync(DB_FILE, JSON.stringify({
      songs: {},
      totalGuesses: 0
    }));
    console.log('Database initialized');
  }
}

// Load database
function loadDatabase() {
  try {
    const data = fs.readFileSync(DB_FILE, 'utf8');
    return JSON.parse(data);
  } catch (error) {
    console.error('Error loading database:', error);
    return { songs: {}, totalGuesses: 0 };
  }
}

// Save database
function saveDatabase(data) {
  try {
    fs.writeFileSync(DB_FILE, JSON.stringify(data, null, 2));
    return true;
  } catch (error) {
    console.error('Error saving database:', error);
    return false;
  }
}

// Initialize database on startup
initializeDatabase();

// Updated scopes for full functionality
const scope = [
  'user-library-read',      // To access liked songs
  'streaming',              // For Web Playback SDK
  'user-read-email',        // Get user's email
  'user-read-private',      // Get subscription status
  'user-read-playback-state',
  'user-modify-playback-state',
  'app-remote-control',     // Required for playback control
  'user-read-currently-playing',
  'user-read-recently-played'
].join(' ');

app.listen(PORT, () => {
  console.log(`Server listening at http://localhost:${PORT}`);
  console.log(`Redirect URI is set to: ${redirect_uri}`);
});

app.get('/login', (req, res) => {
  res.clearCookie('spotify_auth_state');
  
  const params = new URLSearchParams({
    response_type: 'code',
    client_id: client_id,
    scope: scope,
    redirect_uri: redirect_uri,
    show_dialog: true // Force show the auth dialog
  });
  
  const authURL = 'https://accounts.spotify.com/authorize?' + params.toString();
  console.log('Redirecting to Spotify auth URL:', authURL);
  res.redirect(authURL);
});

app.get('/callback', async (req, res) => {
  const code = req.query.code || null;
  if (!code) {
    console.error('No code provided in callback');
    return res.send('No code provided by Spotify');
  }

  try {
    console.log('Received auth code:', code);
    const tokenResponse = await fetch('https://accounts.spotify.com/api/token', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Authorization': 'Basic ' + Buffer.from(client_id + ':' + client_secret).toString('base64')
      },
      body: querystring.stringify({
        code: code,
        redirect_uri: redirect_uri,
        grant_type: 'authorization_code'
      }),
    });

    const tokenData = await tokenResponse.json();
    console.log('Token response received:', {
      ...tokenData,
      access_token: tokenData.access_token ? '***' : undefined
    });

    if (tokenData.error) {
      console.error('Error obtaining token:', tokenData);
      return res.send(`Error obtaining token from Spotify: ${JSON.stringify(tokenData)}`);
    }

    console.log('Successfully obtained access token');
    const access_token = tokenData.access_token;
    
    // Send HTML that will handle the redirect and token storage
    res.send(`
      <!DOCTYPE html>
      <html>
        <body>
          <script>
            const token = ${JSON.stringify(access_token)};
            console.log('Storing token in localStorage:', token ? '***' : 'no token');
            localStorage.setItem('spotify_access_token', token);
            window.location.href = '/#' + new URLSearchParams({
              access_token: token
            }).toString();
          </script>
          <p>Authenticating...</p>
        </body>
      </html>
    `);
  } catch (error) {
    console.error('Error in /callback:', error);
    res.send(`Server error in /callback: ${error.message}`);
  }
});

// API endpoint to record a guess for a song
app.post('/api/record-guess', (req, res) => {
  try {
    const { songId, songName, artist, guessTime, isCorrect } = req.body;
    
    if (!songId || typeof guessTime !== 'number') {
      return res.status(400).json({ error: 'Missing required fields' });
    }
    
    const db = loadDatabase();
    
    // Initialize song data if it doesn't exist
    if (!db.songs[songId]) {
      db.songs[songId] = {
        name: songName,
        artist: artist,
        guesses: [],
        totalGuesses: 0,
        correctGuesses: 0,
        averageTime: 0
      };
    }
    
    // Add the new guess
    db.songs[songId].guesses.push({
      time: guessTime,
      correct: isCorrect,
      timestamp: Date.now()
    });
    
    // Update statistics
    db.songs[songId].totalGuesses++;
    db.totalGuesses++;
    
    if (isCorrect) {
      db.songs[songId].correctGuesses++;
    }
    
    // Calculate new average time (only for correct guesses)
    const correctGuesses = db.songs[songId].guesses.filter(g => g.correct);
    if (correctGuesses.length > 0) {
      const totalTime = correctGuesses.reduce((sum, guess) => sum + guess.time, 0);
      db.songs[songId].averageTime = Math.round(totalTime / correctGuesses.length);
    }
    
    // Save the updated database
    saveDatabase(db);
    
    res.json({ 
      success: true,
      stats: {
        totalGuesses: db.songs[songId].totalGuesses,
        correctGuesses: db.songs[songId].correctGuesses,
        averageTime: db.songs[songId].averageTime
      }
    });
    
  } catch (error) {
    console.error('Error recording guess:', error);
    res.status(500).json({ error: 'Server error recording guess' });
  }
});

// API endpoint to get statistics for a song
app.get('/api/song-stats/:songId', (req, res) => {
  try {
    const { songId } = req.params;
    const db = loadDatabase();
    
    if (!db.songs[songId]) {
      return res.status(404).json({ error: 'Song not found in database' });
    }
    
    const songData = db.songs[songId];
    
    // Calculate percentiles for correct guesses
    const correctGuesses = songData.guesses.filter(g => g.correct);
    let timeDistribution = [];
    
    if (correctGuesses.length > 0) {
      // Sort guesses by time
      const sortedTimes = correctGuesses.map(g => g.time).sort((a, b) => a - b);
      
      // Calculate percentiles (10%, 25%, 50%, 75%, 90%)
      const percentiles = {
        p10: sortedTimes[Math.floor(sortedTimes.length * 0.1)] || sortedTimes[0],
        p25: sortedTimes[Math.floor(sortedTimes.length * 0.25)] || sortedTimes[0],
        p50: sortedTimes[Math.floor(sortedTimes.length * 0.5)] || sortedTimes[0],
        p75: sortedTimes[Math.floor(sortedTimes.length * 0.75)] || sortedTimes[0],
        p90: sortedTimes[Math.floor(sortedTimes.length * 0.9)] || sortedTimes[0]
      };
      
      // Create time distribution for histogram
      const bucketSize = 500; // 500ms buckets
      const maxTime = Math.min(10000, Math.max(...sortedTimes)); // Cap at 10 seconds
      
      // Create buckets
      const buckets = {};
      for (let i = 0; i <= maxTime; i += bucketSize) {
        buckets[i] = 0;
      }
      
      // Fill buckets
      sortedTimes.forEach(time => {
        const bucket = Math.floor(time / bucketSize) * bucketSize;
        if (bucket <= maxTime) {
          buckets[bucket] = (buckets[bucket] || 0) + 1;
        }
      });
      
      // Convert to array format
      timeDistribution = Object.entries(buckets).map(([time, count]) => ({
        time: parseInt(time),
        count
      }));
    }
    
    res.json({
      songId,
      name: songData.name,
      artist: songData.artist,
      stats: {
        totalGuesses: songData.totalGuesses,
        correctGuesses: songData.correctGuesses,
        accuracyRate: songData.totalGuesses > 0 
          ? Math.round((songData.correctGuesses / songData.totalGuesses) * 100) 
          : 0,
        averageTime: songData.averageTime,
        timeDistribution
      }
    });
    
  } catch (error) {
    console.error('Error getting song stats:', error);
    res.status(500).json({ error: 'Server error getting song stats' });
  }
});

// API endpoint to get global stats
app.get('/api/global-stats', (req, res) => {
  try {
    const db = loadDatabase();
    
    // Calculate global statistics
    let totalCorrectGuesses = 0;
    let totalGuessTime = 0;
    let totalCorrectGuessCount = 0;
    
    Object.values(db.songs).forEach(song => {
      totalCorrectGuesses += song.correctGuesses;
      
      // Calculate total time for correct guesses
      const correctGuesses = song.guesses.filter(g => g.correct);
      totalGuessTime += correctGuesses.reduce((sum, g) => sum + g.time, 0);
      totalCorrectGuessCount += correctGuesses.length;
    });
    
    const globalAverageTime = totalCorrectGuessCount > 0 
      ? Math.round(totalGuessTime / totalCorrectGuessCount) 
      : 0;
    
    const globalAccuracyRate = db.totalGuesses > 0 
      ? Math.round((totalCorrectGuesses / db.totalGuesses) * 100) 
      : 0;
    
    // Get top 10 songs by play count
    const topSongs = Object.values(db.songs)
      .sort((a, b) => b.totalGuesses - a.totalGuesses)
      .slice(0, 10)
      .map(song => ({
        name: song.name,
        artist: song.artist,
        totalGuesses: song.totalGuesses,
        correctGuesses: song.correctGuesses,
        averageTime: song.averageTime
      }));
    
    res.json({
      totalSongs: Object.keys(db.songs).length,
      totalGuesses: db.totalGuesses,
      totalCorrectGuesses,
      globalAccuracyRate,
      globalAverageTime,
      topSongs
    });
    
  } catch (error) {
    console.error('Error getting global stats:', error);
    res.status(500).json({ error: 'Server error getting global stats' });
  }
});
