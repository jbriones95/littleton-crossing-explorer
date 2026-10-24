const state = { all: [], streetNames: [], streetOptions: [], approachOptions: [], familyNames: new Map(), familySegments: new Map(), connectedFamilies: new Map(), filtered: [], speed: 3.5, direction: 'one-from-two', map: null, layer: null, highlightLayer: null, renderer: null, selected: null, crossing: null, sceneFrame: null, sceneStreet: null, filterTimer: null, boundsCache: new WeakMap(), geometryCache: new WeakMap() };
const movementProfiles = [
  { name: 'Adult', emoji: '🚶', speed: 3.5 },
  { name: 'Child', emoji: '👦', speed: 3 },
  { name: 'Older adult', emoji: '👴', speed: 2.5 },
  { name: 'Crowd', emoji: '🧑‍🤝‍🧑', speed: 3 },
  { name: 'Person with a dog', emoji: '🐕', speed: 3 },
  { name: 'Bike', emoji: '🚴', speed: 8 },
  { name: 'Wheelchair', emoji: '🧑‍🦽', speed: 2.5 }
];
const $ = id => document.getElementById(id);
const browserId = () => { try { let id = localStorage.getItem('crossing-voter-id'); if (!id) { id = crypto.randomUUID(); localStorage.setItem('crossing-voter-id', id); } return id; } catch { return 'temporary-browser'; } };
const number = (value, fallback = '—') => value === null || value === undefined || value === '' || value === ' <Null>' || value === '<Null>'
  ? fallback
  : Number.isFinite(Number(value)) ? Number(value).toLocaleString() : String(value);

function clearance(street) {
  const width = Number(street.widthFt);
  return width > 0 ? Math.ceil(width / state.speed) : null;
}

