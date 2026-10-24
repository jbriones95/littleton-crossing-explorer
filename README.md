# Littleton Crossing Explorer

An accessible map for exploring Littleton streets and estimated pedestrian crossing times.

## Run locally

```sh
npm start
```

Open <http://localhost:8000>. Run `npm test` to check the voting API.

## Deploy

Push to `master` to publish the site to [littletoncrosswalks.com](https://littletoncrosswalks.com/) with GitHub Pages. The voting API uses a Cloudflare Worker and D1 database; deploy Worker changes with `npx wrangler deploy`. Its URL is a GitHub Actions variable, and its hashing salt is a Cloudflare secret.

## How estimates work

Crossing estimates use recorded street-centerline widths, not curb-to-curb distances. Walking time is estimated from width and walking speed. Signal timing is shown only for crossings with known timing data; it is informational and does not represent an official signal plan.
