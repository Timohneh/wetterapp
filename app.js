// ─── Wetter-App ── Multi-Model + Ensemble + Karten-Overlay ──────────────────

const WEIGHTS = {
    icon_d2:              0.35,
    ecmwf_ifs:            0.25,
    meteofrance_seamless: 0.20,
    gfs_seamless:         0.12,
    ukmo_seamless:        0.08
};

const WMO = {
    0:  { icon: 'sun',             desc: 'Klarer Himmel' },
    1:  { icon: 'cloud-sun',       desc: 'Überwiegend heiter' },
    2:  { icon: 'cloud',           desc: 'Teilweise bewölkt' },
    3:  { icon: 'cloud',           desc: 'Bedeckt' },
    45: { icon: 'cloud-fog',       desc: 'Nebel' },
    48: { icon: 'cloud-fog',       desc: 'Gefrierender Nebel' },
    51: { icon: 'cloud-drizzle',   desc: 'Nieselregen (leicht)' },
    53: { icon: 'cloud-drizzle',   desc: 'Nieselregen' },
    55: { icon: 'cloud-rain',      desc: 'Nieselregen (kräftig)' },
    61: { icon: 'cloud-rain',      desc: 'Regen (schwach)' },
    63: { icon: 'cloud-rain',      desc: 'Regen (mäßig)' },
    65: { icon: 'cloud-rain',      desc: 'Regen (kräftig)' },
    71: { icon: 'cloud-snow',      desc: 'Schnee (schwach)' },
    73: { icon: 'cloud-snow',      desc: 'Schnee (mäßig)' },
    75: { icon: 'cloud-snow',      desc: 'Schnee (kräftig)' },
    77: { icon: 'snowflake',       desc: 'Schneekörner' },
    80: { icon: 'cloud-rain',      desc: 'Regenschauer (schwach)' },
    81: { icon: 'cloud-rain',      desc: 'Regenschauer (mäßig)' },
    82: { icon: 'cloud-rain',      desc: 'Regenschauer (kräftig)' },
    85: { icon: 'cloud-snow',      desc: 'Schneeschauer (schwach)' },
    86: { icon: 'cloud-snow',      desc: 'Schneeschauer (kräftig)' },
    95: { icon: 'cloud-lightning', desc: 'Gewitter' },
    96: { icon: 'cloud-lightning', desc: 'Gewitter mit Hagel' },
    99: { icon: 'cloud-lightning', desc: 'Gewitter mit Hagel' }
};

const DAY_NAMES = ['So', 'Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa'];
const COL_W = 52;

let map              = null;
let radarLayer       = null;
let weatherGridLayer = null;
let currentLat       = null;
let currentLon       = null;
let cachedModels     = null;
let cachedLongRange  = null;
let cachedEnsemble   = null;
let cachedGridData   = null;

// ─── Init ────────────────────────────────────────────────────────────────────

document.addEventListener('DOMContentLoaded', () => {
    initLucide();
    initMap();
    getGeolocation();
    setupEventListeners();
});

function initLucide() {
    if (typeof lucide !== 'undefined') lucide.createIcons();
}

function renderIcons(container) {
    if (typeof lucide !== 'undefined' && container) lucide.createIcons({ nodes: [container] });
}

// ─── Map ─────────────────────────────────────────────────────────────────────

function initMap() {
    map = L.map('map', { center: [51.165, 10.451], zoom: 6 });
    L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_nolabels/{z}/{x}/{y}{r}.png', {
        attribution: '© OpenStreetMap © CARTO',
        subdomains: 'abcd',
        maxZoom: 18
    }).addTo(map);
    L.control.scale().addTo(map);
}

// ─── Geolocation ──────────────────────────────────────────────────────────────

function getGeolocation() {
    if (!navigator.geolocation) { fallbackLocation(); return; }
    navigator.geolocation.getCurrentPosition(
        pos => {
            currentLat = pos.coords.latitude;
            currentLon = pos.coords.longitude;
            map.setView([currentLat, currentLon], 10);
            updateLocationDisplay(currentLat, currentLon);
            fetchWeather();
        },
        () => fallbackLocation()
    );
}

function fallbackLocation() {
    currentLat = 51.165; currentLon = 10.451;
    updateLocationDisplay(currentLat, currentLon);
    fetchWeather();
}

function updateLocationDisplay(lat, lon) {
    document.getElementById('location-coords').textContent = `${lat.toFixed(2)}°N, ${lon.toFixed(2)}°E`;
    document.getElementById('current-location').textContent = resolveRegion(lat, lon);
}

function resolveRegion(lat, lon) {
    const pts = [
        ['Hamburg', 53.55, 10.0], ['Berlin', 52.52, 13.4],
        ['München', 48.14, 11.58], ['Köln', 50.94, 6.96],
        ['Frankfurt', 50.11, 8.68], ['Stuttgart', 48.78, 9.18],
        ['Düsseldorf', 51.23, 6.77], ['Leipzig', 51.34, 12.38],
        ['Bremen', 53.08, 8.80], ['Dresden', 51.05, 13.74],
        ['Hannover', 52.37, 9.73], ['Nürnberg', 49.45, 11.08],
        ['Schleswig-Holstein', 54.0, 9.5], ['Mecklenburg-Vorpommern', 53.8, 12.5],
        ['Niedersachsen', 52.5, 9.5], ['Brandenburg', 52.2, 13.0],
        ['Sachsen-Anhalt', 52.0, 11.5], ['Sachsen', 51.0, 13.5],
        ['Thüringen', 50.8, 11.0], ['Hessen', 50.5, 9.0],
        ['Nordrhein-Westfalen', 51.5, 7.5], ['Rheinland-Pfalz', 50.0, 7.5],
        ['Saarland', 49.2, 6.8], ['Baden-Württemberg', 48.5, 9.0], ['Bayern', 48.5, 11.5]
    ];
    let best = 'Deutschland', minD = Infinity;
    for (const [n, rlat, rlon] of pts) {
        const d = Math.hypot(lat - rlat, lon - rlon);
        if (d < minD) { minD = d; best = n; }
    }
    return best;
}

