# Littleton Pedestrian Crossing Explorer

Accessible static website built from the supplied Littleton street-centerline data and CDOT pedestrian-signal timing guidance.

## Run locally

From this folder, run:

```text
npm start
```

Then open <http://localhost:8000>.

## Publish on GitHub Pages

The `Deploy static site to GitHub Pages` workflow publishes the explorer when changes are pushed to `master` (or when run manually). In the repository settings, set **Pages → Build and deployment → Source** to **GitHub Actions**. The interactive map and street explorer are static and work on Pages; community voting requires the Node server and is not available on GitHub Pages.

The site uses Leaflet and Esri's World Street Map tiles with linked attribution. The Node server also provides the persistent crossing-vote API. Set `VOTE_HASH_SALT` to a long random value before deployment; raw IP addresses are not stored. For a high-traffic deployment, use a dedicated tile provider or host your own tiles. `data/streets.json` is a web-ready conversion of the supplied GeoPackage, transformed from EPSG:2232 to WGS84 coordinates. `data/curbs.json` is a compact EPSG:4326 conversion of the supplied curb GeoJSON. The Pages workflow includes only the runtime site assets, not the source GIS exports.

## Important limitation

Crossing-focused clearance estimates use the distance between curb edges in the supplied curb dataset. If a reliable curb-edge pair is not available for a crossing, the site reports the curb-to-curb distance as unavailable instead of substituting recorded street width. Outside a selected crossing, displayed roadway widths are the supplied recorded widths and are not curb measurements. The pedestrian-crossing Yes/No indicator is limited to crossings identified by the app's known signal-timing data; it is not a complete crosswalk inventory. The site does not contain or represent official Littleton signal timing plans.
