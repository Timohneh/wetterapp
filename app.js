// Multi-Model Wetter-App
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
const COL_W = 52; // px per hour column in chart

let map         = null;
let radarLayer  = null;
let currentLat  = null;
let currentLon  = null;
let cachedModels    = null; // { icon, ecmwf, meteofrance, gfs, ukmo }
let cachedLongRange = null; // best_match 14-day data

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
    if (typeof lucide !== 'undefined' && container) {
        lucide.createIcons({ nodes: [container] });
    }
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
    const regions = [
        ['Hamburg', 53.55, 10.0], ['Berlin', 52.52, 13.4],
        ['München', 48.14, 11.58], ['Köln', 50.94, 6.96],
        ['Frankfurt', 50.11, 8.68], ['Stuttgart', 48.78, 9.18],
        ['Düsseldorf', 51.23, 6.77], ['Leipzig', 51.34, 12.38],
        ['Dortmund', 51.51, 7.46], ['Bremen', 53.08, 8.80],
        ['Dresden', 51.05, 13.74], ['Hannover', 52.37, 9.73],
        ['Nürnberg', 49.45, 11.08], ['Schleswig-Holstein', 54.0, 9.5],
        ['Mecklenburg-Vorpommern', 53.8, 12.5], ['Niedersachsen', 52.5, 9.5],
        ['Brandenburg', 52.2, 13.0], ['Sachsen-Anhalt', 52.0, 11.5],
        ['Sachsen', 51.0, 13.5], ['Thüringen', 50.8, 11.0],
        ['Hessen', 50.5, 9.0], ['Nordrhein-Westfalen', 51.5, 7.5],
        ['Rheinland-Pfalz', 50.0, 7.5], ['Saarland', 49.2, 6.8],
        ['Baden-Württemberg', 48.5, 9.0], ['Bayern', 48.5, 11.5]
    ];
    let best = 'Deutschland', minD = Infinity;
    for (const [name, rlat, rlon] of regions) {
        const d = Math.hypot(lat - rlat, lon - rlon);
        if (d < minD) { minD = d; best = name; }
    }
    return best;
}

// ─── Event Listeners ──────────────────────────────────────────────────────────

