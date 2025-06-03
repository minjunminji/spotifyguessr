# Spotify Name That Tune

A fun and interactive game where players guess songs from their Spotify liked songs library. Test your music knowledge and compete with global stats!

## Features

- Play with your Spotify liked songs
- Multiple game modes (5, 10, 20 songs, or endless mode)
- Real-time scoring system
- Global statistics and leaderboards
- Beautiful, responsive UI
- Dark/Light theme support

## Prerequisites

- Node.js 18 or higher
- A Spotify Premium account
- A Spotify Developer account

## Setup

1. Clone the repository:
```bash
git clone https://github.com/YOUR_USERNAME/spotify-name-that-tune.git
cd spotify-name-that-tune
```

2. Install dependencies:
```bash
npm install
```

3. Create a Spotify application at [Spotify Developer Dashboard](https://developer.spotify.com/dashboard)

4. Set up your environment variables:
   - Create a `.env` file in the root directory
   - Add the following variables:
   ```
   SPOTIFY_CLIENT_ID=your_client_id
   SPOTIFY_CLIENT_SECRET=your_client_secret
   REDIRECT_URI=http://localhost:8888/api/callback
   ```

5. Start the development server:
```bash
npm run dev
```

## Deployment

This project is set up for deployment on Vercel. To deploy:

1. Install Vercel CLI:
```bash
npm install -g vercel
```

2. Deploy to Vercel:
```bash
vercel
```

3. Set up environment variables in your Vercel project settings
4. Update the Spotify Developer Dashboard with your production callback URL

## Contributing

Contributions are welcome! Please feel free to submit a Pull Request.

## License

This project is licensed under the ISC License.

## Acknowledgments

- Spotify Web API
- Spotify Web Playback SDK 