// ─── Event Listeners ──────────────────────────────────────────────────────────

function setupEventListeners() {
    const mapToggleBtn = document.getElementById('map-toggle-btn');
    const mapWrapper   = document.getElementById('map-wrapper');
    const isMobile     = () => window.innerWidth < 768;

    if (isMobile()) {
        mapWrapper.classList.remove('expanded');
        mapToggleBtn.textContent = 'Karte anzeigen';
    }

    mapToggleBtn.addEventListener('click', () => {
        if (isMobile()) {
            const open = mapWrapper.classList.toggle('expanded');
            mapToggleBtn.textContent = open ? 'Karte ausblenden' : 'Karte anzeigen';
        } else {
            const coll = mapWrapper.classList.toggle('collapsed');
            mapToggleBtn.textContent = coll ? 'Karte anzeigen' : 'Karte ausblenden';
        }
        setTimeout(() => map.invalidateSize(), 350);
    });

    // Radar
    document.getElementById('radar-toggle').addEventListener('change', e => {
        const ctrl = document.getElementById('opacity-control');
        if (e.target.checked) {
            ctrl.classList.remove('hidden');
            initRadar();
        } else {
            ctrl.classList.add('hidden');
            if (radarLayer) { radarLayer.remove(); radarLayer = null; }
        }
    });

    document.getElementById('radar-opacity').addEventListener('input', e => {
        document.getElementById('opacity-value').textContent = e.target.value;
        if (radarLayer) radarLayer.setOpacity(e.target.value / 100);
    });

    // Temperatur & Wind Overlay
    document.getElementById('overlay-toggle').addEventListener('change', async e => {
        const legend = document.getElementById('temp-legend');
        if (e.target.checked) {
            legend.classList.remove('hidden');
            if (!map.getContainer().querySelector('.weather-canvas')) {
                // make sure map is expanded on mobile
                if (isMobile() && !mapWrapper.classList.contains('expanded')) {
                    mapWrapper.classList.add('expanded');
                    mapToggleBtn.textContent = 'Karte ausblenden';
                    setTimeout(() => map.invalidateSize(), 350);
                }
            }
            const data = cachedGridData || await fetchWeatherGrid();
            if (!cachedGridData && data) cachedGridData = data;
            if (data) {
                if (!weatherGridLayer) {
                    weatherGridLayer = new WeatherGridLayer();
                    weatherGridLayer.addTo(map);
                }
                weatherGridLayer.setData(data);
            }
        } else {
            legend.classList.add('hidden');
            if (weatherGridLayer) { weatherGridLayer.remove(); weatherGridLayer = null; }
        }
    });

    // Location search
    const input    = document.getElementById('location-input');
    const dropdown = document.getElementById('location-dropdown');
    let searchTimer;

    input.addEventListener('input', e => {
        clearTimeout(searchTimer);
        const q = e.target.value.trim();
        if (q.length < 2) { dropdown.classList.add('hidden'); return; }
        searchTimer = setTimeout(() => searchLocation(q), 300);
    });

    document.addEventListener('click', e => {
        if (!e.target.closest('.search-wrap')) dropdown.classList.add('hidden');
    });

    document.getElementById('close-day-detail').addEventListener('click', closeDayDetail);
}

// ─── Radar (RainViewer direkte API) ──────────────────────────────────────────

async function initRadar() {
    if (radarLayer) return;
    try {
        const res  = await fetch('https://api.rainviewer.com/public/weather-maps.json');
        const data = await res.json();
        const past = data.radar.past;
        if (!past?.length) throw new Error('No frames');
        const latest  = past[past.length - 1];
        const tileUrl = `${data.host}${latest.path}/256/{z}/{x}/{y}/2/1_1.png`;
        radarLayer = L.tileLayer(tileUrl, { opacity: 0.7, attribution: 'RainViewer', tileSize: 256, zIndex: 10 });
        radarLayer.addTo(map);
    } catch (e) {
        console.error('Radar failed:', e);
        document.getElementById('radar-toggle').checked = false;
        document.getElementById('opacity-control').classList.add('hidden');
    }
}

// ─── Progressives Laden ───────────────────────────────────────────────────────
//  Tier 1: aktuelle Bedingungen + 14-Tage → sofort anzeigen
//  Tier 2: Ensemble-Spread + Grid-Overlay → im Hintergrund nachladen

async function fetchWeather() {
    try {
        // Tier 1 – kritischer Pfad
        const [models, longRange] = await Promise.all([
            fetchAllModels(),
            fetchLongRange()
        ]);
        cachedModels    = models;
        cachedLongRange = longRange;

        const modelArr = Object.values(models);
        const merged   = mergeModels(modelArr);

        displayWeather(merged, modelArr);
        displayHourlyForecast(longRange, 0, 'hourly-forecast', null, null);
        displayDailyForecast(longRange, null);
        displayModelComparison(modelArr);

        document.getElementById('update-time').textContent =
            new Date().toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' });

        // Tier 2 – angereicherte Daten (non-blocking)
        Promise.all([
            fetchEnsembleHourly(),
            fetchWeatherGrid(),
            fetchDailyEnsemble()
        ]).then(([ensemble, gridData, dailyEns]) => {
            cachedEnsemble = ensemble;
            if (gridData) cachedGridData = gridData;

            if (ensemble)  displayHourlyForecast(longRange, 0, 'hourly-forecast', ensemble, null);
            if (dailyEns)  displayDailyForecast(longRange, dailyEns);
            if (gridData && weatherGridLayer) weatherGridLayer.setData(gridData);
        }).catch(e => console.warn('Tier-2 fetch failed:', e));

    } catch (err) {
        console.error(err);
        document.querySelector('.hero-card').innerHTML =
            `<p class="error-msg">Fehler beim Laden. Bitte erneut versuchen.</p>`;
    }
}

