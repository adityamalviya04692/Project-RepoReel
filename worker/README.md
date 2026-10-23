# RepoReel live search (optional, free)

A Cloudflare Worker (free tier) that searches Instagram live when the nightly index has no reel for a query.

- Uses Apify's free plan ($5/month credit). Every keyword is cached in KV for 7 days, live calls are capped per day (`DAILY_LIMIT`), and Apify's usage API is checked so the free credit is never exceeded.
- Returns reels (link, creator, date, caption, likes, views). The site matches captions to repositories in the browser and plays the reels with Instagram's official embed.

```bash
cd worker
npx wrangler kv namespace create CACHE      # paste the id into wrangler.toml
npx wrangler secret put APIFY_TOKEN         # free token from console.apify.com → Settings → Integrations
npx wrangler deploy
```

Then add a repository variable `VITE_LIVE_URL` (e.g. `https://reporeel-live.<you>.workers.dev`) so the site uses it.