function esc(value) {
  return String(value ?? '').replace(/[&<>"']/g, character => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[character]));
}

function displayStreetName(value) {
  return String(value ?? '')
    .toLowerCase()
    .replace(/(^|[\s(/-])([a-z])/g, (_, separator, letter) => `${separator}${letter.toUpperCase()}`)
    .replace(/\((nb|sb|eb|wb|n|s|e|w)\)/gi, (_, direction) => `(${direction.toUpperCase()})`);
}

// The source coordinates are GeoJSON order (longitude, latitude). Leaflet uses latitude, longitude.
function leafletGeometry(geometry) {
  return (geometry || []).map(line => line.map(([longitude, latitude]) => [latitude, longitude]));
}

function streetGeometry(street) {
  if (!state.geometryCache.has(street)) state.geometryCache.set(street, leafletGeometry(street.geometry));
  return state.geometryCache.get(street);
}

function normalizeStreet(value) {
  return value.toLowerCase().replace(/\b(boulevard|blvd)\b/g, 'blvd').replace(/\b(street|st)\b/g, 'st').replace(/\b(road|rd)\b/g, 'rd').replace(/\b(avenue|ave)\b/g, 'ave').replace(/\b(drive|dr)\b/g, 'dr').replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim();
}

function streetFamily(value) {
  return normalizeStreet(value).replace(/\s+(nb|sb|eb|wb)$/, '').replace(/^[nsew]\s+/, '').trim();
}

function crossingMatches(street, first, second) {
  const searchable = normalizeStreet(`${street.name} ${street.fromStreet || ''} ${street.toStreet || ''}`);
  return [first, second].filter(Boolean).every(term => searchable.includes(normalizeStreet(term)));
}

function streetMatches(street, term) {
  const normalized = streetFamily(term);
  return normalized && streetFamily(street.name || '').includes(normalized);
}

function streetEndpointMatches(street, term) {
  const normalized = streetFamily(term);
  return normalized && streetFamily(`${street.fromStreet || ''} ${street.toStreet || ''}`).includes(normalized);
}

function directionKey(street) {
  const name = (street.name || '').toUpperCase();
  const suffix = name.match(/\((NB|SB|EB|WB)\)/);
  if (suffix) return suffix[1];
  const prefix = name.match(/^([NSEW])\s+/);
  return prefix ? prefix[1] : name;
}

function center(street) {
  const points = streetGeometry(street).flat();
  return points.reduce((sum, point) => [sum[0] + point[0] / points.length, sum[1] + point[1] / points.length], [0, 0]);
}

function nearestPoint(street, reference) {
  return streetGeometry(street).flat().reduce((nearest, point) => {
    const distance = (point[0] - reference[0]) ** 2 + (point[1] - reference[1]) ** 2;
    return distance < nearest.distance ? { point, distance } : nearest;
  }, { point: center(street), distance: Infinity }).point;
}

function crossingLine(street, point, widthFeet) {
  const points = streetGeometry(street).flat();
  const start = points[0]; const end = points[points.length - 1];
  const latitudeScale = 364000; const longitudeScale = latitudeScale * Math.cos(point[0] * Math.PI / 180);
  const east = (end[1] - start[1]) * longitudeScale; const north = (end[0] - start[0]) * latitudeScale;
  const length = Math.hypot(east, north) || 1; const perpendicularEast = -north / length; const perpendicularNorth = east / length; const half = widthFeet / 2;
  return [[point[0] - perpendicularNorth * half / latitudeScale, point[1] - perpendicularEast * half / longitudeScale], [point[0] + perpendicularNorth * half / latitudeScale, point[1] + perpendicularEast * half / longitudeScale]];
}

function crossingPoint(street) {
  const approach = state.crossing?.crossingApproach;
  const targets = state.crossing?.targetSegments?.filter(segment => streetMatches(segment, street.name)) || [];
  if (!approach || !targets.length) return null;
  const reference = center(approach);
  const points = targets.map(segment => nearestPoint(segment, reference));
  return points.reduce((sum, value) => [sum[0] + value[0] / points.length, sum[1] + value[1] / points.length], [0, 0]);
}

function bounds(street) {
  if (state.boundsCache.has(street)) return state.boundsCache.get(street);
  const points = streetGeometry(street).flat();
  const result = points.reduce((box, [lat, lng]) => [Math.min(box[0], lat), Math.min(box[1], lng), Math.max(box[2], lat), Math.max(box[3], lng)], [Infinity, Infinity, -Infinity, -Infinity]);
  state.boundsCache.set(street, result);
  return result;
}

function nearby(a, b, threshold = 0.0012) {
  const first = bounds(a); const second = bounds(b);
  return first[0] <= second[2] + threshold && first[2] >= second[0] - threshold && first[1] <= second[3] + threshold && first[3] >= second[1] - threshold;
}

function updateStreetSuggestions(first) {
  const term = streetFamily(first);
  if (!term || term.length < 3) { state.approachOptions = state.streetOptions; return; }
  const nearbyFamilies = new Set();
  for (const [family, connected] of state.connectedFamilies) {
    if (family.includes(term)) connected.forEach(name => nearbyFamilies.add(name));
  }
  state.approachOptions = nearbyFamilies.size
    ? state.streetOptions.filter(option => nearbyFamilies.has(option.family))
    : state.streetOptions;
}

function renderSuggestions(inputId, listId, options) {
  const input = $(inputId); const list = $(listId); const term = normalizeStreet(input.value);
  if (!term) { list.replaceChildren(); list.classList.remove('visible'); return; }
  const startsWith = []; const contains = [];
  for (const option of options) {
    if (option.normalized.startsWith(term)) startsWith.push(option.name);
    else if (option.normalized.includes(term)) contains.push(option.name);
    if (startsWith.length >= 8) break;
  }
  const matches = startsWith.length >= 8 ? startsWith : startsWith.concat(contains.slice(0, 8 - startsWith.length));
  list.innerHTML = matches.map(name => `<button type="button" role="option" class="street-suggestion" data-value="${esc(name)}">${esc(displayStreetName(name))}</button>`).join('');
  list.classList.toggle('visible', Boolean(term && matches.length));
  list.querySelectorAll('.street-suggestion').forEach(button => button.addEventListener('mousedown', event => {
    event.preventDefault(); input.value = displayStreetName(button.dataset.value); list.classList.remove('visible');
    if (inputId === 'street-one') {
      updateStreetSuggestions(input.value);
      renderSuggestions('street-two', 'street-two-suggestions', state.approachOptions);
    }
    scheduleFilters();
  }));
}

function hideSuggestions() {
  document.querySelectorAll('.street-suggestions').forEach(list => list.classList.remove('visible'));
}

function scheduleFilters() {
  clearTimeout(state.filterTimer);
  const first = streetFamily($('street-one').value.trim());
  const second = streetFamily($('street-two').value.trim());
  const ready = (!first && !second) || (first && second && state.familySegments.has(first) && state.familySegments.has(second));
  if (!ready) {
    $('crossing-status').textContent = 'Choose two streets from the suggestions to focus a crossing.';
    if (state.crossing) {
      state.crossing = null;
      state.selected = null;
      $('profile-overlay').hidden = true;
      $('map-distance').hidden = true;
      $('vote-panel').hidden = true;
      $('selected').innerHTML = '<p>Select a street on the map or choose two streets above.</p>';
      document.querySelector('.scene-section').hidden = true;
      updateScene(null);
      if (state.highlightLayer) state.highlightLayer.clearLayers();
      state.filtered = state.all;
      renderTable();
    }
    return;
  }
  state.filterTimer = setTimeout(applyFilters, 80);
}

function pointSegmentDistance(point, start, end) {
  const dx = end[0] - start[0]; const dy = end[1] - start[1];
  const length = dx * dx + dy * dy;
  const t = length ? Math.max(0, Math.min(1, ((point[0] - start[0]) * dx + (point[1] - start[1]) * dy) / length)) : 0;
  return Math.hypot(point[0] - (start[0] + t * dx), point[1] - (start[1] + t * dy));
}

function orientation(a, b, c) {
  return (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
}

function segmentsIntersect(a, b, c, d) {
  const ab1 = orientation(a, b, c); const ab2 = orientation(a, b, d);
  const cd1 = orientation(c, d, a); const cd2 = orientation(c, d, b);
  return (ab1 === 0 && ab2 === 0 && Math.max(a[0], b[0]) >= Math.min(c[0], d[0]) && Math.max(c[0], d[0]) >= Math.min(a[0], b[0]) && Math.max(a[1], b[1]) >= Math.min(c[1], d[1]) && Math.max(c[1], d[1]) >= Math.min(a[1], b[1])) || (ab1 * ab2 <= 0 && cd1 * cd2 <= 0);
}

function streetDistanceFeet(first, second) {
  const firstPoints = streetGeometry(first).flat(); const secondPoints = streetGeometry(second).flat();
  const origin = firstPoints[0]; const latitudeScale = 364000; const longitudeScale = latitudeScale * Math.cos(origin[0] * Math.PI / 180);
  const project = point => [(point[1] - origin[1]) * longitudeScale, (point[0] - origin[0]) * latitudeScale];
  const a = firstPoints.map(project); const b = secondPoints.map(project); let minimum = Infinity;
  for (let i = 1; i < a.length; i++) for (let j = 1; j < b.length; j++) {
    if (segmentsIntersect(a[i - 1], a[i], b[j - 1], b[j])) return 0;
    minimum = Math.min(minimum, pointSegmentDistance(a[i - 1], b[j - 1], b[j]), pointSegmentDistance(a[i], b[j - 1], b[j]), pointSegmentDistance(b[j - 1], a[i - 1], a[i]), pointSegmentDistance(b[j], a[i - 1], a[i]));
  }
  return minimum;
}

function intersectsStreet(first, second) {
  return streetDistanceFeet(first, second) <= 25 || streetEndpointMatches(first, second.name) || streetEndpointMatches(second, first.name);
}

function crossingAreas(first, second) {
  if (!first && !second) return [];
  if (!first || !second) return state.all.filter(street => street.geometry && streetMatches(street, first || second)).slice(0, 500);
  const firstCandidates = state.all.filter(street => street.geometry && streetMatches(street, first));
  const secondCandidates = state.all.filter(street => street.geometry && streetMatches(street, second));
  if (!firstCandidates.length || !secondCandidates.length) return [];
  let closest = null;
  firstCandidates.forEach(a => secondCandidates.forEach(b => {
    if (a === b || !intersectsStreet(a, b)) return;
    const distance = streetDistanceFeet(a, b);
    if (!closest || distance < closest.distance) closest = { a, b, distance };
  }));
  if (!closest) return [];
  const endpointTargetSegments = firstCandidates.filter(segment => streetEndpointMatches(segment, second));
  const targetPool = endpointTargetSegments.length ? endpointTargetSegments : firstCandidates;
  const targetCandidates = targetPool.filter(segment => {
    if (!intersectsStreet(segment, closest.b)) return false;
    if (endpointTargetSegments.length) return true;
    return streetDistanceFeet(segment, closest.b) <= closest.distance + 25;
  });
  const targetGroups = new Map();
  targetCandidates.forEach(segment => {
    const direction = directionKey(segment);
    const current = targetGroups.get(direction);
    const approach = center(closest.b); const point = center(segment);
    const distance = (point[0] - approach[0]) ** 2 + (point[1] - approach[1]) ** 2;
    if (!current || distance < current.distance) targetGroups.set(direction, { segment, distance });
  });
  const groupedTargets = [...targetGroups.entries()];
  const directionalTargets = groupedTargets.filter(([key]) => /^(NB|SB|EB|WB|N|S|E|W)$/.test(key));
  const nearbyTargetSegments = (directionalTargets.length ? directionalTargets : groupedTargets).map(([, group]) => group.segment);
  return [...new Set([...nearbyTargetSegments, closest.b])];
}

function signalTiming(street) {
  if (!street) return null;
  const endpoints = `${street.name} ${street.fromStreet} ${street.toStreet}`.toUpperCase();
  if (!endpoints.includes('BROADWAY') || !endpoints.includes('LITTLETON BLVD')) return null;
  if (/\bBROADWAY\b/.test(String(street.name || '').toUpperCase())) return 25;
  if (/\bLITTLETON BLVD\b/.test(String(street.name || '').toUpperCase())) return 30;
  return null;
}

function hasPedestrianCrossing(street) {
  return Boolean(signalTiming(street) || state.crossing?.targetSegments?.some(segment => signalTiming(segment)));
}

function renderProfileOverlay(street) {
  const overlay = $('profile-overlay');
  if (!street || !state.crossing) { overlay.hidden = true; overlay.innerHTML = ''; return; }
  const distance = crossingDistance(street);
  const available = signalTiming(street);
  overlay.hidden = false;
  if (!distance) {
    overlay.innerHTML = '<div class="profile-overlay-title">Can everyone cross?</div><div class="profile-overlay-subtitle">Crosswalk timing unavailable</div>';
    return;
  }
  overlay.innerHTML = `<div class="profile-overlay-title">Can everyone cross?</div><div class="profile-overlay-subtitle">${available ? `Crosswalk timing: ${available} seconds` : 'Crosswalk timing unavailable'}</div>` +
    `<div class="profile-results">${movementProfiles.map(profile => {
      const needed = Math.ceil(distance / profile.speed);
      const canCross = available ? needed <= available : null;
      const secondsLeft = canCross === true ? available - needed : null;
      const resultClass = canCross === null ? 'unknown' : canCross ? secondsLeft <= 7 ? 'tight-time' : 'can-cross' : 'cannot-cross';
      const timingDetail = canCross === true ? `${needed} sec needed · ${secondsLeft} sec left` : `${needed} sec needed`;
      return `<div class="profile-result ${resultClass}"><span class="profile-result-icon" aria-hidden="true">${profile.emoji}</span><span class="profile-result-name">${profile.name}<small>${profile.speed.toFixed(1)} ft/sec · ${timingDetail}</small></span><strong>${canCross === null ? '—' : canCross ? 'Yes' : 'No'}</strong></div>`;
    }).join('')}</div>`;
}

function crossingDistance(street) {
  if (state.crossing?.targetSegments?.includes(street)) {
    const width = state.crossing.targetSegments.reduce((total, segment) => total + (Number(segment.widthFt) || 0), 0);
    return width > 0 ? width : null;
  }
  return Number(street?.widthFt) || 0;
}

function crossingLanes(street) {
  const segments = state.crossing?.targetSegments?.filter(segment => streetMatches(segment, street.name)) || [];
  if (!segments.length) return Number(street?.lanes) || null;
  const lanes = segments.reduce((total, segment) => total + (Number(segment.lanes) || 0), 0);
  return lanes || null;
}

function crossingClearance(street) {
  const distance = crossingDistance(street);
  return distance > 0 ? Math.ceil(distance / state.speed) : null;
}

function voteKey() {
  if (!state.crossing) return '';
  const first = $('street-one').value.trim(); const second = $('street-two').value.trim();
  const crossed = state.direction === 'one-from-two' ? first : second;
  const approach = state.direction === 'one-from-two' ? second : first;
  return `${streetFamily(crossed)}|${streetFamily(approach)}`;
}

async function loadVotes() {
  const panel = $('vote-panel');
  const key = voteKey();
  state.voteKey = key;
  if (!key) { panel.hidden = true; return; }
  panel.hidden = false;
  if (document.documentElement.dataset.voting === 'disabled') {
    $('vote-counts').textContent = '';
    $('vote-message').textContent = 'Community voting is unavailable on this static site.';
    document.querySelectorAll('.vote-actions button').forEach(button => { button.disabled = true; });
    return;
  }
  document.querySelectorAll('.vote-actions button').forEach(button => { button.disabled = false; });
  $('vote-message').textContent = 'Loading community responses…';
  try {
    const response = await fetch(`/api/votes?key=${encodeURIComponent(key)}&browserId=${encodeURIComponent(browserId())}`);
    if (!response.ok) throw new Error('Vote service unavailable');
    const data = await response.json();
    if (state.voteKey !== key) return;
    $('vote-counts').textContent = `${data.adequate} adequate · ${data.inadequate} too short`;
    document.querySelectorAll('.vote-actions button').forEach(button => button.classList.toggle('chosen', button.dataset.vote === data.userVote));
    $('vote-message').textContent = data.userVote ? 'Your vote is saved.' : '';
  } catch { $('vote-message').textContent = 'Community voting is unavailable right now.'; }
}

async function castVote(vote) {
  if (document.documentElement.dataset.voting === 'disabled') return;
  const key = state.voteKey || voteKey();
  if (!key) return;
  $('vote-message').textContent = 'Saving your vote…';
  try {
    const response = await fetch('/api/votes', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ key, vote, browserId: browserId() }) });
    if (!response.ok) throw new Error('Vote service unavailable');
    await loadVotes();
  } catch { $('vote-message').textContent = 'Your vote could not be saved.'; }
}

function popup(street) {
  const timing = signalTiming(street);
  const distance = crossingDistance(street);
  return `<strong>${esc(displayStreetName(street.name))}</strong><br>${esc(street.roadClass || 'Road class unavailable')}<br>` +
    `${state.crossing?.targetSegments?.includes(street) ? 'Recorded crossing width (street-centerline data)' : 'Recorded roadway width'}: <strong>${distance ? `${number(distance)} ft` : 'not available'}</strong><br>` +
    `Estimated clearance: <strong>${crossingClearance(street) ? crossingClearance(street) + ' seconds' : 'not available'}</strong><br>` +
    (timing ? `<strong>Reported signal timing:</strong> ${timing} seconds<br>` : '') +
    '<small>Estimate only; not official signal timing.</small>';
}

function updateScene(street) {
  state.sceneStreet = street || null;
  if (state.sceneFrame) cancelAnimationFrame(state.sceneFrame);
  const person = $('scene-person');
  const timer = $('scene-timer');
  const summary = $('scene-summary');
  const roadLabel = $('scene-road-label');
  const distanceLabel = $('scene-distance');
  const signal = $('scene-signal');
  const distanceStat = $('scene-distance-stat'); const neededStat = $('scene-needed-stat'); const availableStat = $('scene-available-stat');
  $('scene-restart').disabled = !street;
  const distance = crossingDistance(street);
  document.querySelector('.scene-section').hidden = !(state.crossing && distance);
  const walkingSeconds = crossingClearance(street);
  const availableSeconds = signalTiming(street) || walkingSeconds;
  if (!distance || !walkingSeconds || !availableSeconds) {
    person.style.left = '10%'; timer.textContent = '--'; signal.className = 'scene-signal'; signal.innerHTML = '<span aria-hidden="true">—</span> Wait'; roadLabel.textContent = 'Crossing street'; distanceLabel.textContent = '-- ft'; distanceStat.textContent = '--'; neededStat.textContent = '--'; availableStat.textContent = '--'; summary.className = 'scene-summary'; summary.textContent = 'Enter two streets to start the crossing preview.'; return;
  }
  roadLabel.textContent = displayStreetName(street.name);
  distanceLabel.textContent = `${distance.toLocaleString()} ft`;
  const reachesOtherSide = walkingSeconds <= availableSeconds;
  const timingLabel = signalTiming(street) ? `reported ${availableSeconds}-second signal timing` : `${availableSeconds}-second informational estimate`;
  distanceStat.textContent = `${distance.toLocaleString()} ft`; neededStat.textContent = `${walkingSeconds} sec`; availableStat.textContent = `${availableSeconds} sec`;
  summary.className = `scene-summary ${reachesOtherSide ? 'scene-success' : 'scene-warning'}`;
  summary.textContent = `${distance.toLocaleString()} ft crossing at ${state.speed.toFixed(1)} ft/sec: ${walkingSeconds} seconds needed, with ${timingLabel}. ${reachesOtherSide ? 'The profile reaches the other side.' : 'The available time expires before the crossing is complete.'}`;
  const start = performance.now();
  const animate = now => {
    const elapsed = (now - start) / 1000;
    const progress = Math.min(elapsed / walkingSeconds, 1);
    person.style.left = `${10 + progress * 80}%`;
    timer.textContent = `${Math.max(0, Math.ceil(availableSeconds - elapsed))} sec`;
    if (elapsed >= walkingSeconds) { signal.className = 'scene-signal signal-hand'; signal.innerHTML = '<span aria-hidden="true">✋</span> Don’t walk'; }
    if (elapsed < availableSeconds) state.sceneFrame = requestAnimationFrame(animate);
    else { timer.textContent = reachesOtherSide ? 'Complete' : 'Time'; person.classList.toggle('scene-incomplete', !reachesOtherSide); }
  };
  person.classList.remove('scene-incomplete');
  signal.className = 'scene-signal signal-walk'; signal.innerHTML = '<span aria-hidden="true">🚶</span> Walk';
  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
    person.style.left = `${10 + Math.min(walkingSeconds / availableSeconds, 1) * 80}%`;
    timer.textContent = reachesOtherSide ? 'Complete' : 'Time';
    person.classList.toggle('scene-incomplete', !reachesOtherSide);
    signal.className = 'scene-signal signal-hand'; signal.innerHTML = '<span aria-hidden="true">✋</span> Don’t walk';
  } else state.sceneFrame = requestAnimationFrame(animate);
}