// 5 Modelle, nur aktuelle Bedingungen (schnell, forecast_days:1)
async function fetchAllModels() {
    const [icon, ecmwf, meteofrance, gfs, ukmo] = await Promise.all([
        fetchModel('icon_d2',              'ICON-D2 (DWD)'),
        fetchModel('ecmwf_ifs',            'ECMWF-IFS'),
        fetchModel('meteofrance_seamless', 'Météo-France'),
        fetchModel('gfs_seamless',         'GFS'),
        fetchModel('ukmo_seamless',        'UK Met Office')
    ]);
    return { icon, ecmwf, meteofrance, gfs, ukmo };
}

async function fetchModel(model, label) {
    const url = new URL('https://api.open-meteo.com/v1/forecast');
    url.searchParams.set('latitude',      currentLat);
    url.searchParams.set('longitude',     currentLon);
    url.searchParams.set('current', 'temperature_2m,relative_humidity_2m,precipitation,weather_code,wind_speed_10m');
    url.searchParams.set('models',        model);
    url.searchParams.set('timezone',      'Europe/Berlin');
    url.searchParams.set('forecast_days', '1');
    const res = await fetch(url);
    if (!res.ok) throw new Error(`Model ${label} failed`);
    const d = await res.json();
    return {
        model, label,
        temp: d.current.temperature_2m, humidity: d.current.relative_humidity_2m,
        precipitation: d.current.precipitation || 0, wind: d.current.wind_speed_10m,
        weather_code: d.current.weather_code, current: d.current
    };
}

// best_match, 14 Tage, stündlich + täglich
async function fetchLongRange() {
    const url = new URL('https://api.open-meteo.com/v1/forecast');
    url.searchParams.set('latitude',  currentLat);
    url.searchParams.set('longitude', currentLon);
    url.searchParams.set('hourly',    'temperature_2m,precipitation_probability,precipitation,weather_code,wind_speed_10m');
    url.searchParams.set('daily', [
        'temperature_2m_max', 'temperature_2m_min', 'precipitation_sum',
        'weather_code', 'wind_speed_10m_max', 'precipitation_probability_max'
    ].join(','));
    url.searchParams.set('timezone',      'Europe/Berlin');
    url.searchParams.set('forecast_days', '14');
    const res = await fetch(url);
    if (!res.ok) throw new Error('Long-range failed');
    return await res.json();
}

// Stündliche Daten von 3 Modellen für Spread-Visualisierung (heute + morgen)
async function fetchEnsembleHourly() {
    const [icon, ecmwf, gfs] = await Promise.all([
        fetchModelHourly('icon_d2'),
        fetchModelHourly('ecmwf_ifs'),
        fetchModelHourly('gfs_seamless')
    ]);
    return { icon, ecmwf, gfs };
}

async function fetchModelHourly(model) {
    const url = new URL('https://api.open-meteo.com/v1/forecast');
    url.searchParams.set('latitude',      currentLat);
    url.searchParams.set('longitude',     currentLon);
    url.searchParams.set('hourly',        'temperature_2m,wind_speed_10m');
    url.searchParams.set('models',        model);
    url.searchParams.set('timezone',      'Europe/Berlin');
    url.searchParams.set('forecast_days', '2');
    const res = await fetch(url);
    if (!res.ok) throw new Error(`Hourly ${model} failed`);
    return await res.json();
}

// ECMWF (10d) + GFS (14d) täglich für Spread-Indikator in 14-Tage-Vorschau
async function fetchDailyEnsemble() {
    const [ecmwf, gfs] = await Promise.all([
        fetchDailyModel('ecmwf_ifs',   10),
        fetchDailyModel('gfs_seamless', 14)
    ]);
    return { ecmwf, gfs };
}

async function fetchDailyModel(model, days) {
    const url = new URL('https://api.open-meteo.com/v1/forecast');
    url.searchParams.set('latitude',      currentLat);
    url.searchParams.set('longitude',     currentLon);
    url.searchParams.set('daily', 'temperature_2m_max,temperature_2m_min');
    url.searchParams.set('models',        model);
    url.searchParams.set('timezone',      'Europe/Berlin');
    url.searchParams.set('forecast_days', String(days));
    const res = await fetch(url);
    if (!res.ok) throw new Error(`Daily ${model} failed`);
    return await res.json();
}

// 5×5 Gitternetz für Karten-Overlay (Open-Meteo Bulk API)
async function fetchWeatherGrid() {
    const STEP = 0.55, HALF = 2;  // ~60km Abstand
    const lats = [], lons = [];
    for (let di = -HALF; di <= HALF; di++) {
        for (let dj = -HALF; dj <= HALF; dj++) {
            lats.push((currentLat + di * STEP).toFixed(2));
            lons.push((currentLon + dj * STEP).toFixed(2));
        }
    }
    const url = new URL('https://api.open-meteo.com/v1/forecast');
    url.searchParams.set('latitude',  lats.join(','));
    url.searchParams.set('longitude', lons.join(','));
    url.searchParams.set('current', 'temperature_2m,wind_speed_10m,wind_direction_10m,weather_code');
    url.searchParams.set('timezone',      'Europe/Berlin');
    url.searchParams.set('forecast_days', '1');
    const res  = await fetch(url);
    const data = await res.json();
    const arr  = Array.isArray(data) ? data : [data];
    return arr.map((d, i) => ({
        lat: parseFloat(lats[i]), lon: parseFloat(lons[i]),
        temp:      d.current?.temperature_2m,
        windSpeed: d.current?.wind_speed_10m,
        windDir:   d.current?.wind_direction_10m,
        code:      d.current?.weather_code
    }));
}

