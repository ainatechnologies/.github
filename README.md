# Live Giveaway — YouTube Live Comment Picker

Pick a random winner from YouTube live chat when viewers type an exact keyword.

## Quick start

```bash
cp .env.example .env.local
# Edit .env.local and set YOUTUBE_API_KEY=...

npm install
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

## API key

1. Go to [Google Cloud Console → Credentials](https://console.cloud.google.com/apis/credentials)
2. Create an API key
3. Enable **YouTube Data API v3** for the project
4. Put the key in `.env.local`:

```
YOUTUBE_API_KEY=your_key_here
```

5. Restart `npm run dev`

The key is only used in server routes (`/api/youtube/*`) and is never sent to the browser.

## Flow

1. Paste livestream URL → **Connect to Stream**
2. Set keyword (default `BUILD50`) and duration
3. **Start Giveaway** — only messages from that moment count
4. Viewers type the exact keyword once per channel
5. **Close Entries** (or wait for timer)
6. **Pick Winner** — secure `crypto.randomInt` selection + suspense animation
7. **Redraw** excludes previous winners
