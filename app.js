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
let radarFrames      = [];
let radarFrameIdx    = 0;
let radarAnimTimer   = null;
let radarHost        = '';
let locationMarker   = null;
let baseTileLayer    = null;
let weatherGridLayer = null;
let currentLat       = null;
let currentLon       = null;
let cachedModels     = null;
let cachedLongRange  = null;
let cachedEnsemble   = null;
let cachedGridData   = null;
let installPrompt    = null;

// ─── Helper Functions ────────────────────────────────────────────────────────

function escapeHtml(text) {
    const map = {
        '&': '&amp;',
        '<': '&lt;',
        '>': '&gt;',
        '"': '&quot;',
        "'": '&#039;'
    };
    return text.replace(/[&<>"']/g, m => map[m]);
}

function loadLocationWeather(lat, lon, name = null) {
    currentLat = lat;
    currentLon = lon;
    map.setView([lat, lon], 10);
    updateLocationDisplay(lat, lon, name);
    fetchWeather();
}

// ─── PWA Install ─────────────────────────────────────────────────────────────

window.addEventListener('beforeinstallprompt', e => {
    e.preventDefault();
    installPrompt = e;
    if (!isStandalone()) showInstallBanner('android');
});
window.addEventListener('appinstalled', hideInstallBanner);

function isStandalone() {
    return window.matchMedia('(display-mode: standalone)').matches || !!navigator.standalone;
}

function showInstallBanner(mode) {
    if (isStandalone()) return;
    const banner = document.getElementById('install-banner');
    if (!banner) return;
    if (mode === 'ios') {
        document.getElementById('ib-subtitle').textContent = 'Tippe Teilen → „Zum Home-Bildschirm"';
        document.getElementById('install-btn').style.display = 'none';
    }
    banner.classList.remove('hidden');
    renderIcons(banner);
}

function hideInstallBanner() {
    document.getElementById('install-banner')?.classList.add('hidden');
}

// ─── Init ────────────────────────────────────────────────────────────────────

document.addEventListener('DOMContentLoaded', () => {
    initLucide();
    initMap();
    // Initialize settings early to load last location
    if (!settingsManager) {
        settingsManager = new SettingsManager();
    }
    getGeolocation();
    setupEventListeners();
    const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent) && !window.MSStream;
    if (isIOS && !isStandalone()) showInstallBanner('ios');
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
    const isDark = (localStorage.getItem('weather_theme') || 'dark') === 'dark';
    baseTileLayer = L.tileLayer(
        isDark
            ? 'https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}.png'
            : 'https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png',
        { attribution: '© OpenStreetMap © CARTO', subdomains: 'abcd', maxZoom: 18 }
    ).addTo(map);
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
    // Try to load last location from settings
    if (settingsManager) {
        const lastLoc = settingsManager.loadLastLocation();
        if (lastLoc) {
            currentLat = lastLoc.lat;
            currentLon = lastLoc.lon;
            updateLocationDisplay(currentLat, currentLon, lastLoc.name || null);
            fetchWeather();
            return;
        }
    }
    
    // Use default location
    currentLat = 51.165; currentLon = 10.451;
    updateLocationDisplay(currentLat, currentLon);
    fetchWeather();
}

function updateLocationDisplay(lat, lon, displayName = null) {
    document.getElementById('location-coords').textContent = `${lat.toFixed(2)}°N, ${lon.toFixed(2)}°E`;
    const regionName = displayName ?? resolveRegion(lat, lon);
    document.getElementById('current-location').textContent = regionName;
    if (settingsManager) {
        settingsManager.saveLastLocation(regionName, lat, lon);
        settingsManager.updateFavoriteButton();
    }
    updateLocationMarker(lat, lon);
}

function updateLocationMarker(lat, lon) {
    if (locationMarker) { locationMarker.remove(); locationMarker = null; }
    locationMarker = L.marker([lat, lon], {
        icon: L.divIcon({
            className: 'location-marker',
            html: '<div class="loc-dot"></div>',
            iconSize: [16, 16],
            iconAnchor: [8, 8]
        }),
        zIndexOffset: 1000
    }).addTo(map);
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
            resetRadar();
        }
    });

    document.getElementById('radar-opacity').addEventListener('input', e => {
        document.getElementById('opacity-value').textContent = e.target.value;
        if (radarLayer) radarLayer.setOpacity(e.target.value / 100);
    });

    // Radar player controls
    document.getElementById('radar-prev')?.addEventListener('click', () => { pauseRadar(); showRadarFrame(radarFrameIdx - 1); });
    document.getElementById('radar-next')?.addEventListener('click', () => { pauseRadar(); showRadarFrame(radarFrameIdx + 1); });
    document.getElementById('radar-play')?.addEventListener('click', () => { if (radarAnimTimer) pauseRadar(); else playRadar(); });
    document.getElementById('radar-frame-slider')?.addEventListener('input', e => { pauseRadar(); showRadarFrame(parseInt(e.target.value)); });

    // Temperatur & Wind Overlay
    document.getElementById('overlay-toggle').addEventListener('change', async e => {
        const legend = document.getElementById('temp-legend');
        if (e.target.checked) {
            legend.classList.remove('hidden');
            if (!map.getContainer().querySelector('.weather-canvas')) {
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

    // PWA install
    document.getElementById('install-btn')?.addEventListener('click', async () => {
        if (!installPrompt) return;
        installPrompt.prompt();
        const { outcome } = await installPrompt.userChoice;
        installPrompt = null;
        if (outcome === 'accepted') hideInstallBanner();
    });
    document.getElementById('install-dismiss')?.addEventListener('click', hideInstallBanner);
}

// ─── Radar (RainViewer – animiert) ───────────────────────────────────────────

async function initRadar() {
    if (radarFrames.length > 0) { showRadarFrame(radarFrameIdx); return; }
    try {
        const res  = await fetch('https://api.rainviewer.com/public/weather-maps.json');
        const data = await res.json();
        radarHost = data.host;
        const past    = (data.radar?.past    || []).map(f => ({ ...f, type: 'past' }));
        const nowcast = (data.radar?.nowcast || []).slice(0, 3).map(f => ({ ...f, type: 'nowcast' }));
        radarFrames = [...past, ...nowcast];
        if (!radarFrames.length) throw new Error('No frames');

        radarFrameIdx = past.length - 1;  // start at latest past frame
        showRadarFrame(radarFrameIdx);

        const slider = document.getElementById('radar-frame-slider');
        if (slider) { slider.max = radarFrames.length - 1; slider.value = radarFrameIdx; }
        document.getElementById('radar-player')?.classList.remove('hidden');
    } catch (e) {
        console.error('Radar failed:', e);
        document.getElementById('radar-toggle').checked = false;
        document.getElementById('opacity-control').classList.add('hidden');
    }
}

function showRadarFrame(idx) {
    if (!radarFrames.length) return;
    radarFrameIdx = Math.max(0, Math.min(idx, radarFrames.length - 1));
    const frame   = radarFrames[radarFrameIdx];
    const opacity = (document.getElementById('radar-opacity')?.value ?? 70) / 100;
    const tileUrl = `${radarHost}${frame.path}/256/{z}/{x}/{y}/2/1_1.png`;

    if (radarLayer) {
        radarLayer.setUrl(tileUrl);
    } else {
        radarLayer = L.tileLayer(tileUrl, { opacity, attribution: 'RainViewer', tileSize: 256, zIndex: 10 });
        radarLayer.addTo(map);
    }

    const slider = document.getElementById('radar-frame-slider');
    if (slider) slider.value = radarFrameIdx;

    const timeEl = document.getElementById('radar-time-label');
    if (timeEl) {
        const d = new Date(frame.time * 1000);
        const str = d.toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' });
        if (frame.type === 'nowcast') {
            timeEl.textContent = `${str} +`;
            timeEl.style.color = 'var(--accent)';
        } else {
            timeEl.textContent = str;
            timeEl.style.color = 'var(--text-2)';
        }
    }
}

function playRadar() {
    if (radarAnimTimer) return;
    const playBtn = document.getElementById('radar-play');
    if (playBtn) { playBtn.dataset.playing = 'true'; playBtn.innerHTML = '<i data-lucide="pause"></i>'; renderIcons(playBtn); }
    radarAnimTimer = setInterval(() => showRadarFrame((radarFrameIdx + 1) % radarFrames.length), 600);
}

function pauseRadar() {
    clearInterval(radarAnimTimer);
    radarAnimTimer = null;
    const playBtn = document.getElementById('radar-play');
    if (playBtn) { delete playBtn.dataset.playing; playBtn.innerHTML = '<i data-lucide="play"></i>'; renderIcons(playBtn); }
}

function resetRadar() {
    pauseRadar();
    if (radarLayer) { radarLayer.remove(); radarLayer = null; }
    radarFrames = [];
    radarFrameIdx = 0;
    document.getElementById('radar-player')?.classList.add('hidden');
}

// ─── Progressives Laden ───────────────────────────────────────────────────────

async function fetchWeather() {
    try {
        const [models, longRange] = await Promise.all([
            fetchAllModels(),
            fetchLongRange()
        ]);
        cachedModels    = models;
        cachedLongRange = longRange;

        const modelArr = Object.values(models);
        const merged   = mergeModels(modelArr);

        displayWeather(merged, modelArr);
        displayPrecipitationAnalysis(longRange, null, 0);
        displayHourlyForecast(longRange, 0, 'hourly-forecast', null, null);
        displayDailyForecast(longRange, null);
        displayModelComparison(modelArr);

        document.getElementById('update-time').textContent =
            new Date().toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' });

        Promise.all([
            fetchEnsembleHourly(),
            fetchWeatherGrid(),
            fetchDailyEnsemble()
        ]).then(([ensemble, gridData, dailyEns]) => {
            cachedEnsemble = ensemble;
            if (gridData) cachedGridData = gridData;

            if (ensemble) {
                displayHourlyForecast(longRange, 0, 'hourly-forecast', ensemble, null);
                displayPrecipitationAnalysis(longRange, ensemble, 0);
            }
            if (dailyEns)  displayDailyForecast(longRange, dailyEns);
            if (gridData && weatherGridLayer) weatherGridLayer.setData(gridData);
        }).catch(e => console.warn('Tier-2 fetch failed:', e));

    } catch (err) {
        console.error(err);
        document.querySelector('.hero-card').innerHTML =
            `<p class="error-msg">Fehler beim Laden. Bitte erneut versuchen.</p>`;
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

async function fetchModel(model, label) {
    const url = new URL('https://api.open-meteo.com/v1/forecast');
    url.searchParams.set('latitude',      currentLat);
    url.searchParams.set('longitude',     currentLon);
    url.searchParams.set('current',
        'temperature_2m,relative_humidity_2m,precipitation,weather_code,wind_speed_10m,apparent_temperature,surface_pressure');
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

async function fetchLongRange() {
    const url = new URL('https://api.open-meteo.com/v1/forecast');
    url.searchParams.set('latitude',  currentLat);
    url.searchParams.set('longitude', currentLon);
    url.searchParams.set('hourly',
        'temperature_2m,precipitation_probability,precipitation,weather_code,wind_speed_10m');
    url.searchParams.set('daily', [
        'temperature_2m_max', 'temperature_2m_min', 'precipitation_sum',
        'weather_code', 'wind_speed_10m_max', 'precipitation_probability_max',
        'sunrise', 'sunset'
    ].join(','));
    url.searchParams.set('timezone',      'Europe/Berlin');
    url.searchParams.set('forecast_days', '14');
    const res = await fetch(url);
    if (!res.ok) throw new Error('Long-range failed');
    return await res.json();
}

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
    url.searchParams.set('hourly',        'temperature_2m,wind_speed_10m,precipitation_probability,precipitation');
    url.searchParams.set('models',        model);
    url.searchParams.set('timezone',      'Europe/Berlin');
    url.searchParams.set('forecast_days', '2');
    const res = await fetch(url);
    if (!res.ok) throw new Error(`Hourly ${model} failed`);
    return await res.json();
}

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

async function fetchWeatherGrid() {
    const STEP = 0.55, HALF = 2;
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
    const w = { temp: 0, humidity: 0, precipitation: 0, wind: 0, apparentTemp: 0, pressure: 0 };
    arr.forEach(m => {
        const wt = WEIGHTS[m.model] || 0;
        w.temp          += m.temp          * wt;
        w.humidity      += m.humidity      * wt;
        w.precipitation += m.precipitation * wt;
        w.wind          += m.wind          * wt;
        w.apparentTemp  += (m.current?.apparent_temperature ?? m.temp) * wt;
        w.pressure      += (m.current?.surface_pressure ?? 1013) * wt;
    });
    const temps   = arr.map(m => m.temp);
    const winds   = arr.map(m => m.wind);
    const tempVar = temps.reduce((s, t) => s + Math.abs(t - w.temp), 0) / temps.length;
    const windVar = winds.reduce((s, v) => s + Math.abs(v - w.wind), 0) / winds.length;
    const confidence = Math.round(Math.max(0, Math.min(100, 100 - (tempVar + windVar) / 2 / 15 * 100)));
    return {
        temp: Math.round(w.temp * 10) / 10, humidity: Math.round(w.humidity),
        precipitation: Math.round(w.precipitation * 10) / 10, wind: Math.round(w.wind),
        apparentTemp: Math.round(w.apparentTemp * 10) / 10,
        pressure: Math.round(w.pressure),
        confidence, models: arr,
        tempRange: { min: Math.min(...temps), max: Math.max(...temps) }
    };
}

// ─── Display: Aktuelles Wetter ────────────────────────────────────────────────

function displayWeather(data, modelArray) {
    const { temp, humidity, precipitation, wind, confidence, tempRange, apparentTemp, pressure } = data;
    document.getElementById('temp-display').textContent          = `${temp}°`;
    document.getElementById('temp-range').textContent            = `${Math.round(tempRange.min)}° – ${Math.round(tempRange.max)}°C`;
    document.getElementById('feels-like').textContent            = `${apparentTemp ?? Math.round(temp)}°`;
    document.getElementById('humidity-display').textContent      = `${humidity}%`;
    document.getElementById('precipitation-display').textContent = `${precipitation} mm`;
    document.getElementById('wind-display').textContent          = `${wind} km/h`;
    document.getElementById('pressure-stat').textContent         = `${pressure ?? 1013} hPa`;

    const precipProb = getCurrentPrecipProb();
    document.getElementById('precipitation-prob').textContent =
        precipProb !== null ? `${Math.round(precipProb)}%` : '--';

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
    document.getElementById('visibility-stat').textContent = `${vis} km`;
    document.getElementById('dewpoint-stat').textContent   = `${calcDewpoint(temp, humidity).toFixed(1)}°C`;
    initLucide();
}

// ─── Display: Regen-Detail ────────────────────────────────────────────────────

function displayRainDetail(longRange) {
    const card = document.getElementById('rain-detail-card');
    if (!card || !longRange?.hourly) return;

    const nowHour = new Date().getHours();
    const probs   = longRange.hourly.precipitation_probability?.slice(0, 24) || [];
    const precips = longRange.hourly.precipitation?.slice(0, 24) || [];
    const codes   = longRange.hourly.weather_code?.slice(0, 24) || [];

    const currentProb = probs[nowHour] ?? 0;
    const currentCode = codes[nowHour] ?? 0;
    const precipType  = (currentCode >= 71 && currentCode <= 77) ? 'Schnee'
                      : (currentCode >= 80 && currentCode <= 86) ? 'Schauer'
                      : currentCode >= 51 ? 'Regen' : 'Niederschlag';

    let nextRainLabel = 'Kein Regen erwartet';
    for (let i = nowHour + 1; i < 24; i++) {
        if ((probs[i] ?? 0) >= 40) {
            nextRainLabel = `ab ${String(i).padStart(2, '0')}:00 Uhr`;
            break;
        }
    }

    const totalToday = precips.reduce((s, v) => s + (v ?? 0), 0);

    const statusText = currentProb >= 60
        ? `${precipType} wahrscheinlich · ${currentProb}%`
        : currentProb >= 30
        ? `${precipType} möglich · ${currentProb}%`
        : currentProb > 0
        ? `Kaum ${precipType} · ${currentProb}%`
        : 'Kein Niederschlag erwartet';

    // 24-Balken SVG-Chart (12px pro Stunde)
    const BAR_W = 12, GAP = 2, BAR_H = 48, LABEL_H = 14;
    const TOTAL_W = 24 * (BAR_W + GAP) - GAP;
    const nowLineX = nowHour * (BAR_W + GAP) + BAR_W / 2;

    const nowLine = `<line x1="${nowLineX.toFixed(1)}" y1="0" x2="${nowLineX.toFixed(1)}" y2="${BAR_H}"
        stroke="rgba(245,158,11,0.45)" stroke-width="1.5" stroke-dasharray="3,2"/>`;

    const bars = probs.map((p, i) => {
        const prob  = p ?? 0;
        const bh    = prob === 0 ? 2 : Math.max(3, (prob / 100) * (BAR_H - 6));
        const x     = i * (BAR_W + GAP);
        const isNow = i === nowHour;
        const opac  = (0.2 + (prob / 100) * 0.65).toFixed(2);
        const fill  = isNow ? 'rgba(245,158,11,0.85)' : `rgba(96,165,250,${opac})`;
        const rx    = bh <= 2 ? 0 : 2;
        return `<rect x="${x}" y="${BAR_H - bh}" width="${BAR_W}" height="${bh}" rx="${rx}" fill="${fill}"/>`;
    }).join('');

    const hourLabels = [0, 6, 12, 18].map(h => {
        const x = h * (BAR_W + GAP);
        return `<text x="${x}" y="${BAR_H + LABEL_H - 1}" text-anchor="start"
            fill="rgba(148,163,184,0.7)" font-size="9">${String(h).padStart(2, '0')}</text>`;
    }).join('');

    document.getElementById('rain-status-line').textContent = statusText;
    document.getElementById('rain-prob-bars').innerHTML = `<svg width="${TOTAL_W}" height="${BAR_H + LABEL_H}"
        style="display:block;overflow:visible;font-family:-apple-system,system-ui,sans-serif">
        ${nowLine}${bars}${hourLabels}</svg>`;
    document.getElementById('rain-total-today').textContent = `${totalToday.toFixed(1)} mm`;
    document.getElementById('rain-next-label').textContent  = nextRainLabel;
}

// ─── Precipitation Analysis Widget ───────────────────────────────────────────

function displayPrecipitationAnalysis(data, ensemble, dayOffset = 0) {
    const widget = document.getElementById('precipitation-analysis-widget');
    if (!widget) return;

    const showWidget = settingsManager?.displayDetails?.shows_weather_report ?? true;
    widget.style.display = showWidget ? '' : 'none';
    if (!showWidget || !data?.hourly) return;

    // Update widget title to reflect selected day
    const titleEl = widget.querySelector('.precipitation-analysis-title span');
    if (titleEl) {
        if (dayOffset === 0) {
            titleEl.textContent = 'Niederschlag & Wetter heute';
        } else if (dayOffset === 1) {
            titleEl.textContent = 'Niederschlag & Wetter morgen';
        } else {
            const d = new Date();
            d.setDate(d.getDate() + dayOffset);
            const label = d.toLocaleDateString('de-DE', { weekday: 'long', day: 'numeric', month: 'short' });
            titleEl.textContent = `Niederschlag & Wetter – ${label}`;
        }
    }

    const start = dayOffset * 24;
    const end = start + 24;
    const nowHour = dayOffset === 0 ? new Date().getHours() : -1;

    const times  = (data.hourly.time ?? []).slice(start, end);
    const temps  = (data.hourly.temperature_2m ?? []).slice(start, end);
    const precips = (data.hourly.precipitation ?? []).slice(start, end);
    const probs  = (data.hourly.precipitation_probability ?? []).slice(start, end);
    const winds  = (data.hourly.wind_speed_10m ?? []).slice(start, end);

    // Per-model ensemble data
    const MODEL_COLORS = { icon: '#60a5fa', ecmwf: '#34d399', gfs: '#c084fc' };
    const MODEL_LABELS = { icon: 'ICON-D2', ecmwf: 'ECMWF', gfs: 'GFS' };
    const enData = ensemble ? Object.entries(ensemble)
        .filter(([, m]) => m?.hourly?.precipitation_probability)
        .map(([key, m]) => ({
            key,
            label: MODEL_LABELS[key] ?? key.toUpperCase(),
            color: MODEL_COLORS[key] ?? '#94a3b8',
            probs:  (m.hourly.precipitation_probability ?? []).slice(start, end),
            precips: (m.hourly.precipitation ?? []).slice(start, end)
        })) : [];

    // Per-hour spread across models
    const hourSpread = Array.from({ length: 24 }, (_, i) => {
        const vals = enData.map(e => e.probs[i] ?? 0);
        if (vals.length < 2) return { min: probs[i] ?? 0, max: probs[i] ?? 0, spread: 0 };
        return { min: Math.min(...vals), max: Math.max(...vals), spread: Math.max(...vals) - Math.min(...vals) };
    });

    // Summary stats
    const totalPrecip = precips.reduce((a, b) => (a || 0) + (b || 0), 0);
    const maxProb = Math.max(...probs.filter(p => p != null), 0);
    const maxRain = Math.max(...precips.filter(p => p != null), 0);
    let rainModels = 0;
    enData.forEach(e => { if (e.precips.some(p => (p || 0) > 0.1)) rainModels++; });
    const totalModels = enData.length;
    const consensusPercent = totalModels > 0 ? Math.max(rainModels, totalModels - rainModels) / totalModels * 100 : 0;

    let intensityLabel = 'Kein Regen';
    if (maxRain > 5) intensityLabel = 'Starkregen';
    else if (maxRain > 2) intensityLabel = 'Kräftig';
    else if (maxRain > 0.5) intensityLabel = 'Moderat';
    else if (maxRain > 0.1) intensityLabel = 'Leicht';

    document.getElementById('analysis-total-precip').textContent = `${totalPrecip.toFixed(1)} mm`;
    document.getElementById('analysis-rain-prob').textContent = `${Math.round(maxProb)}%`;
    document.getElementById('analysis-consensus').textContent = totalModels > 0 ? `${Math.round(consensusPercent)}%` : '--';
    document.getElementById('analysis-intensity').textContent = intensityLabel;

    const content = document.getElementById('precipitation-analysis-content');
    if (!content) return;

    // SVG layout constants
    const W = 640, H = 120, PL = 28, PR = 8, PT = 8, PB = 20;
    const cW = W - PL - PR;
    const bW = cW / 24;

    // --- Chart 1: Probability bars + model lines + spread band ---
    let svgBars = '', svgSpread = '', svgLines = '', svgXAxis = '', svgYAxis = '', svgNow = '';

    for (let i = 0; i < 24; i++) {
        const p = probs[i] ?? 0;
        const x = PL + i * bW;
        const bh = (p / 100) * (H - PT - PB);
        const y = H - PB - bh;
        const col = p >= 60 ? '#3b82f6' : p >= 30 ? '#60a5fa' : '#93c5fd';
        if (i === nowHour) {
            svgBars += `<rect x="${x+1}" y="${PT}" width="${bW-2}" height="${H-PT-PB}" rx="2" fill="rgba(245,158,11,0.1)"/>`;
        }
        svgBars += `<rect x="${x+1}" y="${y}" width="${bW-2}" height="${bh || 2}" rx="2" fill="${col}" opacity="${i === nowHour ? 1 : 0.7}"/>`;
    }

    if (enData.length >= 2) {
        const topPts = [], botPts = [];
        for (let i = 0; i < 24; i++) {
            const cx = PL + (i + 0.5) * bW;
            topPts.push([cx, H - PB - (hourSpread[i].max / 100) * (H - PT - PB)]);
            botPts.push([cx, H - PB - (hourSpread[i].min / 100) * (H - PT - PB)]);
        }
        const topD = topPts.map((p, i) => `${i === 0 ? 'M' : 'L'}${p[0].toFixed(1)},${p[1].toFixed(1)}`).join(' ');
        const botD = [...botPts].reverse().map(p => `L${p[0].toFixed(1)},${p[1].toFixed(1)}`).join(' ');
        svgSpread = `<path d="${topD} ${botD} Z" fill="rgba(148,163,184,0.18)"/>`;

        enData.forEach(e => {
            const pts = e.probs.map((p, i) =>
                `${(PL + (i + 0.5) * bW).toFixed(1)},${(H - PB - ((p ?? 0) / 100) * (H - PT - PB)).toFixed(1)}`
            ).join(' ');
            svgLines += `<polyline points="${pts}" fill="none" stroke="${e.color}" stroke-width="1.5" stroke-linecap="round" opacity="0.9"/>`;
        });
    }

    for (let v of [0, 50, 100]) {
        const y = H - PB - (v / 100) * (H - PT - PB);
        svgYAxis += `<text x="${PL-3}" y="${y+3}" text-anchor="end" fill="var(--text-3)" font-size="9">${v}%</text>`;
        svgYAxis += `<line x1="${PL}" y1="${y}" x2="${W-PR}" y2="${y}" stroke="var(--card-b)" stroke-width="0.5"/>`;
    }
    for (let i = 0; i < 24; i += 4) {
        const x = PL + (i + 0.5) * bW;
        const h = times[i] ? parseInt(times[i].slice(11, 13)) : i;
        svgXAxis += `<text x="${x.toFixed(1)}" y="${H-4}" text-anchor="middle" fill="var(--text-3)" font-size="9">${String(h).padStart(2,'0')}</text>`;
    }
    if (nowHour >= 0) {
        const nx = PL + (nowHour + 0.5) * bW;
        svgNow = `<line x1="${nx.toFixed(1)}" y1="${PT}" x2="${nx.toFixed(1)}" y2="${H-PB}" stroke="var(--accent)" stroke-width="1.5" stroke-dasharray="3,2" opacity="0.8"/>`;
    }
    const probSVG = `<svg viewBox="0 0 ${W} ${H}" width="100%" height="${H}" style="overflow:visible;font-family:-apple-system,system-ui,sans-serif">${svgYAxis}${svgSpread}${svgBars}${svgLines}${svgXAxis}${svgNow}</svg>`;

    // --- Chart 2: Divergence bars ---
    let divBars = '', divX = '';
    const maxSpread = Math.max(...hourSpread.map(s => s.spread), 1);
    for (let i = 0; i < 24; i++) {
        const s = hourSpread[i].spread;
        const x = PL + i * bW;
        const bh = Math.max(2, (s / maxSpread) * 44);
        const col = s > 25 ? '#f87171' : s > 12 ? '#fb923c' : '#4ade80';
        divBars += `<rect x="${x+1}" y="${56-bh}" width="${bW-2}" height="${bh}" rx="1" fill="${col}" opacity="0.85"/>`;
    }
    for (let i = 0; i < 24; i += 4) {
        const x = PL + (i + 0.5) * bW;
        const h = times[i] ? parseInt(times[i].slice(11, 13)) : i;
        divX += `<text x="${x.toFixed(1)}" y="70" text-anchor="middle" fill="var(--text-3)" font-size="9">${String(h).padStart(2,'0')}</text>`;
    }
    const divNow = nowHour >= 0 ? `<line x1="${(PL+(nowHour+0.5)*bW).toFixed(1)}" y1="10" x2="${(PL+(nowHour+0.5)*bW).toFixed(1)}" y2="56" stroke="var(--accent)" stroke-width="1.5" stroke-dasharray="3,2" opacity="0.8"/>` : '';
    const divSVG = `<svg viewBox="0 0 ${W} 74" width="100%" height="74" style="overflow:visible;font-family:-apple-system,system-ui,sans-serif"><text x="${PL-3}" y="59" text-anchor="end" fill="var(--text-3)" font-size="9">0%</text><line x1="${PL}" y1="56" x2="${W-PR}" y2="56" stroke="var(--card-b)" stroke-width="0.5"/>${divBars}${divX}${divNow}</svg>`;

    // --- Model comparison table ---
    let modelRows = enData.length > 0
        ? enData.map(e => {
            const maxP = Math.max(...e.probs.filter(p => p != null), 0);
            const tot = e.precips.reduce((a, b) => (a||0)+(b||0), 0);
            return `<div class="pa-model-row">
                <div class="pa-model-name" style="color:${e.color}">${e.label}</div>
                <div class="pa-model-bar-wrap"><div class="pa-model-bar" style="width:${Math.round(maxP)}%;background:${e.color}"></div></div>
                <div class="pa-model-pct">${Math.round(maxP)}%</div>
                <div class="pa-model-total">${tot.toFixed(1)} mm</div>
            </div>`;
        }).join('')
        : '<div style="color:var(--text-3);font-size:0.8rem">Ensemble-Daten werden geladen…</div>';

    // --- Rain periods ---
    let periods = [], inR = false, rS = 0;
    for (let i = 0; i < 24; i++) {
        const rainy = (probs[i] ?? 0) >= 40;
        if (rainy && !inR) { inR = true; rS = i; }
        else if (!rainy && inR) { inR = false; periods.push([rS, i - 1]); }
    }
    if (inR) periods.push([rS, 23]);

    let periodsHTML = periods.length === 0
        ? '<span style="color:var(--text-3);font-size:0.85rem">Kein Regen mit ≥40% Wahrscheinlichkeit erwartet</span>'
        : periods.map(([s, e]) => {
            const sH = times[s] ? parseInt(times[s].slice(11, 13)) : s;
            const eH = times[e] ? parseInt(times[e].slice(11, 13)) : e;
            const maxP = Math.max(...probs.slice(s, e+1).filter(p => p != null), 0);
            const avgPr = precips.slice(s, e+1).reduce((a,b)=>(a||0)+(b||0),0)/(e-s+1);
            const intens = avgPr > 2 ? 'stark' : avgPr > 0.5 ? 'mittel' : 'schwach';
            return `<div class="pa-rain-period">
                <span class="pa-period-time">${String(sH).padStart(2,'0')}:00 – ${String(eH).padStart(2,'0')}:59</span>
                <span class="pa-period-prob">${Math.round(maxP)}%</span>
                <span class="pa-period-intens">${intens}</span>
            </div>`;
        }).join('');

    // --- Spatial grid (current weather codes from 5×5 grid) ---
    const RAIN_CODES = new Set([51,53,55,61,63,65,71,73,75,77,80,81,82,85,86,95,96,99]);
    let spatialHTML = '';
    if (cachedGridData && cachedGridData.length > 0) {
        const sorted = [...cachedGridData].sort((a, b) => b.lat - a.lat || a.lon - b.lon);
        let rainCount = 0;
        const dots = sorted.map(pt => {
            const hasRain = RAIN_CODES.has(pt.code ?? 0);
            if (hasRain) rainCount++;
            return `<div class="pa-dot ${hasRain ? 'pa-dot-rain' : 'pa-dot-dry'}" title="Wetterkode ${pt.code ?? 0}"></div>`;
        }).join('');
        const pct = Math.round(rainCount / sorted.length * 100);
        spatialHTML = `<div class="pa-spatial-grid">${dots}</div>
            <div class="pa-spatial-label">${pct}% der umliegenden Fläche (${rainCount}/${sorted.length} Messpunkte) mit Niederschlag</div>`;
    } else {
        spatialHTML = '<div style="color:var(--text-3);font-size:0.8rem">Räumliche Daten werden geladen…</div>';
    }

    // --- Legend ---
    const legendHTML = enData.length >= 2 ? `<div class="pa-legend">
        ${enData.map(e => `<div class="pa-leg-item"><div class="pa-leg-dot" style="background:${e.color}"></div>${e.label}</div>`).join('')}
        <div class="pa-leg-item"><div class="pa-leg-spread-box"></div>Unsicherheit</div>
    </div>` : '';

    // --- Assemble ---
    const validTemps = temps.filter(t => t != null);
    const maxWind = Math.max(...winds.filter(w => w != null), 0);
    const windDesc = maxWind > 40 ? 'stürmisch' : maxWind > 25 ? 'windig' : maxWind > 10 ? 'mäßig' : 'schwach';

    content.innerHTML = `<div class="pa-inner">
        <div class="pa-section">
            <div class="pa-section-header">
                <span class="pa-section-title">Wahrscheinlichkeit nach Modell</span>
                ${legendHTML}
            </div>
            ${probSVG}
        </div>
        ${enData.length >= 2 ? `
        <div class="pa-section">
            <div class="pa-section-header">
                <span class="pa-section-title">Modell-Divergenz</span>
                <span class="pa-section-sub">
                    <span style="color:#4ade80">●</span> &lt;12%
                    <span style="color:#fb923c">●</span> 12–25%
                    <span style="color:#f87171">●</span> &gt;25%
                </span>
            </div>
            ${divSVG}
        </div>
        <div class="pa-section">
            <div class="pa-section-header"><span class="pa-section-title">Modell-Vergleich</span></div>
            <div class="pa-model-table">${modelRows}</div>
        </div>` : ''}
        <div class="pa-section">
            <div class="pa-section-header"><span class="pa-section-title">Regenperioden ≥ 40%</span></div>
            <div class="pa-rain-periods">${periodsHTML}</div>
        </div>
        <div class="pa-section">
            <div class="pa-section-header"><span class="pa-section-title">Räumliche Verteilung (aktuell)</span></div>
            <div class="pa-spatial">${spatialHTML}</div>
        </div>
        <div class="pa-section">
            <div class="pa-section-header"><span class="pa-section-title">Weitere Details</span></div>
            <div class="pa-extra-grid">
                <div class="pa-extra-row"><span class="pa-extra-label">Temperaturspanne</span><span class="pa-extra-val">${validTemps.length ? Math.min(...validTemps).toFixed(0) : '--'}–${validTemps.length ? Math.max(...validTemps).toFixed(0) : '--'}°C</span></div>
                <div class="pa-extra-row"><span class="pa-extra-label">Wind max.</span><span class="pa-extra-val">${maxWind.toFixed(0)} km/h (${windDesc})</span></div>
            </div>
        </div>
    </div>`;

    const toggleBtn = document.getElementById('precipitation-analysis-toggle');
    if (toggleBtn && !toggleBtn.dataset.listenerSet) {
        toggleBtn.addEventListener('click', e => {
            e.stopPropagation();
            widget.classList.toggle('expanded');
        });
        toggleBtn.dataset.listenerSet = 'true';
    }
    if (typeof lucide !== 'undefined') lucide.createIcons({ nodes: [widget] });
}

// ─── Display: Niederschlags-Widget ────────────────────────────────────────────

function displayPrecipitationWidget(data, dayOffset = 0, dayCount = 12) {
    const widget = document.getElementById('precipitation-widget');
    if (!widget) return;

    // Check if widget is enabled in settings
    const showWidget = settingsManager?.displayDetails?.shows_precipitation_widget ?? true;
    widget.style.display = showWidget ? '' : 'none';

    if (!showWidget || !data?.hourly) return;

    const start = dayOffset * 24;
    const end = Math.min(start + dayCount, (data.hourly.precipitation ?? []).length);
    
    const precips = (data.hourly.precipitation ?? []).slice(start, end);
    const probs = (data.hourly.precipitation_probability ?? []).slice(start, end);
    const times = (data.hourly.time ?? []).slice(start, end);

    // Berechne Summe und Max
    const totalPrecip = precips.reduce((sum, p) => sum + (p ?? 0), 0);
    const maxProb = Math.max(...(probs.map(p => p ?? 0)));

    // Update Header Stats
    document.getElementById('precip-total').textContent = `${totalPrecip.toFixed(1)} mm`;
    document.getElementById('precip-risk').textContent = `${Math.round(maxProb)}%`;

    // Find max precipitation for color scaling
    const maxPrecip = Math.max(...(precips.map(p => p ?? 0)), 0.1);

    // Generate Timeline HTML
    const timelineHTML = times.map((timeStr, i) => {
        const precip = precips[i] ?? 0;
        const prob = probs[i] ?? 0;
        const hour = parseInt(timeStr.slice(11, 13));

        // Berechne Bar-Höhe proportional zu Niederschlag
        const barHeight = precip === 0 ? 4 : Math.max(4, (precip / maxPrecip) * 76);

        // Farbcodierung nach Intensität
        let rainColor = '#a7d8ed'; // 0-0.5mm hellblau
        if (precip > 0.5 && precip <= 1) rainColor = '#4ca3d4'; // hellblau
        else if (precip > 1 && precip <= 2) rainColor = '#1e88d4'; // mittelblau
        else if (precip > 2 && precip <= 5) rainColor = '#0d47a1'; // dunkelblau
        else if (precip > 5) rainColor = '#001a4d'; // sehr dunkelblau

        return `
            <div class="timeline-hour">
                <div class="timeline-hour-time">${String(hour).padStart(2, '0')}:00</div>
                <div class="rain-bar-container">
                    <div class="rain-bar" style="height: ${barHeight}px; --rain-color: ${rainColor}"></div>
                    ${precip > 0.1 ? `<div class="rain-amount">${precip.toFixed(1)}mm</div>` : ''}
                </div>
                ${prob > 0 ? `<div class="rain-prob">${Math.round(prob)}%</div>` : ''}
            </div>
        `;
    }).join('');

    const timeline = document.getElementById('precipitation-timeline');
    if (timelineHTML.trim()) {
        timeline.innerHTML = timelineHTML;
    } else {
        timeline.innerHTML = '<div class="precipitation-empty">Keine Niederschlagsdaten verfügbar</div>';
    }

    // Render Icons
    if (typeof lucide !== 'undefined') {
        lucide.createIcons({ nodes: [timeline] });
    }

    // Setup Toggle Event (nur einmal)
    const toggleBtn = document.getElementById('precipitation-toggle');
    if (toggleBtn && !toggleBtn.dataset.listenerSet) {
        toggleBtn.addEventListener('click', e => {
            e.stopPropagation();
            widget.classList.toggle('expanded');
        });
        toggleBtn.dataset.listenerSet = 'true';
    }
}

// ─── Weather Report Generator ─────────────────────────────────────────

function displayWeatherReport(data, ensemble, dayOffset = 0) {
    const widget = document.getElementById('weather-report-widget');
    const showReport = settingsManager?.displayDetails?.shows_weather_report ?? true;
    if (!widget) return;
    widget.style.display = showReport ? '' : 'none';

    const start = dayOffset * 24;
    const end   = start + 24;
    
    const times = data.hourly.time.slice(start, end);
    const temps = data.hourly.temperature_2m.slice(start, end);
    const precips = (data.hourly.precipitation || []).slice(start, end);
    const probabilities = (data.hourly.precipitation_probability || []).slice(start, end);
    const clouds = (data.hourly.cloud_cover || []).slice(start, end);
    const winds = (data.hourly.wind_speed_10m || []).slice(start, end);
    const pressure = (data.hourly.pressure_msl || []).slice(start, end);
    const codes = data.hourly.weather_code.slice(start, end);

    // Ensemble Analyse (wenn vorhanden)
    let ensembleStats = { rain: 0, snow: 0, dry: 0, total: 0 };
    if (ensemble && ensemble.length > 0) {
        ensemble.forEach(model => {
            if (model.hourly) {
                const modelPrecips = (model.hourly.precipitation || []).slice(start, end);
                const hasRain = modelPrecips.some(p => p > 0.1);
                const hasSnow = modelPrecips.some(p => p > 0.5) && temps[0] < 2;
                if (hasSnow) ensembleStats.snow++;
                else if (hasRain) ensembleStats.rain++;
                else ensembleStats.dry++;
                ensembleStats.total++;
            }
        });
    }

    // Berechne Statistiken
    const maxTemp = Math.max(...temps.filter(t => t !== null));
    const minTemp = Math.min(...temps.filter(t => t !== null));
    const avgTemp = (temps.filter(t => t !== null).reduce((a, b) => a + b, 0) / temps.filter(t => t !== null).length).toFixed(1);
    
    const totalPrecip = precips.reduce((a, b) => (a || 0) + (b || 0), 0);
    const maxCloud = Math.max(...clouds.filter(c => c !== null && c !== undefined));
    const avgWind = (winds.filter(w => w !== null).reduce((a, b) => a + b, 0) / winds.filter(w => w !== null).length).toFixed(1);
    
    // Regen-Zeitspanne
    let rainStart = null;
    let rainEnd = null;
    for (let i = 0; i < precips.length; i++) {
        if ((precips[i] || 0) > 0.1) {
            if (!rainStart) rainStart = i;
            rainEnd = i;
        }
    }

    // Baue Report zusammen
    let report = '';

    // Headline
    const dateStr = new Date(times[0]).toLocaleDateString('de-DE', { weekday: 'long', month: 'long', day: 'numeric' });
    report += `📋 WETTERBERICHT: ${dateStr.charAt(0).toUpperCase() + dateStr.slice(1)}\n`;
    report += `${'═'.repeat(50)}\n\n`;

    // Zusammenfassung
    report += `🌡️ TEMPERATUR\n`;
    report += `─ Höchst: ${maxTemp.toFixed(1)}°C\n`;
    report += `─ Tiefst: ${minTemp.toFixed(1)}°C\n`;
    report += `─ Durchschnitt: ${avgTemp}°C\n\n`;

    // Bedeckung
    report += `☁️ BEWÖLKUNG\n`;
    const cloudDesc = maxCloud > 80 ? 'Stark bewölkt' : maxCloud > 50 ? 'Teilweise bewölkt' : maxCloud > 20 ? 'Teils heiter' : 'Heiter';
    report += `─ Kondition: ${cloudDesc}\n`;
    report += `─ Max Bedeckung: ${Math.round(maxCloud)}%\n\n`;

    // Niederschlag - Ensemble Analyse
    if (ensembleStats.total > 0) {
        const rainPercent = ((ensembleStats.rain + ensembleStats.snow) / ensembleStats.total * 100).toFixed(0);
        const dryPercent = (ensembleStats.dry / ensembleStats.total * 100).toFixed(0);
        
        report += `🌧️ NIEDERSCHLAG - MODELLÜBEREINSTIMMUNG\n`;
        report += `─ Von ${ensembleStats.total} Modelläufen:\n`;
        report += `  • ${ensembleStats.dry} Läufe TROCKEN (${dryPercent}%)\n`;
        report += `  • ${ensembleStats.rain} Läufe mit REGEN (${rainPercent}%)\n`;
        if (ensembleStats.snow > 0) {
            report += `  • ${ensembleStats.snow} Läufe mit SCHNEE\n`;
        }
        report += `\n─ Bewertung: `;
        if (ensembleStats.dry / ensembleStats.total > 0.8) {
            report += 'TROCKEN - Niederschlag unwahrscheinlich\n';
        } else if (ensembleStats.dry / ensembleStats.total > 0.5) {
            report += 'ÜBERWIEGEND TROCKEN - Nur geringe Chance auf Regen\n';
        } else if (ensembleStats.rain / ensembleStats.total > 0.7) {
            report += 'REGEN WAHRSCHEINLICH - Die meisten Modelle zeigen Niederschlag\n';
        } else {
            report += 'GEMISCHT - Risiko für Niederschlag vorhanden\n';
        }
    }

    report += `\n─ Gesamtniederschlag: ${totalPrecip.toFixed(1)} mm\n`;
    
    if (rainStart !== null) {
        const rainStartTime = new Date(times[rainStart]).toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' });
        const rainEndTime = new Date(times[rainEnd]).toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' });
        const rainDuration = (rainEnd - rainStart + 1);
        report += `─ Zeitspanne: ab ${rainStartTime} bis ca. ${rainEndTime} (${rainDuration}h)\n`;
        
        // Bestimme Intensität
        const maxRain = Math.max(...precips.slice(rainStart, rainEnd + 1));
        if (maxRain > 5) {
            report += `─ Intensität: 🔴 STARKREGEN (>5 mm/h)\n`;
        } else if (maxRain > 2) {
            report += `─ Intensität: 🟠 KRÄFTIG (2-5 mm/h)\n`;
        } else if (maxRain > 0.5) {
            report += `─ Intensität: 🟡 MODERAT (0.5-2 mm/h)\n`;
        } else {
            report += `─ Intensität: 🟢 LEICHT (<0.5 mm/h)\n`;
        }
    } else {
        report += `─ Status: KEIN REGEN ERWARTET\n`;
    }

    // Wahrscheinlichkeit
    const maxProb = Math.max(...probabilities.filter(p => p !== null));
    report += `─ Max Regenwahrscheinlichkeit: ${Math.round(maxProb)}%\n\n`;

    // Wind
    report += `💨 WIND\n`;
    report += `─ Durchschnittswind: ${avgWind} km/h\n`;
    const maxWind = Math.max(...winds.filter(w => w !== null));
    report += `─ Höchstwind: ${maxWind.toFixed(1)} km/h\n`;
    const windDesc = maxWind > 40 ? '(Stürmisch)' : maxWind > 25 ? '(Windig)' : maxWind > 10 ? '(Mäßig)' : '(Schwach)';
    report += `  ${windDesc}\n\n`;

    // Luftdruck
    const avgPressure = (pressure.filter(p => p !== null).reduce((a, b) => a + b, 0) / pressure.filter(p => p !== null).length / 100).toFixed(0);
    report += `🔻 LUFTDRUCK\n`;
    report += `─ Durchschnitt: ${avgPressure} hPa\n`;
    report += `─ Status: `;
    if (avgPressure > 1020) {
        report += 'Hoch (Stabiles Wetter)\n';
    } else if (avgPressure < 1000) {
        report += 'Tief (Wechselhafte Bedingungen)\n';
    } else {
        report += 'Normal\n';
    }

    report += `\n${'═'.repeat(50)}\n`;
    report += `⏰ Aktualisiert: ${new Date().toLocaleTimeString('de-DE')}`;

    // Injiziere in HTML
    const contentDiv = document.getElementById('weather-report-text');
    if (contentDiv) {
        contentDiv.textContent = report;
    }

    // Toggle-Listener
    const toggleBtn = document.getElementById('weather-report-toggle');
    if (toggleBtn && !toggleBtn.dataset.listenerSet) {
        toggleBtn.addEventListener('click', e => {
            e.stopPropagation();
            widget.classList.toggle('expanded');
        });
        toggleBtn.dataset.listenerSet = 'true';
    }
}

// ─── Display: Grafischer Stundenchart ─────────────────────────────────────────

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

    const iconRow = times.map((t, i) => {
        const h     = parseInt(t.slice(11, 13));
        const isNow = i === nowIdx;
        const info  = WMO[codes[i]] || { icon: 'cloud' };
        const icon  = (codes[i] === 0 && (h < 6 || h >= 21)) ? 'moon' : info.icon;
        return `<div class="ch-icon${isNow ? ' ch-now' : ''}" style="width:${COL_W}px"><i data-lucide="${icon}"></i></div>`;
    }).join('');

    const windRow = winds.map((w, i) =>
        `<div class="ch-wind" style="width:${COL_W}px">${Math.round(w ?? 0)}</div>`
    ).join('');

    const timeRow = times.map((t, i) => {
        const h     = parseInt(t.slice(11, 13));
        const isNow = i === nowIdx;
        return `<div class="ch-time${isNow ? ' ch-now' : ''}" style="width:${COL_W}px">${String(h).padStart(2, '0')}</div>`;
    }).join('');

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

function buildSpreadBand(topPts, botPts) {
    const n = Math.min(topPts.length, botPts.length);
    if (n < 2) return '';
    const tp = topPts.slice(0, n), bp = botPts.slice(0, n);

    let d = `M ${tp[0].x.toFixed(1)},${tp[0].y.toFixed(1)}`;
    for (let i = 0; i < n - 1; i++) d += cubicSeg(tp[i], tp[i+1]);
    d += ` L ${bp[n-1].x.toFixed(1)},${bp[n-1].y.toFixed(1)}`;
    for (let i = n - 1; i > 0; i--) d += cubicSeg(bp[i], bp[i-1]);
    return `<path d="${d} Z" fill="rgba(245,158,11,0.12)" stroke="rgba(245,158,11,0.22)" stroke-width="0.5"/>`;
}

function cubicSeg(p0, p1) {
    const dx = p1.x - p0.x;
    return ` C ${(p0.x + dx*0.4).toFixed(1)},${p0.y.toFixed(1)} ${(p1.x - dx*0.4).toFixed(1)},${p1.y.toFixed(1)} ${p1.x.toFixed(1)},${p1.y.toFixed(1)}`;
}

// ─── Display: 14-Tage-Vorschau ────────────────────────────────────────────────

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

        let spreadHtml = '';
        if (dailyEns) {
            const spread = computeDailySpread(dailyEns, i);
            if (spread != null) {
                const col = spread < 1.5 ? '#34d399' : spread < 3 ? '#f59e0b' : '#f87171';
                spreadHtml = `<span class="d-spread" style="color:${col}">±${spread.toFixed(1)}°</span>`;
            }
        }

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

    const daily  = cachedLongRange.daily;
    const date   = new Date(daily.time[dayIndex] + 'T12:00:00');
    const maxT   = Math.round(daily.temperature_2m_max[dayIndex] ?? 0);
    const minT   = Math.round(daily.temperature_2m_min[dayIndex] ?? 0);
    const label  = dayIndex === 0 ? 'Heute'
                 : dayIndex === 1 ? 'Morgen'
                 : `${DAY_NAMES[date.getDay()]}, ${date.getDate()}.${date.getMonth()+1}.${date.getFullYear()}`;

    // Sunrise / Sunset
    const sunrise = daily.sunrise?.[dayIndex];
    const sunset  = daily.sunset?.[dayIndex];
    const sunEl   = document.getElementById('day-detail-sun');
    if (sunEl) {
        sunEl.innerHTML = (sunrise && sunset)
            ? `<div class="sun-row"><span>🌅 ${sunrise.slice(11, 16)}</span><span>🌇 ${sunset.slice(11, 16)}</span></div>`
            : '';
    }

    document.getElementById('day-detail-title').textContent = `${label} · ${maxT}° / ${minT}°`;
    displayHourlyForecast(cachedLongRange, dayIndex, 'day-detail-hourly',
        dayIndex <= 1 ? cachedEnsemble : null, null);
    displayPrecipitationAnalysis(cachedLongRange, dayIndex <= 1 ? cachedEnsemble : null, dayIndex);

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

        // Pass 1: Temperatur-Heatmap-Blobs
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

        // Pass 2: Pill-Labels + Wind-Pfeile (lesbar auf heller Karte)
        ctx.font         = 'bold 11px -apple-system,system-ui,sans-serif';
        ctx.textAlign    = 'center';
        ctx.textBaseline = 'middle';

        this._data.forEach(pt => {
            if (pt.temp == null) return;
            const px = this._map.latLngToContainerPoint([pt.lat, pt.lon]);
            if (px.x < -20 || px.x > W + 20 || px.y < -20 || px.y > H + 20) return;

            const label = `${Math.round(pt.temp)}°`;
            const tw    = ctx.measureText(label).width;
            ctx.shadowBlur  = 0;
            ctx.shadowColor = 'transparent';
            ctx.fillStyle   = 'rgba(255,255,255,0.92)';
            ctx.beginPath();
            ctx.roundRect(px.x - tw / 2 - 5, px.y - 9, tw + 10, 18, 4);
            ctx.fill();
            ctx.fillStyle = '#1a1a1a';
            ctx.fillText(label, px.x, px.y);

            if (pt.windDir != null && pt.windSpeed > 0.5) {
                drawWindArrow(ctx, px.x, px.y + 16, pt.windDir, pt.windSpeed);
            }
        });
    }
}

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

function drawWindArrow(ctx, x, y, fromDir, speed) {
    const angle = (fromDir + 90) * Math.PI / 180;
    const len   = Math.min(22, Math.max(8, speed * 0.38 + 6));

    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(angle);

    ctx.strokeStyle = 'rgba(30,30,30,0.75)';
    ctx.lineWidth   = 1.5;
    ctx.lineCap     = 'round';
    ctx.shadowColor = 'rgba(255,255,255,0.6)';
    ctx.shadowBlur  = 2;

    ctx.beginPath();
    ctx.moveTo(0, -len / 2);
    ctx.lineTo(0,  len / 2);
    ctx.stroke();

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
    const cityName = name.split(',')[0].trim();
    document.getElementById('location-dropdown').classList.add('hidden');
    document.getElementById('location-input').value = cityName;
    updateLocationDisplay(lat, lon, cityName);
    map.setView([lat, lon], 10);
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

function getCurrentPrecipProb() {
    if (!cachedLongRange?.hourly?.precipitation_probability) return null;
    const h = new Date().getHours();
    return cachedLongRange.hourly.precipitation_probability[h] ?? null;
}

function smoothPath(pts) {
    if (!pts || pts.length < 2) return '';
    let d = `M ${pts[0].x.toFixed(1)},${pts[0].y.toFixed(1)}`;
    for (let i = 0; i < pts.length - 1; i++) d += cubicSeg(pts[i], pts[i+1]);
    return d;
}

// ─── Settings ───────────────────────────────────────────────────────────────

const DEFAULT_WEIGHTS = {
    icon_d2:              0.35,
    ecmwf_ifs:            0.25,
    meteofrance_seamless: 0.20,
    gfs_seamless:         0.12,
    ukmo_seamless:        0.08
};

const DEFAULT_DISPLAY_DETAILS = {
    shows_feels_like: true,
    shows_wind_speed: true,
    shows_humidity: true,
    shows_precipitation: true,
    shows_visibility: true,
    shows_pressure: true,
    shows_precipitation_widget: true,
    shows_weather_report: true
};

class SettingsManager {
    constructor() {
        this.theme = this.loadTheme();
        this.weights = this.loadWeights();
        this.displayDetails = this.loadDisplayDetails();
        this.init();
    }

    init() {
        // Theme init
        this.applyTheme(this.theme);
        const themeButtons = document.querySelectorAll('.theme-btn');
        themeButtons.forEach(btn => {
            btn.classList.toggle('active', btn.dataset.theme === this.theme);
            btn.addEventListener('click', () => this.setTheme(btn.dataset.theme));
        });

        // Weight sliders
        const weightInputs = {
            'weight-icon-d2': 'icon_d2',
            'weight-ecmwf': 'ecmwf_ifs',
            'weight-meteofrance': 'meteofrance_seamless',
            'weight-gfs': 'gfs_seamless',
            'weight-ukmo': 'ukmo_seamless'
        };

        Object.entries(weightInputs).forEach(([inputId, key]) => {
            const input = document.getElementById(inputId);
            if (input) {
                input.value = Math.round(this.weights[key] * 100);
                input.addEventListener('input', e => this.setWeight(key, parseFloat(e.target.value) / 100));
            }
        });

        // Display detail checkboxes
        const detailCheckboxes = {
            'show-feels-like': 'shows_feels_like',
            'show-wind-speed': 'shows_wind_speed',
            'show-humidity': 'shows_humidity',
            'show-precipitation': 'shows_precipitation',
            'show-visibility': 'shows_visibility',
            'show-pressure': 'shows_pressure',
            'show-precipitation-widget': 'shows_precipitation_widget',
            'show-weather-report': 'shows_weather_report'
        };

        Object.entries(detailCheckboxes).forEach(([checkboxId, key]) => {
            const checkbox = document.getElementById(checkboxId);
            if (checkbox) {
                checkbox.checked = this.displayDetails[key];
                checkbox.addEventListener('change', e => {
                    this.setDisplayDetail(key, e.target.checked);
                    // Sofortiges Update für show-weather-report
                    if (checkboxId === 'show-weather-report') {
                        const widget = document.getElementById('precipitation-analysis-widget');
                        if (widget) widget.style.display = e.target.checked ? '' : 'none';
                    }
                });
            }
        });

        // Reset button
        document.getElementById('weight-reset-btn')?.addEventListener('click', () => this.resetWeights());

        // Modal controls
        document.getElementById('settings-btn')?.addEventListener('click', () => this.openModal());
        document.getElementById('settings-close')?.addEventListener('click', () => this.closeModal());
        document.querySelector('.settings-overlay')?.addEventListener('click', () => this.closeModal());

        // Prevent modal close on content click
        document.querySelector('.settings-panel')?.addEventListener('click', e => e.stopPropagation());

        // Favorite button
        document.getElementById('favorite-btn')?.addEventListener('click', () => this.toggleCurrentFavorite());

        // Init Favorites Quick Bar
        this.updateFavoritesQuickBar();

        // Update WEIGHTS global when modal is closed
        this.syncWeightsToGlobal();
    }

    loadTheme() {
        return localStorage.getItem('weather_theme') || 'dark';
    }

    setTheme(theme) {
        this.theme = theme;
        localStorage.setItem('weather_theme', theme);
        this.applyTheme(theme);

        // Update button states
        document.querySelectorAll('.theme-btn').forEach(btn => {
            btn.classList.toggle('active', btn.dataset.theme === theme);
        });
    }

    applyTheme(theme) {
        const isDark = theme === 'dark';
        const root = document.documentElement;
        root.setAttribute('data-theme', theme);

        if (isDark) {
            root.style.setProperty('--bg',        '#080c14');
            root.style.setProperty('--surface',   '#0f1623');
            root.style.setProperty('--card',      'rgba(255,255,255,0.034)');
            root.style.setProperty('--card-b',    'rgba(255,255,255,0.07)');
            root.style.setProperty('--card-hov',  'rgba(255,255,255,0.06)');
            root.style.setProperty('--header-bg', 'rgba(8,12,20,0.85)');
            root.style.setProperty('--text',      '#f1f5f9');
            root.style.setProperty('--text-2',    '#94a3b8');
            root.style.setProperty('--text-3',    '#475569');
            document.body.style.backgroundColor  = '#080c14';
            document.body.style.backgroundImage  = 'radial-gradient(ellipse 80% 50% at 50% -10%, rgba(15,30,60,0.8) 0%, transparent 70%)';
        } else {
            root.style.setProperty('--bg',        '#edf2f7');
            root.style.setProperty('--surface',   '#ffffff');
            root.style.setProperty('--card',      'rgba(0,0,0,0.03)');
            root.style.setProperty('--card-b',    'rgba(0,0,0,0.1)');
            root.style.setProperty('--card-hov',  'rgba(0,0,0,0.06)');
            root.style.setProperty('--header-bg', 'rgba(237,242,247,0.93)');
            root.style.setProperty('--text',      '#0f172a');
            root.style.setProperty('--text-2',    '#475569');
            root.style.setProperty('--text-3',    '#94a3b8');
            document.body.style.backgroundColor  = '#edf2f7';
            document.body.style.backgroundImage  = 'none';
        }

        // Swap map base tiles and force redraw
        const tileUrl = isDark
            ? 'https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}.png'
            : 'https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png';
        if (baseTileLayer) {
            baseTileLayer.setUrl(tileUrl);
            baseTileLayer.redraw();
        }

        // Update PWA theme color
        document.querySelector('meta[name="theme-color"]')
            ?.setAttribute('content', isDark ? '#080c14' : '#edf2f7');
    }

    loadWeights() {
        const saved = localStorage.getItem('weather_weights');
        return saved ? JSON.parse(saved) : { ...DEFAULT_WEIGHTS };
    }

    setWeight(key, value) {
        this.weights[key] = value;
        localStorage.setItem('weather_weights', JSON.stringify(this.weights));
        
        // Update display
        const valueSpans = {
            'icon_d2': 'weight-icon-d2-value',
            'ecmwf_ifs': 'weight-ecmwf-value',
            'meteofrance_seamless': 'weight-meteofrance-value',
            'gfs_seamless': 'weight-gfs-value',
            'ukmo_seamless': 'weight-ukmo-value'
        };
        
        const spanId = valueSpans[key];
        if (spanId) {
            document.getElementById(spanId).textContent = Math.round(value * 100) + '%';
        }

        this.syncWeightsToGlobal();
    }

    resetWeights() {
        this.weights = { ...DEFAULT_WEIGHTS };
        localStorage.setItem('weather_weights', JSON.stringify(this.weights));

        // Update all sliders
        const weightInputs = {
            'weight-icon-d2': 'icon_d2',
            'weight-ecmwf': 'ecmwf_ifs',
            'weight-meteofrance': 'meteofrance_seamless',
            'weight-gfs': 'gfs_seamless',
            'weight-ukmo': 'ukmo_seamless'
        };

        Object.entries(weightInputs).forEach(([inputId, key]) => {
            const input = document.getElementById(inputId);
            const valueSpan = document.getElementById(inputId + '-value');
            if (input && valueSpan) {
                const percent = Math.round(this.weights[key] * 100);
                input.value = percent;
                valueSpan.textContent = percent + '%';
            }
        });

        this.syncWeightsToGlobal();
    }

    syncWeightsToGlobal() {
        // Update the global WEIGHTS object for use in forecast calculations
        Object.assign(WEIGHTS, this.weights);
    }

    loadDisplayDetails() {
        const saved = localStorage.getItem('weather_display_details');
        return saved ? JSON.parse(saved) : { ...DEFAULT_DISPLAY_DETAILS };
    }

    setDisplayDetail(key, value) {
        this.displayDetails[key] = value;
        localStorage.setItem('weather_display_details', JSON.stringify(this.displayDetails));
    }

    // Favorites Management
    loadFavorites() {
        const saved = localStorage.getItem('weather_favorites');
        return saved ? JSON.parse(saved) : [];
    }

    saveFavorites(favorites) {
        localStorage.setItem('weather_favorites', JSON.stringify(favorites));
    }

    addFavorite(name, lat, lon) {
        const favorites = this.loadFavorites();
        const exists = favorites.some(f => f.lat === lat && f.lon === lon);
        if (!exists) {
            favorites.push({ name, lat, lon, timestamp: Date.now() });
            this.saveFavorites(favorites);
            this.updateFavoritesUI();
        }
    }

    removeFavorite(lat, lon) {
        let favorites = this.loadFavorites();
        favorites = favorites.filter(f => !(f.lat === lat && f.lon === lon));
        this.saveFavorites(favorites);
        this.updateFavoritesUI();
    }

    isFavorite(lat, lon) {
        const favorites = this.loadFavorites();
        return favorites.some(f => f.lat === lat && f.lon === lon);
    }

    updateFavoritesUI() {
        const favorites = this.loadFavorites();
        const favoritesList = document.getElementById('favorites-list');
        const favoritesEmpty = document.getElementById('favorites-empty');

        if (!favoritesList) return;

        if (favorites.length === 0) {
            favoritesList.innerHTML = '';
            favoritesEmpty.style.display = 'flex';
        } else {
            favoritesEmpty.style.display = 'none';
            favoritesList.innerHTML = favorites
                .sort((a, b) => b.timestamp - a.timestamp)
                .map(fav => `
                    <div class="favorite-item" data-lat="${fav.lat}" data-lon="${fav.lon}" data-name="${escapeHtml(fav.name)}">
                        <div class="favorite-item-info">
                            <div class="favorite-item-name">${escapeHtml(fav.name)}</div>
                            <div class="favorite-item-coords">${fav.lat.toFixed(2)}°, ${fav.lon.toFixed(2)}°</div>
                        </div>
                        <button class="favorite-item-remove" data-lat="${fav.lat}" data-lon="${fav.lon}" title="Entfernen">
                            <i data-lucide="x"></i>
                        </button>
                    </div>
                `).join('');

            // Add event listeners for favorite items
            document.querySelectorAll('.favorite-item').forEach(item => {
                item.addEventListener('click', e => {
                    if (!e.target.closest('.favorite-item-remove')) {
                        const lat = parseFloat(item.dataset.lat);
                        const lon = parseFloat(item.dataset.lon);
                        const name = item.dataset.name || null;
                        loadLocationWeather(lat, lon, name);
                        this.closeModal();
                    }
                });
            });

            // Add event listeners for remove buttons
            document.querySelectorAll('.favorite-item-remove').forEach(btn => {
                btn.addEventListener('click', e => {
                    e.stopPropagation();
                    const lat = parseFloat(btn.dataset.lat);
                    const lon = parseFloat(btn.dataset.lon);
                    this.removeFavorite(lat, lon);
                });
            });

            // Re-render lucide icons in favorites section
            if (typeof lucide !== 'undefined') {
                lucide.createIcons({ nodes: [favoritesList] });
            }
        }

        // Render Favorites Quick Bar
        this.updateFavoritesQuickBar();
    }

    updateFavoritesQuickBar() {
        const quickbar = document.getElementById('favorites-quickbar');
        if (!quickbar) return;

        const favorites = this.loadFavorites();
        if (favorites.length === 0) {
            quickbar.innerHTML = '<div style="padding:0.5rem 1rem;color:var(--text-3);font-size:0.8rem">Keine Favoriten hinzugefügt</div>';
            return;
        }

        const currentFav = favorites.find(f => 
            Math.abs(f.lat - currentLat) < 0.01 && Math.abs(f.lon - currentLon) < 0.01
        );

        quickbar.innerHTML = favorites
            .sort((a, b) => b.timestamp - a.timestamp)
            .map(fav => {
                const isActive = currentFav &&
                                 Math.abs(fav.lat - currentFav.lat) < 0.01 &&
                                 Math.abs(fav.lon - currentFav.lon) < 0.01;
                return `
                    <button class="favorite-quick-item ${isActive ? 'active' : ''}" data-lat="${fav.lat}" data-lon="${fav.lon}" data-name="${escapeHtml(fav.name)}" title="${escapeHtml(fav.name)}">
                        <i data-lucide="${isActive ? 'star' : 'map-pin'}" style="width:14px;height:14px"></i>
                        <span>${escapeHtml(fav.name)}</span>
                    </button>
                `;
            }).join('');

        // Event listeners für Schnellauswahl
        quickbar.addEventListener('click', e => {
            const btn = e.target.closest('.favorite-quick-item');
            if (btn) {
                const lat = parseFloat(btn.dataset.lat);
                const lon = parseFloat(btn.dataset.lon);
                const name = btn.dataset.name || null;
                loadLocationWeather(lat, lon, name);
            }
        });

        // Render icons
        if (typeof lucide !== 'undefined') {
            lucide.createIcons({ nodes: [quickbar] });
        }
    }

    openModal() {
        document.getElementById('settings-modal')?.classList.remove('hidden');
        this.updateFavoritesUI();
    }

    toggleCurrentFavorite() {
        if (!currentLat || !currentLon) return;
        
        const isFav = this.isFavorite(currentLat, currentLon);
        if (isFav) {
            this.removeFavorite(currentLat, currentLon);
        } else {
            const locationName = document.getElementById('current-location').textContent || 'Gespeicherter Ort';
            this.addFavorite(locationName, currentLat, currentLon);
        }
        this.updateFavoriteButton();
    }

    updateFavoriteButton() {
        const btn = document.getElementById('favorite-btn');
        if (!btn) return;
        
        if (currentLat && currentLon && this.isFavorite(currentLat, currentLon)) {
            btn.classList.add('active');
            btn.setAttribute('title', 'Aus Favoriten entfernen');
        } else {
            btn.classList.remove('active');
            btn.setAttribute('title', 'Zu Favoriten hinzufügen');
        }
    }

    // Last location tracking
    saveLastLocation(name, lat, lon) {
        localStorage.setItem('weather_last_location', JSON.stringify({ name, lat, lon, timestamp: Date.now() }));
    }

    loadLastLocation() {
        const saved = localStorage.getItem('weather_last_location');
        return saved ? JSON.parse(saved) : null;
    }

    closeModal() {
        document.getElementById('settings-modal')?.classList.add('hidden');
    }
}

// Settings manager instance (initialized in setupEventListeners)
let settingsManager = null;

// ─── Auto-Refresh ─────────────────────────────────────────────────────────────

setInterval(() => { if (currentLat && currentLon) fetchWeather(); }, 10 * 60 * 1000);