function selectStreet(street) {
  state.selected = street;
  const context = state.crossing;
  const distance = crossingDistance(street);
  $('selected').innerHTML = `<h3>${context ? 'Your crossing' : 'Selected street'}: ${esc(displayStreetName(street.name))}</h3>` +
    (context ? `<p class="crossing-context"><strong>Crossing:</strong> ${esc(displayStreetName(street.name))}<br><strong>Coming from:</strong> ${esc(displayStreetName(context.approach))}</p>` : '') +
    (context ? '' : `<p class="muted">${esc(displayStreetName(street.fromStreet || ''))} to ${esc(displayStreetName(street.toStreet || ''))}</p>`) +
    '<div class="stats">' +
    `<div class="stat"><strong>${distance ? `${number(distance)} ft` : 'Not available'}</strong><span>${context ? 'Crossing width (centerline data)' : 'Recorded roadway width'}</span></div>` +
    `<div class="stat"><strong>${crossingClearance(street) ? crossingClearance(street) + ' sec' : '—'}</strong><span>Estimated clearance</span></div>` +
    `<div class="stat"><strong>${number(crossingLanes(street))}</strong><span>${context ? 'Total lanes' : 'Number of lanes'}</span></div>` +
    `<div class="stat"><strong>${hasPedestrianCrossing(street) ? 'Yes' : 'No'}</strong><span>Pedestrian crossing</span></div>` +
     `</div>${signalTiming(street) ? `<p><strong>Reported signal timing at Broadway and Littleton Blvd:</strong> ${signalTiming(street)} seconds</p>` : ''}<p><strong>Speed limit:</strong> ${esc(street.speed || 'Not available')} · <strong>Traffic:</strong> ${number(street.adt, 'Not available')} ADT</p>`;
  updateScene(street);
  loadVotes();
  if (state.map && street.geometry && !context) {
    const bounds = streetGeometry(street).flat();
    if (bounds.length) state.map.fitBounds(bounds, { padding: [30, 30], maxZoom: 17 });
  }
}