// ─── Merge ────────────────────────────────────────────────────────────────────

function mergeModels(arr) {
    const w = { temp: 0, humidity: 0, precipitation: 0, wind: 0 };
    arr.forEach(m => {
        const wt = WEIGHTS[m.model] || 0;
        w.temp          += m.temp          * wt;
        w.humidity      += m.humidity      * wt;
        w.precipitation += m.precipitation * wt;
        w.wind          += m.wind          * wt;
    });
    const temps   = arr.map(m => m.temp);
    const winds   = arr.map(m => m.wind);
    const tempVar = temps.reduce((s, t) => s + Math.abs(t - w.temp), 0) / temps.length;
    const windVar = winds.reduce((s, v) => s + Math.abs(v - w.wind), 0) / winds.length;
    const confidence = Math.round(Math.max(0, Math.min(100, 100 - (tempVar + windVar) / 2 / 15 * 100)));
    return {
        temp: Math.round(w.temp * 10) / 10, humidity: Math.round(w.humidity),
        precipitation: Math.round(w.precipitation * 10) / 10, wind: Math.round(w.wind),
        confidence, models: arr,
        tempRange: { min: Math.min(...temps), max: Math.max(...temps) }
    };
}

// ─── Display: Aktuelles Wetter ────────────────────────────────────────────────

function displayWeather(data, modelArray) {
    const { temp, humidity, precipitation, wind, confidence, tempRange } = data;
    document.getElementById('temp-display').textContent          = `${temp}°`;
    document.getElementById('temp-range').textContent            = `${Math.round(tempRange.min)}° – ${Math.round(tempRange.max)}°C`;
    document.getElementById('humidity-display').textContent      = `${humidity}%`;
    document.getElementById('precipitation-display').textContent = `${precipitation} mm`;
    document.getElementById('wind-display').textContent          = `${wind} km/h`;

    const code   = modelArray[0].current.weather_code;
    const info   = WMO[code] || { icon: 'cloud', desc: 'Unbekannt' };
    const iconEl = document.getElementById('weather-icon');
    iconEl.innerHTML = `<i data-lucide="${info.icon}" style="width:72px;height:72px;stroke-width:1.25"></i>`;
    renderIcons(iconEl);
    document.getElementById('weather-description').textContent = info.desc;

    const badge = document.getElementById('confidence-badge');
    const cls   = confidence > 75 ? 'confidence-high' : confidence > 50 ? 'confidence-medium' : 'confidence-low';
    const shld  = confidence > 75 ? 'shield-check' : 'shield-alert';
    const lbl   = confidence > 75 ? 'Hohe Sicherheit' : confidence > 50 ? 'Mäßige Sicherheit' : 'Niedrige Sicherheit';
    badge.className = `confidence-badge ${cls}`;
    badge.innerHTML = `<i data-lucide="${shld}" style="width:12px;height:12px"></i> ${lbl} &nbsp;${confidence}%`;
    renderIcons(badge);

    const trend    = calcTrend(modelArray);
    const trendArr = document.getElementById('trend-arrow');
    const trendTxt = document.getElementById('trend-text');
    if (trend.trend === 'rising')       { trendArr.textContent = '↑'; trendTxt.textContent = `+${trend.change.toFixed(1)}°C`; trendTxt.className = 'trend-rising'; }
    else if (trend.trend === 'falling') { trendArr.textContent = '↓'; trendTxt.textContent = `${trend.change.toFixed(1)}°C`;  trendTxt.className = 'trend-falling'; }
    else                                { trendArr.textContent = '—'; trendTxt.textContent = 'Stabil';                        trendTxt.className = 'trend-stable'; }

    const vis = Math.min(10, Math.round(10 / Math.max(0.1, precipitation) * 10) / 10);
    document.getElementById('visibility-stat').textContent    = `${vis} km`;
    document.getElementById('uv-stat').textContent            = getUVIndex(temp, humidity);
    document.getElementById('dewpoint-stat').textContent      = `${calcDewpoint(temp, humidity).toFixed(1)}°C`;
    document.getElementById('precipitation-prob').textContent = `${calcPrecipProb(modelArray).toFixed(0)}%`;
    initLucide();
}

// ─── Display: Grafischer Stundenchart (mit Ensemble-Spread-Band) ──────────────