function setupEventListeners() {
    const mapToggleBtn = document.getElementById('map-toggle-btn');
    const mapWrapper   = document.getElementById('map-wrapper');
    const isMobile = () => window.innerWidth < 768;

    if (isMobile()) {
        mapWrapper.classList.remove('expanded');
        mapToggleBtn.textContent = 'Karte anzeigen';
    }

    mapToggleBtn.addEventListener('click', () => {
        if (isMobile()) {
            const open = mapWrapper.classList.toggle('expanded');
            mapToggleBtn.textContent = open ? 'Karte ausblenden' : 'Karte anzeigen';
        } else {
            const collapsed = mapWrapper.classList.toggle('collapsed');
            mapToggleBtn.textContent = collapsed ? 'Karte anzeigen' : 'Karte ausblenden';
        }
        setTimeout(() => map.invalidateSize(), 350);
    });

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

// ─── Radar (RainViewer API, kein Plugin nötig) ────────────────────────────────

async function initRadar() {
    if (radarLayer) return;
    try {
        const res  = await fetch('https://api.rainviewer.com/public/weather-maps.json');
        const data = await res.json();
        const past = data.radar.past;
        if (!past || past.length === 0) throw new Error('No radar frames');
        const latest  = past[past.length - 1];
        // Tile format: {host}{path}/{tileSize}/{z}/{x}/{y}/{colorScheme}/{options}.png
        const tileUrl = `${data.host}${latest.path}/256/{z}/{x}/{y}/2/1_1.png`;
        radarLayer = L.tileLayer(tileUrl, {
            opacity: 0.7,
            attribution: 'RainViewer',
            tileSize: 256,
            zIndex: 10
        });
        radarLayer.addTo(map);
    } catch (e) {
        console.error('Radar init failed:', e);
        const toggle = document.getElementById('radar-toggle');
        if (toggle) toggle.checked = false;
        document.getElementById('opacity-control').classList.add('hidden');
    }
}

// ─── Weather Fetch ─────────────────────────────────────────────────────────────

async function fetchWeather() {
    try {
        // Parallel: 5 short-range models for current conditions + 1 long-range for 14-day
        const [models, longRange] = await Promise.all([
            fetchAllModels(),
            fetchLongRange()
        ]);

        cachedModels    = models;
        cachedLongRange = longRange;

        const modelArr = Object.values(models);
        const merged   = mergeModels(modelArr);

        displayWeather(merged, modelArr);
        displayHourlyForecast(longRange, 0, 'hourly-forecast');
        displayDailyForecast(longRange);
        displayModelComparison(modelArr, merged.confidence);

        document.getElementById('update-time').textContent =
            new Date().toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' });

    } catch (err) {
        console.error(err);
        document.querySelector('.hero-card').innerHTML =
            `<p class="error-msg">Fehler beim Laden der Wetterdaten. Bitte erneut versuchen.</p>`;
    }
}

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

// Fetches only current conditions from one model (forecast_days:1 = fast)
async function fetchModel(model, label) {
    const url = new URL('https://api.open-meteo.com/v1/forecast');
    url.searchParams.set('latitude',  currentLat);
    url.searchParams.set('longitude', currentLon);
    url.searchParams.set('current', 'temperature_2m,relative_humidity_2m,precipitation,weather_code,wind_speed_10m');
    url.searchParams.set('models',        model);
    url.searchParams.set('timezone',      'Europe/Berlin');
    url.searchParams.set('forecast_days', '1');

    const res = await fetch(url);
    if (!res.ok) throw new Error(`Model ${label} failed`);
    const data = await res.json();

    return {
        model, label,
        temp:          data.current.temperature_2m,
        humidity:      data.current.relative_humidity_2m,
        precipitation: data.current.precipitation || 0,
        wind:          data.current.wind_speed_10m,
        weather_code:  data.current.weather_code,
        current:       data.current
    };
}

// Fetches 14 days of hourly + daily using best_match (GFS/ECMWF blend, up to 16 days)
async function fetchLongRange() {
    const url = new URL('https://api.open-meteo.com/v1/forecast');
    url.searchParams.set('latitude',  currentLat);
    url.searchParams.set('longitude', currentLon);
    url.searchParams.set('hourly', [
        'temperature_2m',
        'precipitation_probability',
        'precipitation',
        'weather_code',
        'wind_speed_10m'
    ].join(','));
    url.searchParams.set('daily', [
        'temperature_2m_max',
        'temperature_2m_min',
        'precipitation_sum',
        'weather_code',
        'wind_speed_10m_max',
        'precipitation_probability_max'
    ].join(','));
    url.searchParams.set('timezone',      'Europe/Berlin');
    url.searchParams.set('forecast_days', '14');
    // No 'models' param → Open-Meteo best_match (ICON-EU + ECMWF + GFS blend)

    const res = await fetch(url);
    if (!res.ok) throw new Error('Long-range fetch failed');
    return await res.json();
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
        temp:          Math.round(w.temp * 10) / 10,
        humidity:      Math.round(w.humidity),
        precipitation: Math.round(w.precipitation * 10) / 10,
        wind:          Math.round(w.wind),
        confidence,
        models: arr,
        tempRange: { min: Math.min(...temps), max: Math.max(...temps) }
    };
}

// ─── Display: Current Weather ─────────────────────────────────────────────────

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

    // Confidence badge
    const badge = document.getElementById('confidence-badge');
    const cls   = confidence > 75 ? 'confidence-high' : confidence > 50 ? 'confidence-medium' : 'confidence-low';
    const shld  = confidence > 75 ? 'shield-check' : 'shield-alert';
    const label = confidence > 75 ? 'Hohe Sicherheit' : confidence > 50 ? 'Mäßige Sicherheit' : 'Niedrige Sicherheit';
    badge.className = `confidence-badge ${cls}`;
    badge.innerHTML = `<i data-lucide="${shld}" style="width:12px;height:12px"></i> ${label} &nbsp;${confidence}%`;
    renderIcons(badge);

    // Trend
    const trend     = calcTrend(modelArray);
    const trendArr  = document.getElementById('trend-arrow');
    const trendTxt  = document.getElementById('trend-text');
    if (trend.trend === 'rising') {
        trendArr.textContent = '↑'; trendTxt.textContent = `+${trend.change.toFixed(1)}°C`;
        trendTxt.className = 'trend-rising';
    } else if (trend.trend === 'falling') {
        trendArr.textContent = '↓'; trendTxt.textContent = `${trend.change.toFixed(1)}°C`;
        trendTxt.className = 'trend-falling';
    } else {
        trendArr.textContent = '—'; trendTxt.textContent = 'Stabil';
        trendTxt.className = 'trend-stable';
    }

    // Quick stats
    const vis = Math.min(10, Math.round(10 / Math.max(0.1, precipitation) * 10) / 10);
    document.getElementById('visibility-stat').textContent       = `${vis} km`;
    document.getElementById('uv-stat').textContent               = getUVIndex(temp, humidity);
    document.getElementById('dewpoint-stat').textContent         = `${calcDewpoint(temp, humidity).toFixed(1)}°C`;
    document.getElementById('precipitation-prob').textContent    = `${calcPrecipProb(modelArray).toFixed(0)}%`;

    initLucide();
}