function renderTable() {
  const rows = state.filtered.slice(0, 500);
  $('street-table').innerHTML = rows.map((street, index) => `<tr><td><button class="row-button" data-index="${index}">${esc(displayStreetName(street.name))}</button><br><small>Segment ID: ${esc(street.SEGMENTID || '')}</small></td><td>${esc(street.roadClass || 'Road class unavailable')}</td><td>${number(street.widthFt, '—')} ft</td><td>${number(street.lanes)}</td><td>${clearance(street) ? clearance(street) + ' sec' : '—'}</td><td>${hasPedestrianCrossing(street) ? 'Yes' : 'No'}</td></tr>`).join('');
  const hasInput = $('street-one').value.trim() || $('street-two').value.trim();
  $('result-count').textContent = !state.filtered.length && hasInput
    ? 'No matching crossing found. Choose a street from the suggestions and try again.'
    : `Showing ${rows.length.toLocaleString()} of ${state.filtered.length.toLocaleString()} matching street segments${state.filtered.length > 500 ? ' (first 500 shown)' : ''}.`;
  document.querySelectorAll('.row-button').forEach(button => button.addEventListener('click', () => selectStreet(rows[Number(button.dataset.index)])));
}

function applyFilters() {
  const first = $('street-one').value.trim();
  const second = $('street-two').value.trim();
  const focused = Boolean(first && second);
  const crossedStreet = state.direction === 'one-from-two' ? first : second;
  const approachStreet = state.direction === 'one-from-two' ? second : first;
  const areas = crossingAreas(crossedStreet, approachStreet);
  const crossingStreet = focused ? areas.find(street => streetMatches(street, crossedStreet)) : null;
  const targetSegments = crossingStreet ? areas.filter(street => streetMatches(street, crossedStreet)) : [];
  const crossingApproach = crossingStreet
    ? areas.find(segment => !streetMatches(segment, crossedStreet) && streetMatches(segment, approachStreet)) || areas.find(segment => !streetMatches(segment, crossedStreet))
    : null;
  state.crossing = crossingStreet ? { street: crossingStreet, approach: approachStreet, crossingApproach, targetSegments } : null;
  const mapDistance = $('map-distance');
  renderProfileOverlay(crossingStreet);
  if (crossingStreet) {
    mapDistance.hidden = false;
    const crossingWidth = crossingDistance(crossingStreet);
    mapDistance.textContent = crossingWidth
      ? `Recorded crossing width (street-centerline data): ${crossingWidth.toLocaleString()} ft`
      : 'Recorded roadway width unavailable for this street.';
  }
  else mapDistance.hidden = true;
  $('crossing-status').textContent = focused
    ? `Crossing ${displayStreetName(crossedStreet)} · approaching from ${displayStreetName(approachStreet)}`
    : 'Enter two street names to focus a crossing.';
  state.filtered = first || second ? areas : state.all;
  if (state.layer) state.layer.clearLayers();
  if (!window.L) { renderTable(); return; }
  // Keep the overview useful, but remove the visual noise once a crossing is focused.
  if (!focused) state.all.forEach(street => {
    if (!street.geometry) return;
    L.polyline(streetGeometry(street), { color: '#718294', weight: 1.5, opacity: .42, renderer: state.renderer })
      .bindPopup(popup(street)).on('click', () => selectStreet(state.crossing?.street || street)).addTo(state.layer);
  });
  if (state.highlightLayer) state.highlightLayer.clearLayers();
  const matches = areas.filter(street => street.geometry);
  const focusPoints = [];
  const targetSegmentsOnMap = matches.filter(street => streetMatches(street, crossedStreet));
  const approachSegment = matches.find(street => !streetMatches(street, crossedStreet));
  if (crossingStreet && approachSegment && targetSegmentsOnMap.length) {
    const approachCenter = center(approachSegment);
    const targetPoints = targetSegmentsOnMap.map(street => nearestPoint(street, approachCenter));
    const crossingPoint = targetPoints.reduce((sum, point) => [sum[0] + point[0] / targetPoints.length, sum[1] + point[1] / targetPoints.length], [0, 0]);
    const measuredDistance = crossingDistance(crossingStreet);
    if (measuredDistance) {
      const endpoints = crossingLine(crossingStreet, crossingPoint, measuredDistance);
      L.polyline(endpoints, { color: '#fff3c4', weight: 18, opacity: .95 }).addTo(state.highlightLayer);
      L.polyline(endpoints, { color: '#ee4d8d', weight: 10, opacity: 1 }).bindPopup(popup(crossingStreet)).on('click', () => selectStreet(state.crossing?.street || crossingStreet)).addTo(state.highlightLayer);
      const approachPoint = endpoints.reduce((closest, point) => {
        const approachEdge = nearestPoint(approachSegment, point);
        const distance = (point[0] - approachEdge[0]) ** 2 + (point[1] - approachEdge[1]) ** 2;
        return distance < closest.distance ? { point, distance } : closest;
      }, { point: endpoints[0], distance: Infinity }).point;
      L.circleMarker(approachPoint, { color: '#20b9c4', fillColor: '#20b9c4', fillOpacity: .95, radius: 8, weight: 3 }).bindPopup(popup(approachSegment)).on('click', () => selectStreet(state.crossing?.street || crossingStreet)).addTo(state.highlightLayer);
      focusPoints.push(...endpoints, approachPoint);
    } else {
      focusPoints.push(...targetPoints, approachCenter);
      L.circleMarker(crossingPoint, { color: '#ee4d8d', fillColor: '#ee4d8d', fillOpacity: .9, radius: 8, weight: 3 }).addTo(state.highlightLayer);
      L.circleMarker(approachCenter, { color: '#20b9c4', fillColor: '#20b9c4', fillOpacity: .9, radius: 8, weight: 3 }).addTo(state.highlightLayer);
    }
  } else matches.forEach(street => {
    const point = center(street); focusPoints.push(point);
    L.circleMarker(point, { color: '#20b9c4', fillColor: '#20b9c4', fillOpacity: .9, radius: 8, weight: 3 }).addTo(state.highlightLayer);
  });
  if (first && second && matches.length) {
    state.map.fitBounds(focusPoints, { padding: [70, 70], maxZoom: 18 });
    if (state.map.getZoom() < 14) state.map.setZoom(14);
  }
  if (crossingStreet) selectStreet(crossingStreet);
  else if (focused) updateScene(null);
  if (!crossingStreet) { state.voteKey = ''; $('vote-panel').hidden = true; }
  renderTable();
}