function displayHourlyForecast(data, dayOffset, containerId, ensemble, _unused) {
    const start = dayOffset * 24;
    const end   = start + 24;
    const times = data.hourly.time.slice(start, end);
    const temps = data.hourly.temperature_2m.slice(start, end);
    const probs = (data.hourly.precipitation_probability || []).slice(start, end);
    const codes = data.hourly.weather_code.slice(start, end);
    const winds = (data.hourly.wind_speed_10m || []).slice(start, end);

    const container = document.getElementById(containerId);
    if (!container || !times.length) return;

    const W       = COL_W * times.length;
    const nowHour = new Date().getHours();
    const nowIdx  = dayOffset === 0
        ? times.findIndex(t => parseInt(t.slice(11, 13)) === nowHour)
        : -1;

    // Temperatur-Chart-Geometrie
    const CHART_H = 104, PAD_T = 24, PAD_B = 6;
    const validT  = temps.filter(t => t != null && !isNaN(t));
    if (!validT.length) { container.innerHTML = '<p style="color:var(--text-3);font-size:0.85rem">Keine Daten</p>'; return; }
    const minT   = Math.min(...validT) - 1.5;
    const maxT   = Math.max(...validT) + 1.5;
    const rangeT = maxT - minT || 1;
    const mapY   = t => PAD_T + (1 - ((t ?? minT) - minT) / rangeT) * (CHART_H - PAD_T - PAD_B);

    const pts    = temps.map((t, i) => ({ x: i * COL_W + COL_W / 2, y: mapY(t) }));
    const curve  = smoothPath(pts);
    const area   = curve + ` L ${pts[pts.length-1].x.toFixed(1)},${CHART_H} L ${pts[0].x.toFixed(1)},${CHART_H} Z`;
    const nowX   = nowIdx >= 0 ? pts[nowIdx].x : -1;
    const vLine  = (x, h, col) => x >= 0
        ? `<line x1="${x.toFixed(1)}" y1="0" x2="${x.toFixed(1)}" y2="${h}" stroke="${col}" stroke-width="1" stroke-dasharray="3,3"/>`
        : '';

    // Ensemble Spread-Band (zwischen min/max der 3 Modelle)
    let spreadBandSVG = '';
    if (ensemble) {
        const enModels = Object.values(ensemble);
        const topPts   = [], botPts = [];
        for (let i = 0; i < times.length; i++) {
            const vals = enModels
                .map(m => m.hourly?.temperature_2m?.[start + i])
                .filter(v => v != null && !isNaN(v));
            if (vals.length >= 2) {
                topPts.push({ x: i * COL_W + COL_W / 2, y: mapY(Math.max(...vals)) });
                botPts.push({ x: i * COL_W + COL_W / 2, y: mapY(Math.min(...vals)) });
            }
        }
        if (topPts.length >= 2) spreadBandSVG = buildSpreadBand(topPts, botPts);
    }

    // Temperatur-Labels + Punkte
    const tempLabels = pts.map((p, i) =>
        `<text x="${p.x.toFixed(1)}" y="${(p.y - 6).toFixed(1)}" text-anchor="middle" fill="#e2e8f0" font-size="10" font-weight="600" font-family="-apple-system,system-ui,sans-serif">${Math.round(temps[i] ?? 0)}°</text>`
    ).join('');
    const tempDots = pts.map(p =>
        `<circle cx="${p.x.toFixed(1)}" cy="${p.y.toFixed(1)}" r="2.5" fill="#f59e0b"/>`
    ).join('');

    const tempSVG = `<svg width="${W}" height="${CHART_H}" style="display:block;overflow:visible">
        <defs>
            <linearGradient id="tg_${containerId}" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stop-color="#f59e0b" stop-opacity="0.18"/>
                <stop offset="100%" stop-color="#f59e0b" stop-opacity="0.01"/>
            </linearGradient>
        </defs>
        ${vLine(nowX, CHART_H, 'rgba(245,158,11,0.25)')}
        ${spreadBandSVG}
        <path d="${area}" fill="url(#tg_${containerId})"/>
        <path d="${curve}" fill="none" stroke="#f59e0b" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
        ${tempDots}
        ${tempLabels}
    </svg>`;

    // Niederschlagsbalken
    const PREC_H   = 40;
    const precBars = probs.map((p, i) => {
        const prob = p ?? 0;
        if (prob === 0) return '';
        const bh   = Math.max(2, (prob / 100) * (PREC_H - 8));
        const x    = i * COL_W + 5, bw = COL_W - 10;
        const opac = (0.25 + (prob / 100) * 0.5).toFixed(2);
        return `<rect x="${x}" y="${PREC_H - bh}" width="${bw}" height="${bh}" rx="2.5" fill="rgba(96,165,250,${opac})"/>`;
    }).join('');
    const precLabels = probs.map((p, i) => {
        if ((p ?? 0) < 15) return '';
        return `<text x="${(i * COL_W + COL_W/2).toFixed(1)}" y="${PREC_H - 2}" text-anchor="middle" fill="rgba(147,197,253,0.85)" font-size="9" font-family="-apple-system,system-ui,sans-serif">${p}%</text>`;
    }).join('');
    const precSVG = `<svg width="${W}" height="${PREC_H}" style="display:block">
        ${vLine(nowX, PREC_H, 'rgba(245,158,11,0.2)')}
        ${precBars}${precLabels}
    </svg>`;

    // Icon-Zeile (Nacht-Icon für Code 0 zwischen 21-6 Uhr)
    const iconRow = times.map((t, i) => {
        const h     = parseInt(t.slice(11, 13));
        const isNow = i === nowIdx;
        const info  = WMO[codes[i]] || { icon: 'cloud' };
        const icon  = (codes[i] === 0 && (h < 6 || h >= 21)) ? 'moon' : info.icon;
        return `<div class="ch-icon${isNow ? ' ch-now' : ''}" style="width:${COL_W}px"><i data-lucide="${icon}"></i></div>`;
    }).join('');

    // Wind-Zeile
    const windRow = winds.map((w, i) =>
        `<div class="ch-wind" style="width:${COL_W}px">${Math.round(w ?? 0)}</div>`
    ).join('');

    // Zeitstempel-Zeile
    const timeRow = times.map((t, i) => {
        const h     = parseInt(t.slice(11, 13));
        const isNow = i === nowIdx;
        return `<div class="ch-time${isNow ? ' ch-now' : ''}" style="width:${COL_W}px">${String(h).padStart(2, '0')}</div>`;
    }).join('');

    // Legende (ob Ensemble-Spread vorhanden)
    const spreadNote = ensemble
        ? `<span style="color:rgba(245,158,11,0.5)"><span class="cl-dot" style="background:rgba(245,158,11,0.35);width:10px;height:6px;border-radius:2px"></span>Modell-Spread</span>`
        : '';

    container.innerHTML = `
    <div class="chart-legend">
        <span><span class="cl-dot" style="background:#f59e0b"></span>Temperatur</span>
        <span><span class="cl-dot" style="background:#60a5fa"></span>Niederschlag</span>
        <span><span class="cl-dot" style="background:#475569"></span>Wind km/h</span>
        ${spreadNote}
    </div>
    <div class="chart-outer">
        <div style="width:${W}px">
            <div class="ch-row">${iconRow}</div>
            ${tempSVG}
            ${precSVG}
            <div class="ch-row ch-winds">${windRow}</div>
            <div class="ch-row ch-times">${timeRow}</div>
        </div>
    </div>`;

    renderIcons(container);

    if (nowIdx > 2 && dayOffset === 0) {
        const outer = container.querySelector('.chart-outer');
        if (outer) outer.scrollLeft = (nowIdx - 2) * COL_W;
    }
}

