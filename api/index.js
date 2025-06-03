const express = require('express');
const fetch = require('node-fetch');
const querystring = require('querystring');

const app = express();
app.use(express.json());

// Get environment variables
const client_id = process.env.SPOTIFY_CLIENT_ID;
const client_secret = process.env.SPOTIFY_CLIENT_SECRET;
const redirect_uri = process.env.REDIRECT_URI;

// Database will be using Vercel KV storage instead of file system
let inMemoryDB = {
  songs: {},
  totalGuesses: 0
};

// Updated scopes for full functionality
const scope = [
  'user-library-read',
  'streaming',
  'user-read-email',
  'user-read-private',
  'user-read-playback-state',
  'user-modify-playback-state',
  'app-remote-control',
  'user-read-currently-playing',
  'user-read-recently-played'
].join(' ');

app.get('/api/login', (req, res) => {
  const params = new URLSearchParams({
    response_type: 'code',
    client_id: client_id,
    scope: scope,
    redirect_uri: redirect_uri,
    show_dialog: true
  });
  
  const authURL = 'https://accounts.spotify.com/authorize?' + params.toString();
  res.redirect(authURL);
});

app.get('/api/callback', async (req, res) => {
  const code = req.query.code || null;
  if (!code) {
    return res.status(400).json({ error: 'No code provided' });
  }

  try {
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
    if (tokenData.error) {
      return res.status(400).json(tokenData);
    }

    res.send(`
      <!DOCTYPE html>
      <html>
        <body>
          <script>
            const token = ${JSON.stringify(tokenData.access_token)};
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
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/record-guess', (req, res) => {
  try {
    const { songId, songName, artist, guessTime, isCorrect } = req.body;
    
    if (!songId || typeof guessTime !== 'number') {
      return res.status(400).json({ error: 'Missing required fields' });
    }
    
    // Initialize song data if it doesn't exist
    if (!inMemoryDB.songs[songId]) {
      inMemoryDB.songs[songId] = {
        name: songName,
        artist: artist,
        guesses: [],
        totalGuesses: 0,
        correctGuesses: 0,
        averageTime: 0
      };
    }
    
    // Add the new guess
    inMemoryDB.songs[songId].guesses.push({
      time: guessTime,
      correct: isCorrect,
      timestamp: Date.now()
    });
    
    // Update statistics
    inMemoryDB.songs[songId].totalGuesses++;
    inMemoryDB.totalGuesses++;
    
    if (isCorrect) {
      inMemoryDB.songs[songId].correctGuesses++;
    }
    
    // Calculate new average time (only for correct guesses)
    const correctGuesses = inMemoryDB.songs[songId].guesses.filter(g => g.correct);
    if (correctGuesses.length > 0) {
      const totalTime = correctGuesses.reduce((sum, guess) => sum + guess.time, 0);
      inMemoryDB.songs[songId].averageTime = Math.round(totalTime / correctGuesses.length);
    }
    
    res.json({ 
      success: true,
      stats: {
        totalGuesses: inMemoryDB.songs[songId].totalGuesses,
        correctGuesses: inMemoryDB.songs[songId].correctGuesses,
        averageTime: inMemoryDB.songs[songId].averageTime
      }
    });
  } catch (error) {
    res.status(500).json({ error: 'Server error recording guess' });
  }
});

app.get('/api/song-stats/:songId', (req, res) => {
  try {
    const { songId } = req.params;
    
    if (!inMemoryDB.songs[songId]) {
      return res.status(404).json({ error: 'Song not found in database' });
    }
    
    const songData = inMemoryDB.songs[songId];
    
    // Calculate percentiles for correct guesses
    const correctGuesses = songData.guesses.filter(g => g.correct);
    let timeDistribution = [];
    
    if (correctGuesses.length > 0) {
      const sortedTimes = correctGuesses.map(g => g.time).sort((a, b) => a - b);
      const bucketSize = 500; // 500ms buckets
      const maxTime = Math.min(10000, Math.max(...sortedTimes));
      
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
    res.status(500).json({ error: 'Server error getting song stats' });
  }
});

app.get('/api/global-stats', (req, res) => {
  try {
    let totalCorrectGuesses = 0;
    let totalGuessTime = 0;
    let totalCorrectGuessCount = 0;
    
    Object.values(inMemoryDB.songs).forEach(song => {
      totalCorrectGuesses += song.correctGuesses;
      
      const correctGuesses = song.guesses.filter(g => g.correct);
      totalGuessTime += correctGuesses.reduce((sum, g) => sum + g.time, 0);
      totalCorrectGuessCount += correctGuesses.length;
    });
    
    const globalAverageTime = totalCorrectGuessCount > 0 
      ? Math.round(totalGuessTime / totalCorrectGuessCount) 
      : 0;
    
    const globalAccuracyRate = inMemoryDB.totalGuesses > 0 
      ? Math.round((totalCorrectGuesses / inMemoryDB.totalGuesses) * 100) 
      : 0;
    
    const topSongs = Object.values(inMemoryDB.songs)
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
      totalSongs: Object.keys(inMemoryDB.songs).length,
      totalGuesses: inMemoryDB.totalGuesses,
      totalCorrectGuesses,
      globalAccuracyRate,
      globalAverageTime,
      topSongs
    });
  } catch (error) {
    res.status(500).json({ error: 'Server error getting global stats' });
  }
});

module.exports = app; 