// ─── Display: Graphical Hourly Chart ─────────────────────────────────────────

function displayHourlyForecast(data, dayOffset, containerId) {
    const start = dayOffset * 24;
    const end   = start + 24;

    const times = data.hourly.time.slice(start, end);
    const temps = data.hourly.temperature_2m.slice(start, end);
    const probs = (data.hourly.precipitation_probability || []).slice(start, end);
    const codes = data.hourly.weather_code.slice(start, end);
    const winds = (data.hourly.wind_speed_10m || []).slice(start, end);

    const container = document.getElementById(containerId);
    if (!container || times.length === 0) return;

    const W       = COL_W * times.length;
    const nowHour = new Date().getHours();
    const nowIdx  = dayOffset === 0
        ? times.findIndex(t => parseInt(t.slice(11, 13)) === nowHour)
        : -1;

    // ── Temperature area chart ──
    const CHART_H = 104;
    const PAD_T   = 22, PAD_B = 6;
    const validT  = temps.filter(t => t != null && !isNaN(t));
    if (validT.length === 0) { container.innerHTML = '<p style="color:var(--text-3);font-size:0.85rem">Keine Daten</p>'; return; }
    const minT    = Math.min(...validT) - 1.5;
    const maxT    = Math.max(...validT) + 1.5;
    const rangeT  = maxT - minT || 1;
    const mapY    = t => PAD_T + (1 - ((t ?? minT) - minT) / rangeT) * (CHART_H - PAD_T - PAD_B);

    const pts = temps.map((t, i) => ({ x: i * COL_W + COL_W / 2, y: mapY(t) }));
    const curve  = smoothPath(pts);
    const area   = curve + ` L ${pts[pts.length - 1].x},${CHART_H} L ${pts[0].x},${CHART_H} Z`;
    const nowX   = nowIdx >= 0 ? pts[nowIdx].x : -1;
    const nowVLine = (x) => x >= 0
        ? `<line x1="${x}" y1="0" x2="${x}" y2="9999" stroke="rgba(245,158,11,0.2)" stroke-width="1" stroke-dasharray="3,3"/>`
        : '';

    const tempLabels = pts.map((p, i) =>
        `<text x="${p.x.toFixed(1)}" y="${(p.y - 6).toFixed(1)}" text-anchor="middle" fill="#e2e8f0" font-size="10" font-weight="600" font-family="-apple-system,system-ui,sans-serif">${Math.round(temps[i] ?? 0)}°</text>`
    ).join('');

    const tempDots = pts.map(p =>
        `<circle cx="${p.x.toFixed(1)}" cy="${p.y.toFixed(1)}" r="2.5" fill="#f59e0b"/>`
    ).join('');

    const tempSVG = `<svg width="${W}" height="${CHART_H}" style="display:block;overflow:visible">
        <defs>
            <linearGradient id="tg_${containerId}" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stop-color="#f59e0b" stop-opacity="0.2"/>
                <stop offset="100%" stop-color="#f59e0b" stop-opacity="0.01"/>
            </linearGradient>
        </defs>
        ${nowVLine(nowX)}
        <path d="${area}" fill="url(#tg_${containerId})"/>
        <path d="${curve}" fill="none" stroke="#f59e0b" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
        ${tempDots}
        ${tempLabels}
    </svg>`;

    // ── Precipitation bars ──
    const PREC_H  = 40;
    const precBars = probs.map((p, i) => {
        const prob = p ?? 0;
        if (prob === 0) return '';
        const bh   = Math.max(2, (prob / 100) * (PREC_H - 8));
        const x    = i * COL_W + 5;
        const bw   = COL_W - 10;
        const y    = PREC_H - bh;
        const opac = (0.25 + (prob / 100) * 0.5).toFixed(2);
        return `<rect x="${x}" y="${y}" width="${bw}" height="${bh}" rx="2.5" fill="rgba(96,165,250,${opac})"/>`;
    }).join('');

    const precLabels = probs.map((p, i) => {
        const prob = p ?? 0;
        if (prob < 15) return '';
        return `<text x="${(i * COL_W + COL_W / 2).toFixed(1)}" y="${PREC_H - 2}" text-anchor="middle" fill="rgba(147,197,253,0.85)" font-size="9" font-family="-apple-system,system-ui,sans-serif">${prob}%</text>`;
    }).join('');

    const precSVG = `<svg width="${W}" height="${PREC_H}" style="display:block">
        ${nowVLine(nowX)}
        ${precBars}
        ${precLabels}
    </svg>`;

    // ── Icon row ──
    const iconRow = times.map((t, i) => {
        const h      = parseInt(t.slice(11, 13));
        const isNow  = i === nowIdx;
        const isNight = h < 6 || h >= 21;
        const code   = codes[i];
        const info   = WMO[code] || { icon: 'cloud' };
        const icon   = (code === 0 && isNight) ? 'moon' : info.icon;
        return `<div class="ch-icon${isNow ? ' ch-now' : ''}" style="width:${COL_W}px"><i data-lucide="${icon}"></i></div>`;
    }).join('');

    // ── Wind row ──
    const windRow = winds.map((w, i) =>
        `<div class="ch-wind" style="width:${COL_W}px">${Math.round(w ?? 0)}</div>`
    ).join('');

    // ── Time row ──
    const timeRow = times.map((t, i) => {
        const h     = parseInt(t.slice(11, 13));
        const isNow = i === nowIdx;
        return `<div class="ch-time${isNow ? ' ch-now' : ''}" style="width:${COL_W}px">${String(h).padStart(2, '0')}</div>`;
    }).join('');

    container.innerHTML = `
    <div class="chart-legend">
        <span><span class="cl-dot" style="background:#f59e0b"></span>Temperatur</span>
        <span><span class="cl-dot" style="background:#60a5fa"></span>Niederschlag</span>
        <span><span class="cl-dot" style="background:#475569"></span>Wind km/h</span>
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

    // Scroll so current hour is visible (3rd column from left)
    if (nowIdx > 2 && dayOffset === 0) {
        const outer = container.querySelector('.chart-outer');
        if (outer) outer.scrollLeft = (nowIdx - 2) * COL_W;
    }
}

// Smooth cubic Bezier path through points
function smoothPath(pts) {
    if (!pts || pts.length < 2) return '';
    let d = `M ${pts[0].x.toFixed(1)},${pts[0].y.toFixed(1)}`;
    for (let i = 0; i < pts.length - 1; i++) {
        const dx   = pts[i + 1].x - pts[i].x;
        const cp1x = (pts[i].x     + dx * 0.4).toFixed(1);
        const cp1y = pts[i].y.toFixed(1);
        const cp2x = (pts[i + 1].x - dx * 0.4).toFixed(1);
        const cp2y = pts[i + 1].y.toFixed(1);
        d += ` C ${cp1x},${cp1y} ${cp2x},${cp2y} ${pts[i + 1].x.toFixed(1)},${pts[i + 1].y.toFixed(1)}`;
    }
    return d;
}

// ─── Display: 14-Day Forecast ─────────────────────────────────────────────────

function displayDailyForecast(data) {
    const d = data.daily;
    if (!d || !d.time) return;

    const html = d.time.map((dateStr, i) => {
        const date    = new Date(dateStr + 'T12:00:00');
        const dayName = DAY_NAMES[date.getDay()];
        const dayDate = `${date.getDate()}.${date.getMonth() + 1}.`;
        const isToday = i === 0;
        const code    = d.weather_code[i];
        const info    = WMO[code] || { icon: 'cloud' };
        const maxT    = Math.round(d.temperature_2m_max[i] ?? 0);
        const minT    = Math.round(d.temperature_2m_min[i] ?? 0);
        const prob    = d.precipitation_probability_max[i] ?? 0;

        return `
        <div class="daily-item${isToday ? ' is-today' : ''}" onclick="showDayDetail(${i})" data-day="${i}">
            <span class="d-name">${isToday ? 'Heute' : dayName}</span>
            <span class="d-date">${dayDate}</span>
            <div class="d-icon"><i data-lucide="${info.icon}"></i></div>
            <span class="d-max">${maxT}°</span>
            <span class="d-min">${minT}°</span>
            <div class="d-precip-bar-wrap"><div class="d-precip-bar" style="width:${prob}%"></div></div>
        </div>`;
    }).join('');

    const container = document.getElementById('daily-forecast');
    container.innerHTML = html;
    renderIcons(container);
}

// ─── Day Detail Drill-Down ────────────────────────────────────────────────────

function showDayDetail(dayIndex) {
    if (!cachedLongRange) return;

    document.querySelectorAll('.daily-item').forEach(el => el.classList.remove('active'));
    const clicked = document.querySelector(`.daily-item[data-day="${dayIndex}"]`);
    if (clicked) clicked.classList.add('active');

    const daily   = cachedLongRange.daily;
    const dateStr = daily.time[dayIndex];
    const date    = new Date(dateStr + 'T12:00:00');
    const maxT    = Math.round(daily.temperature_2m_max[dayIndex] ?? 0);
    const minT    = Math.round(daily.temperature_2m_min[dayIndex] ?? 0);
    const label   = dayIndex === 0 ? 'Heute'
                  : dayIndex === 1 ? 'Morgen'
                  : `${DAY_NAMES[date.getDay()]}, ${date.getDate()}.${date.getMonth() + 1}.${date.getFullYear()}`;

    document.getElementById('day-detail-title').textContent = `${label} · ${maxT}° / ${minT}°`;
    displayHourlyForecast(cachedLongRange, dayIndex, 'day-detail-hourly');

    const panel = document.getElementById('day-detail-panel');
    panel.classList.remove('hidden');
    panel.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    renderIcons(panel.querySelector('.close-btn'));
}

function closeDayDetail() {
    document.getElementById('day-detail-panel').classList.add('hidden');
    document.querySelectorAll('.daily-item').forEach(el => el.classList.remove('active'));
}

// ─── Display: Model Comparison ────────────────────────────────────────────────

function displayModelComparison(modelArray) {
    const html = modelArray.map(m => `
        <div class="model-row">
            <div>
                <div class="model-row-label">${m.label}</div>
                <div class="model-row-weight">Gewicht: <span>${Math.round(WEIGHTS[m.model] * 100)}%</span></div>
            </div>
            <div class="model-row-vals">
                <div class="model-row-temp">${m.temp.toFixed(1)}°C</div>
                <div class="model-row-wind">${m.wind.toFixed(1)} km/h</div>
            </div>
        </div>`).join('');
    document.getElementById('model-comparison').innerHTML = html;
}

// ─── Location Search ──────────────────────────────────────────────────────────

async function searchLocation(query) {
    try {
        const url = new URL('https://nominatim.openstreetmap.org/search');
        url.searchParams.set('q', query);
        url.searchParams.set('format', 'json');
        url.searchParams.set('limit', '7');
        url.searchParams.set('countrycodes', 'de,at,ch');
        const res = await fetch(url, { headers: { 'Accept-Language': 'de' } });
        showDropdown(await res.json());
    } catch (e) {
        console.error('Search error:', e);
    }
}

function showDropdown(results) {
    const dropdown = document.getElementById('location-dropdown');
    if (!results || results.length === 0) {
        dropdown.innerHTML = '<div class="dropdown-item" style="cursor:default;color:var(--text-3)">Keine Ergebnisse</div>';
        dropdown.classList.remove('hidden');
        return;
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
    fetchWeather();
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

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

function getUVIndex(temp, humidity) {
    return Math.min(11, Math.max(0, (temp - 10) / 5)).toFixed(1);
}

function calcPrecipProb(models) {
    return models.map(m => m.current.precipitation > 0 ? 80 : 20).reduce((a, b) => a + b) / models.length;
}

// ─── Auto refresh ─────────────────────────────────────────────────────────────

setInterval(() => {
    if (currentLat && currentLon) fetchWeather();
}, 10 * 60 * 1000);