// Geschlossenes Band zwischen min/max über bezier-Kurven (beide Richtungen)
function buildSpreadBand(topPts, botPts) {
    const n = Math.min(topPts.length, botPts.length);
    if (n < 2) return '';
    const tp = topPts.slice(0, n), bp = botPts.slice(0, n);

    let d = `M ${tp[0].x.toFixed(1)},${tp[0].y.toFixed(1)}`;
    for (let i = 0; i < n - 1; i++) d += cubicSeg(tp[i], tp[i+1]);
    // Sprung auf letzten unteren Punkt, dann rückwärts
    d += ` L ${bp[n-1].x.toFixed(1)},${bp[n-1].y.toFixed(1)}`;
    for (let i = n - 1; i > 0; i--) d += cubicSeg(bp[i], bp[i-1]);
    return `<path d="${d} Z" fill="rgba(245,158,11,0.12)" stroke="rgba(245,158,11,0.22)" stroke-width="0.5"/>`;
}

function cubicSeg(p0, p1) {
    const dx = p1.x - p0.x;
    return ` C ${(p0.x + dx*0.4).toFixed(1)},${p0.y.toFixed(1)} ${(p1.x - dx*0.4).toFixed(1)},${p1.y.toFixed(1)} ${p1.x.toFixed(1)},${p1.y.toFixed(1)}`;
}

// ─── Display: 14-Tage-Vorschau (mit Modell-Spread-Indikator) ─────────────────

function displayDailyForecast(data, dailyEns) {
    const d = data.daily;
    if (!d?.time) return;

    const html = d.time.map((dateStr, i) => {
        const date    = new Date(dateStr + 'T12:00:00');
        const isToday = i === 0;
        const code    = d.weather_code[i];
        const info    = WMO[code] || { icon: 'cloud' };
        const maxT    = Math.round(d.temperature_2m_max[i] ?? 0);
        const minT    = Math.round(d.temperature_2m_min[i] ?? 0);
        const prob    = d.precipitation_probability_max[i] ?? 0;

        // Unsicherheits-Indikator aus Modell-Spread
        let spreadHtml = '';
        if (dailyEns) {
            const spread = computeDailySpread(dailyEns, i);
            if (spread != null) {
                const col = spread < 1.5 ? '#34d399' : spread < 3 ? '#f59e0b' : '#f87171';
                spreadHtml = `<span class="d-spread" style="color:${col}">±${spread.toFixed(1)}°</span>`;
            }
        }

        // Weiter entfernte Tage visuell ausblenden (zunehmende Unsicherheit)
        const opacity = i < 3 ? 1 : i < 7 ? 0.82 : 0.58;

        return `
        <div class="daily-item${isToday ? ' is-today' : ''}" onclick="showDayDetail(${i})" data-day="${i}" style="opacity:${opacity}">
            <span class="d-name">${isToday ? 'Heute' : DAY_NAMES[date.getDay()]}</span>
            <span class="d-date">${date.getDate()}.${date.getMonth() + 1}.</span>
            <div class="d-icon"><i data-lucide="${info.icon}"></i></div>
            <span class="d-max">${maxT}°</span>
            <span class="d-min">${minT}° ${spreadHtml}</span>
            <div class="d-precip-bar-wrap"><div class="d-precip-bar" style="width:${prob}%"></div></div>
        </div>`;
    }).join('');

    const container = document.getElementById('daily-forecast');
    container.innerHTML = html;
    renderIcons(container);
}

function computeDailySpread(dailyEns, i) {
    const eMax = dailyEns.ecmwf?.daily?.temperature_2m_max?.[i];
    const gMax = dailyEns.gfs?.daily?.temperature_2m_max?.[i];
    const eMin = dailyEns.ecmwf?.daily?.temperature_2m_min?.[i];
    const gMin = dailyEns.gfs?.daily?.temperature_2m_min?.[i];
    if (eMax == null || gMax == null) return null;
    return (Math.abs(eMax - gMax) + Math.abs((eMin ?? 0) - (gMin ?? 0))) / 2;
}

// ─── Tag-Detail-Panel ────────────────────────────────────────────────────────

function showDayDetail(dayIndex) {
    if (!cachedLongRange) return;
    document.querySelectorAll('.daily-item').forEach(el => el.classList.remove('active'));
    const clicked = document.querySelector(`.daily-item[data-day="${dayIndex}"]`);
    if (clicked) clicked.classList.add('active');

    const daily   = cachedLongRange.daily;
    const date    = new Date(daily.time[dayIndex] + 'T12:00:00');
    const maxT    = Math.round(daily.temperature_2m_max[dayIndex] ?? 0);
    const minT    = Math.round(daily.temperature_2m_min[dayIndex] ?? 0);
    const label   = dayIndex === 0 ? 'Heute'
                  : dayIndex === 1 ? 'Morgen'
                  : `${DAY_NAMES[date.getDay()]}, ${date.getDate()}.${date.getMonth()+1}.${date.getFullYear()}`;

    document.getElementById('day-detail-title').textContent = `${label} · ${maxT}° / ${minT}°`;
    displayHourlyForecast(cachedLongRange, dayIndex, 'day-detail-hourly',
        dayIndex <= 1 ? cachedEnsemble : null, null);

    const panel = document.getElementById('day-detail-panel');
    panel.classList.remove('hidden');
    panel.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    renderIcons(panel.querySelector('.close-btn'));
}