async function init() {
  const response = await fetch('data/streets.json');
  if (!response.ok) throw new Error(`Street data request failed: ${response.status}`);
  state.all = await response.json();
  state.streetNames = [...new Set(state.all.map(street => street.name).filter(Boolean))].sort((a, b) => a.localeCompare(b));
  state.streetOptions = state.streetNames.map(name => ({ name, normalized: normalizeStreet(name), family: streetFamily(name) }));
  state.approachOptions = state.streetOptions;
  state.all.forEach(street => {
    if (!street.name) return;
    const family = streetFamily(street.name);
    if (!state.familyNames.has(family)) state.familyNames.set(family, new Set());
    state.familyNames.get(family).add(street.name);
    if (!state.familySegments.has(family)) state.familySegments.set(family, []);
    state.familySegments.get(family).push(street);
  });
  const ignoredEndpoints = new Set(['', 'none', 'end', 'segment break']);
  state.all.forEach(street => {
    const family = streetFamily(street.name || '');
    if (!family) return;
    for (const endpoint of [street.fromStreet, street.toStreet]) {
      const connected = streetFamily(endpoint || '');
      if (ignoredEndpoints.has(connected) || connected === family || !state.familyNames.has(connected)) continue;
      if (!state.connectedFamilies.has(family)) state.connectedFamilies.set(family, new Set());
      state.connectedFamilies.get(family).add(connected);
    }
  });
  if (window.L) {
    state.map = L.map('map').setView([39.6, -105.02], 12);
    state.renderer = L.canvas({ padding: 0.5 });
    const streetPoints = state.all.filter(street => street.geometry).flatMap(street => streetGeometry(street).flat());
    const dataBounds = L.latLngBounds(streetPoints);
    const areaBounds = L.latLngBounds(
      [dataBounds.getSouth() - 0.004, dataBounds.getWest() - 0.004],
      [dataBounds.getNorth() + 0.004, dataBounds.getEast() + 0.004]
    );
    state.map.setMaxBounds(areaBounds);
    state.map.options.maxBoundsViscosity = 1;
    state.map.setMinZoom(11);
  L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Street_Map/MapServer/tile/{z}/{y}/{x}', {
    attribution: 'Tiles &copy; <a href="https://www.esri.com/" target="_blank" rel="noopener">Esri</a> — Street data contributors',
    maxZoom: 19,
    maxNativeZoom: 19
  }).addTo(state.map);
    state.layer = L.featureGroup().addTo(state.map);
    state.highlightLayer = L.featureGroup().addTo(state.map);
  } else {
    $('map').innerHTML = '<div class="map-fallback"><strong>Map view unavailable</strong><p>The street table and estimates are still available. Connect to the internet and reload to enable the interactive map.</p></div>';
  }
  $('street-one').addEventListener('input', () => {
    updateStreetSuggestions($('street-one').value.trim());
    renderSuggestions('street-one', 'street-one-suggestions', state.streetOptions);
    renderSuggestions('street-two', 'street-two-suggestions', state.approachOptions);
    scheduleFilters();
  });
  $('street-two').addEventListener('input', () => { renderSuggestions('street-two', 'street-two-suggestions', state.approachOptions); scheduleFilters(); });
  document.querySelectorAll('#street-one,#street-two').forEach(input => input.addEventListener('focus', () => {
    if (input.id === 'street-one') renderSuggestions('street-one', 'street-one-suggestions', state.streetOptions);
    else renderSuggestions('street-two', 'street-two-suggestions', state.approachOptions);
  }));
  document.querySelectorAll('#street-one,#street-two').forEach(input => input.addEventListener('blur', () => {
    const match = state.streetNames.find(name => normalizeStreet(name) === normalizeStreet(input.value));
    if (match) input.value = displayStreetName(match);
  }));
  document.addEventListener('click', event => { if (!event.target.closest('.street-suggestions') && !event.target.matches('#street-one,#street-two')) hideSuggestions(); });
  $('reset-crossing').addEventListener('click', () => {
    $('street-one').value = '';
    $('street-two').value = '';
    updateStreetSuggestions('');
    hideSuggestions();
    state.selected = null;
    $('selected').innerHTML = '<p>Select a street on the map or enter two streets above.</p>';
    updateScene(null);
    $('vote-panel').hidden = true;
    applyFilters();
  });
  $('scene-restart').addEventListener('click', () => { if (state.sceneStreet) updateScene(state.sceneStreet); });
  $('swap-crossing').addEventListener('click', () => {
    const first = $('street-one').value; $('street-one').value = $('street-two').value; $('street-two').value = first;
    state.direction = 'one-from-two';
    updateStreetSuggestions($('street-one').value.trim());
    renderSuggestions('street-one', 'street-one-suggestions', state.streetOptions);
    renderSuggestions('street-two', 'street-two-suggestions', state.approachOptions);
    scheduleFilters();
  });
  $('vote-adequate').dataset.vote = 'adequate'; $('vote-inadequate').dataset.vote = 'inadequate';
  $('vote-adequate').addEventListener('click', () => castVote('adequate')); $('vote-inadequate').addEventListener('click', () => castVote('inadequate'));
  applyFilters();
}

init().catch(error => { $('map').innerHTML = `<div class="map-fallback"><strong>Unable to load street data</strong><p>${esc(error.message || 'Unknown error')}</p></div>`; console.error(error); });
