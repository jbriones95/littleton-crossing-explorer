# Littleton Pedestrian Crossing Explorer

Accessible static website built from the supplied Littleton street-centerline data and CDOT pedestrian-signal timing guidance.

## Run locally

From this folder, run:

```text
npm start
```

Then open <http://localhost:8000>.

## Publish on GitHub Pages

The `Deploy static site to GitHub Pages` workflow publishes the explorer when changes are pushed to `master` (or when run manually). In the repository settings, set **Pages → Build and deployment → Source** to **GitHub Actions**. The interactive map and street explorer are static. Community voting uses the Cloudflare Worker in `worker.mjs` and D1 database; without the repository Actions variable `VOTE_API_URL`, Pages intentionally leaves voting disabled.

### Enable community voting

1. Create or sign in to a Cloudflare account and install/authenticate Wrangler: `npx wrangler login`.
2. Create the persistent database with `npx wrangler d1 create littleton-crossing-votes`. Copy the database ID Wrangler returns into `wrangler.toml`, replacing the all-zero placeholder.
3. Apply the schema: `npx wrangler d1 migrations apply littleton-crossing-votes --remote`.
4. Set a private hashing salt and deploy the API:

   ```sh
   openssl rand -hex 32 | npx wrangler secret put VOTE_HASH_SALT
   npx wrangler deploy
   ```

5. Copy the deployed `workers.dev` origin and set it as a repository Actions variable:
   `gh variable set VOTE_API_URL --repo jbriones95/littleton-crossing-explorer --body 'https://YOUR-WORKER.YOUR-ACCOUNT.workers.dev'`
6. Redeploy the Pages site by pushing a commit or running the Pages workflow manually.

The API accepts requests only from the production site (plus localhost for development). It stores one vote per crossing and salted voter hash; raw IP addresses and browser IDs are not stored. Voters can update their vote. The Worker code and D1 schema can be tested locally with `npm test`.

The site uses Leaflet and Esri's World Street Map tiles with linked attribution. For a high-traffic deployment, use a dedicated tile provider or host your own tiles. `data/streets.json` is a web-ready conversion of the supplied GeoPackage, transformed from EPSG:2232 to WGS84 coordinates. `data/curbs.json` is retained as a compact EPSG:4326 conversion of the supplied curb GeoJSON but is not currently used for crossing distances. The Pages workflow includes only the runtime site assets, not the source GIS exports.

## Important limitation

Crossing-focused clearance estimates use the sum of the selected street-centerline segments' recorded roadway widths (`widthFt`), not curb-to-curb measurements. Outside a selected crossing, displayed roadway widths are the supplied recorded widths. The pedestrian-crossing Yes/No indicator is limited to crossings identified by the app's known signal-timing data; it is not a complete crosswalk inventory. The site does not contain or represent official Littleton signal timing plans.