function closeDayDetail() {
    document.getElementById('day-detail-panel').classList.add('hidden');
    document.querySelectorAll('.daily-item').forEach(el => el.classList.remove('active'));
}

// ─── Display: Modell-Vergleich ────────────────────────────────────────────────

function displayModelComparison(modelArray) {
    const temps  = modelArray.map(m => m.temp);
    const tMin   = Math.min(...temps), tMax = Math.max(...temps);
    const tRange = tMax - tMin || 1;

    const html = modelArray.map(m => {
        const wPct  = Math.round(WEIGHTS[m.model] * 100);
        const delta = m.temp - modelArray.reduce((s, x) => s + x.temp * WEIGHTS[x.model], 0);
        const bar   = Math.round(((m.temp - tMin) / tRange) * 100);
        const deltaStr = delta > 0 ? `+${delta.toFixed(1)}` : delta.toFixed(1);
        const deltaCol = Math.abs(delta) < 0.5 ? 'var(--text-3)' : delta > 0 ? '#fb923c' : '#60a5fa';
        return `
        <div class="model-row">
            <div>
                <div class="model-row-label">${m.label}</div>
                <div class="model-row-weight">Gewicht: <span>${wPct}%</span></div>
            </div>
            <div style="flex:1;margin:0 0.75rem;">
                <div style="height:4px;background:var(--card-b);border-radius:999px;overflow:hidden">
                    <div style="height:100%;width:${bar}%;background:var(--accent);border-radius:999px;transition:width 0.5s"></div>
                </div>
            </div>
            <div class="model-row-vals">
                <div class="model-row-temp">${m.temp.toFixed(1)}°C <small style="color:${deltaCol}">(${deltaStr}°)</small></div>
                <div class="model-row-wind">${m.wind.toFixed(1)} km/h</div>
            </div>
        </div>`;
    }).join('');
    document.getElementById('model-comparison').innerHTML = html;
}

// ─── Canvas-Overlay: Temperatur-Heatmap + Wind ────────────────────────────────

class WeatherGridLayer {
    constructor() {
        this._canvas = null;
        this._map    = null;
        this._data   = [];
        this._drawBound   = null;
        this._resizeBound = null;
    }

    addTo(leafletMap) {
        this._map = leafletMap;
        const canvas = this._canvas = document.createElement('canvas');
        canvas.className = 'weather-canvas';
        canvas.style.cssText = 'position:absolute;top:0;left:0;pointer-events:none;z-index:450;';
        leafletMap.getContainer().appendChild(canvas);

        const size = leafletMap.getSize();
        canvas.width = size.x; canvas.height = size.y;

        this._drawBound   = () => this._draw();
        this._resizeBound = () => {
            const s = leafletMap.getSize();
            canvas.width = s.x; canvas.height = s.y;
            this._draw();
        };
        leafletMap.on('move zoom zoomend moveend', this._drawBound);
        leafletMap.on('resize', this._resizeBound);
        return this;
    }

    remove() {
        if (this._map) {
            this._map.off('move zoom zoomend moveend', this._drawBound);
            this._map.off('resize', this._resizeBound);
        }
        if (this._canvas) this._canvas.remove();
        this._canvas = null; this._map = null;
    }

    setData(data) {
        this._data = data;
        this._draw();
    }

    _draw() {
        if (!this._canvas || !this._data.length || !this._map) return;
        const ctx = this._canvas.getContext('2d');
        const W   = this._canvas.width, H = this._canvas.height;
        ctx.clearRect(0, 0, W, H);

        // Pass 1: Temperatur-Heatmap-Blobs (radiale Gradienten, überlappend)
        this._data.forEach(pt => {
            if (pt.temp == null) return;
            const px = this._map.latLngToContainerPoint([pt.lat, pt.lon]);
            if (px.x < -80 || px.x > W + 80 || px.y < -80 || px.y > H + 80) return;
            const rgb    = tempToRgb(pt.temp);
            const radius = Math.max(40, 70 - this._map.getZoom() * 3);
            const grd    = ctx.createRadialGradient(px.x, px.y, 0, px.x, px.y, radius);
            grd.addColorStop(0,   `rgba(${rgb.r},${rgb.g},${rgb.b},0.38)`);
            grd.addColorStop(0.5, `rgba(${rgb.r},${rgb.g},${rgb.b},0.12)`);
            grd.addColorStop(1,   `rgba(${rgb.r},${rgb.g},${rgb.b},0)`);
            ctx.fillStyle = grd;
            ctx.beginPath();
            ctx.arc(px.x, px.y, radius, 0, Math.PI * 2);
            ctx.fill();
        });

        // Pass 2: Labels + Wind-Pfeile (oben drauf)
        ctx.font         = 'bold 12px -apple-system,system-ui,sans-serif';
        ctx.textAlign    = 'center';
        ctx.textBaseline = 'middle';

        this._data.forEach(pt => {
            if (pt.temp == null) return;
            const px = this._map.latLngToContainerPoint([pt.lat, pt.lon]);
            if (px.x < -20 || px.x > W + 20 || px.y < -20 || px.y > H + 20) return;

            // Temperatur mit Schatten
            ctx.shadowColor = 'rgba(0,0,0,0.9)';
            ctx.shadowBlur  = 5;
            ctx.fillStyle   = 'rgba(255,255,255,0.95)';
            ctx.fillText(`${Math.round(pt.temp)}°`, px.x, px.y);
            ctx.shadowBlur  = 0;

            // Wind-Pfeil (zeigt in Strömungsrichtung)
            if (pt.windDir != null && pt.windSpeed > 0.5) {
                drawWindArrow(ctx, px.x, px.y + 15, pt.windDir, pt.windSpeed);
            }
        });
    }
}

// Farbmapping: -15°C = tiefblau → 0°C = cyan → 10°C = grün → 20°C = gelb → 30°C = orange → 40°C = rot
function tempToRgb(temp) {
    const stops = [
        { t: -15, r: 15,  g: 35,  b: 230 },
        { t:   0, r: 30,  g: 175, b: 225 },
        { t:  10, r: 55,  g: 210, b: 80  },
        { t:  20, r: 240, g: 220, b: 35  },
        { t:  30, r: 255, g: 100, b: 10  },
        { t:  40, r: 200, g: 20,  b: 20  }
    ];
    const clamped = Math.max(-15, Math.min(40, temp));
    let i = 0;
    while (i < stops.length - 2 && stops[i + 1].t < clamped) i++;
    const lo = stops[i], hi = stops[i + 1];
    const t  = (clamped - lo.t) / (hi.t - lo.t);
    return {
        r: Math.round(lo.r + (hi.r - lo.r) * t),
        g: Math.round(lo.g + (hi.g - lo.g) * t),
        b: Math.round(lo.b + (hi.b - lo.b) * t)
    };
}

// Wind-Pfeil: meteorologische Richtung → Bildschirmwinkel
// fromDir=0 (Wind aus N, zieht nach S) → Pfeil zeigt nach unten
function drawWindArrow(ctx, x, y, fromDir, speed) {
    const angle = (fromDir + 90) * Math.PI / 180; // canvas-Winkel
    const len   = Math.min(22, Math.max(8, speed * 0.38 + 6));

    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(angle);

    ctx.strokeStyle = 'rgba(255,255,255,0.8)';
    ctx.lineWidth   = 1.5;
    ctx.lineCap     = 'round';
    ctx.shadowColor = 'rgba(0,0,0,0.7)';
    ctx.shadowBlur  = 3;

    ctx.beginPath();
    ctx.moveTo(0, -len / 2);
    ctx.lineTo(0,  len / 2);
    ctx.stroke();

    // Pfeilspitze
    ctx.beginPath();
    ctx.moveTo(0, len / 2);
    ctx.lineTo(-3.5, len / 2 - 5);
    ctx.moveTo(0, len / 2);
    ctx.lineTo( 3.5, len / 2 - 5);
    ctx.stroke();

    ctx.restore();
}

// ─── Standort-Suche ───────────────────────────────────────────────────────────

async function searchLocation(query) {
    try {
        const url = new URL('https://nominatim.openstreetmap.org/search');
        url.searchParams.set('q', query); url.searchParams.set('format', 'json');
        url.searchParams.set('limit', '7'); url.searchParams.set('countrycodes', 'de,at,ch');
        const res = await fetch(url, { headers: { 'Accept-Language': 'de' } });
        showDropdown(await res.json());
    } catch (e) { console.error('Search:', e); }
}

function showDropdown(results) {
    const dropdown = document.getElementById('location-dropdown');
    if (!results?.length) {
        dropdown.innerHTML = '<div class="dropdown-item" style="cursor:default;color:var(--text-3)">Keine Ergebnisse</div>';
        dropdown.classList.remove('hidden'); return;
    }
    dropdown.innerHTML = results.map((r, i) => `
        <div class="dropdown-item" onclick="selectLocationItem(${i})"
             data-lat="${r.lat}" data-lon="${r.lon}" data-name="${r.display_name}">
            <strong>${r.name || r.display_name.split(',')[0]}</strong><br>
            <small>${r.display_name.split(',').slice(1, 3).join(',').trim()}</small>
        </div>`).join('');
    dropdown.classList.remove('hidden');
}

function selectLocationItem(i) {
    const el = document.querySelectorAll('.dropdown-item')[i];
    if (!el) return;
    selectLocation(parseFloat(el.dataset.lat), parseFloat(el.dataset.lon), el.dataset.name);
}

function selectLocation(lat, lon, name) {
    currentLat = lat; currentLon = lon;
    document.getElementById('location-dropdown').classList.add('hidden');
    document.getElementById('location-input').value = name.split(',')[0];
    updateLocationDisplay(lat, lon);
    map.setView([lat, lon], 10);
    // Grid neu laden bei Ortswechsel
    cachedGridData = null;
    if (weatherGridLayer) { weatherGridLayer.remove(); weatherGridLayer = null; }
    fetchWeather();
}

// ─── Helfer ───────────────────────────────────────────────────────────────────

function calcTrend(models) {
    const temps  = models.map(m => m.temp);
    const change = temps[temps.length - 1] - temps[0];
    if (Math.abs(change) < 0.5) return { trend: 'stable', change };
    return { trend: change > 0 ? 'rising' : 'falling', change };
}

function calcDewpoint(temp, humidity) {
    const a = 17.27, b = 237.7;
    const alpha = ((a * temp) / (b + temp)) + Math.log(humidity / 100);
    return (b * alpha) / (a - alpha);
}

function getUVIndex(temp, humidity) { return Math.min(11, Math.max(0, (temp - 10) / 5)).toFixed(1); }
function calcPrecipProb(models) { return models.map(m => m.current.precipitation > 0 ? 80 : 20).reduce((a, b) => a + b) / models.length; }

// Glatte Bezier-Kurve durch Punkte
function smoothPath(pts) {
    if (!pts || pts.length < 2) return '';
    let d = `M ${pts[0].x.toFixed(1)},${pts[0].y.toFixed(1)}`;
    for (let i = 0; i < pts.length - 1; i++) d += cubicSeg(pts[i], pts[i+1]);
    return d;
}

// ─── Auto-Refresh ─────────────────────────────────────────────────────────────

setInterval(() => { if (currentLat && currentLon) fetchWeather(); }, 10 * 60 * 1000);
