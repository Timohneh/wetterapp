// Wetter-PWA: Multi-Model Logik mit ICON-D2 (50%), ECMWF (30%), GFS (20%)
const WEIGHTS = {
    icon_d2: 0.5,
    ecmwf_ifs: 0.3,
    gfs_seamless: 0.2
};

const RAINFALL_API_KEY = 'ITlkvAiMY4r2S';

// WMO Weather Codes to Lucide Icons + Descriptions
const WEATHER_CODES = {
    0: { icon: 'Sun', desc: 'Klarer Himmel' },
    1: { icon: 'Cloud', desc: 'Überwiegend heiter' },
    2: { icon: 'CloudDrizzle', desc: 'Teilweise bewölkt' },
    3: { icon: 'CloudRain', desc: 'Bedeckt' },
    45: { icon: 'Cloud', desc: 'Nebel' },
    48: { icon: 'Cloud', desc: 'Gefrierender Nebel' },
    51: { icon: 'CloudDrizzle', desc: 'Nieselregen (leicht)' },
    53: { icon: 'CloudDrizzle', desc: 'Nieselregen' },
    55: { icon: 'CloudRain', desc: 'Nieselregen (kräftig)' },
    61: { icon: 'CloudRain', desc: 'Regen (schwach)' },
    63: { icon: 'CloudRain', desc: 'Regen (mäßig)' },
    65: { icon: 'CloudLightning', desc: 'Regen (kräftig)' },
    71: { icon: 'CloudSnow', desc: 'Schnee (schwach)' },
    73: { icon: 'CloudSnow', desc: 'Schnee (mäßig)' },
    75: { icon: 'CloudSnow', desc: 'Schnee (kräftig)' },
    77: { icon: 'CloudSnow', desc: 'Schneekörnchen' },
    80: { icon: 'CloudRain', desc: 'Regenschauer (schwach)' },
    81: { icon: 'CloudRain', desc: 'Regenschauer (mäßig)' },
    82: { icon: 'CloudLightning', desc: 'Regenschauer (kräftig)' },
    85: { icon: 'CloudSnow', desc: 'Schneeschauer (schwach)' },
    86: { icon: 'CloudSnow', desc: 'Schneeschauer (kräftig)' },
    95: { icon: 'CloudLightning', desc: 'Gewitter' },
    96: { icon: 'CloudLightning', desc: 'Gewitter mit Hagel' },
    99: { icon: 'CloudLightning', desc: 'Gewitter mit Hagel' }
};

let map = null;
let radarLayer = null;
let currentLat = null;
let currentLon = null;

// Initialize app
document.addEventListener('DOMContentLoaded', () => {
    initMap();
    getGeolocation();
    setupEventListeners();
});

// Leaflet Map Setup
function initMap() {
    map = L.map('map', {
        center: [51.1657, 10.4515],
        zoom: 6,
        dragging: true,
        zoomControl: true
    });

    L.tileLayer('https://tiles.stadiamaps.com/tiles/stamen_tonernight/{z}/{x}/{y}.png', {
        attribution: '&copy; Stadia Maps, &copy; Stamen Design',
        maxZoom: 18
    }).addTo(map);

    L.control.scale().addTo(map);
}

// Geolocation
function getGeolocation() {
    if (navigator.geolocation) {
        navigator.geolocation.getCurrentPosition(
            (position) => {
                currentLat = position.coords.latitude;
                currentLon = position.coords.longitude;
                updateLocationDisplay(currentLat, currentLon);
                map.setView([currentLat, currentLon], 10);
                fetchWeather();
            },
            (error) => {
                console.log('Geolocation error:', error);
                // Fallback: Center of Germany
                currentLat = 51.1657;
                currentLon = 10.4515;
                updateLocationDisplay(currentLat, currentLon);
                fetchWeather();
            }
        );
    }
}

function updateLocationDisplay(lat, lon) {
    document.getElementById('location-coords').textContent = `${lat.toFixed(2)}°, ${lon.toFixed(2)}°`;

    // Reverse Geocoding (simple, offline approximation)
    const regions = {
        'Schleswig-Holstein': { lat: 54.5, lon: 9.5 },
        'Hamburg': { lat: 53.55, lon: 10.0 },
        'Mecklenburg-Vorpommern': { lat: 54.0, lon: 13.0 },
        'Bremen': { lat: 53.1, lon: 8.8 },
        'Niedersachsen': { lat: 52.5, lon: 9.5 },
        'Berlin': { lat: 52.52, lon: 13.4 },
        'Brandenburg': { lat: 52.2, lon: 13.0 },
        'Sachsen-Anhalt': { lat: 52.0, lon: 11.5 },
        'Sachsen': { lat: 51.0, lon: 13.5 },
        'Nordrhein-Westfalen': { lat: 51.5, lon: 7.5 },
        'Hessen': { lat: 50.5, lon: 9.0 },
        'Thüringen': { lat: 50.8, lon: 11.0 },
        'Bayern': { lat: 48.5, lon: 11.5 },
        'Baden-Württemberg': { lat: 48.5, lon: 9.0 },
        'Rheinland-Pfalz': { lat: 50.0, lon: 7.5 },
        'Saarland': { lat: 49.2, lon: 6.8 }
    };

    let nearest = 'Deutschland';
    let minDist = Infinity;

    for (const [region, center] of Object.entries(regions)) {
        const dist = Math.hypot(lat - center.lat, lon - center.lon);
        if (dist < minDist) {
            minDist = dist;
            nearest = region;
        }
    }

    document.getElementById('current-location').textContent = nearest;
}

// Event Listeners
function setupEventListeners() {
    document.getElementById('radar-toggle').addEventListener('change', (e) => {
        const opacityControl = document.getElementById('opacity-control');
        if (e.target.checked) {
            opacityControl.classList.remove('hidden');
            initRadar();
        } else {
            opacityControl.classList.add('hidden');
            if (radarLayer) {
                radarLayer.remove();
                radarLayer = null;
            }
        }
    });

    document.getElementById('radar-opacity').addEventListener('input', (e) => {
        document.getElementById('opacity-value').textContent = e.target.value;
        if (radarLayer) {
            radarLayer.setOpacity(e.target.value / 100);
        }
    });
}

// RainViewer Radar Integration
function initRadar() {
    if (radarLayer) return;

    const options = {
        opacity: 0.7,
        maxZoom: 18,
        composite: null,
        attribution: 'RainViewer'
    };

    radarLayer = L.rainviewer(options).addTo(map);
}

// Multi-Model Weather Fetch
async function fetchWeather() {
    try {
        const [icon, ecmwf, gfs] = await Promise.all([
            fetchModel('icon_d2', 'ICON-D2 (DWD)'),
            fetchModel('ecmwf_ifs', 'ECMWF-IFS'),
            fetchModel('gfs_seamless', 'GFS')
        ]);

        const weatherData = mergeModels(icon, ecmwf, gfs);
        displayWeather(weatherData);
        displayModelComparison(icon, ecmwf, gfs, weatherData.confidence);
        displayHourlyForecast(icon, ecmwf, gfs);

        document.getElementById('update-time').textContent = new Date().toLocaleTimeString('de-DE', {
            hour: '2-digit',
            minute: '2-digit'
        });
    } catch (error) {
        console.error('Fehler beim Abrufen der Wetterdaten:', error);
        document.getElementById('weather-display').innerHTML =
            `<p class="text-red-400">Fehler beim Laden der Wetterdaten. Bitte später erneut versuchen.</p>`;
    }
}

// Fetch single model from Open-Meteo
async function fetchModel(model, label) {
    const url = new URL('https://api.open-meteo.com/v1/forecast');
    url.searchParams.append('latitude', currentLat);
    url.searchParams.append('longitude', currentLon);
    url.searchParams.append('current', 'temperature_2m,relative_humidity_2m,precipitation,weather_code,wind_speed_10m,weather_code');
    url.searchParams.append('hourly', 'temperature_2m,precipitation_probability,precipitation,weather_code');
    url.searchParams.append('models', model);
    url.searchParams.append('timezone', 'Europe/Berlin');
    url.searchParams.append('forecast_days', '1');

    const response = await fetch(url);
    if (!response.ok) throw new Error(`Model ${label} failed`);

    const data = await response.json();
    return {
        model,
        label,
        temp: data.current.temperature_2m,
        humidity: data.current.relative_humidity_2m,
        precipitation: data.current.precipitation || 0,
        wind: data.current.wind_speed_10m,
        weather_code: data.current.weather_code,
        hourly: data.hourly,
        current: data.current
    };
}

// Merge models with weights
function mergeModels(icon, ecmwf, gfs) {
    const models = [
        { data: icon, weight: WEIGHTS.icon_d2 },
        { data: ecmwf, weight: WEIGHTS.ecmwf_ifs },
        { data: gfs, weight: WEIGHTS.gfs_seamless }
    ];

    const weighted = {
        temp: 0,
        humidity: 0,
        precipitation: 0,
        wind: 0
    };

    models.forEach(({ data, weight }) => {
        weighted.temp += data.temp * weight;
        weighted.humidity += data.humidity * weight;
        weighted.precipitation += data.precipitation * weight;
        weighted.wind += data.wind * weight;
    });

    // Calculate confidence score (spread of values)
    const tempSpread = Math.abs(icon.temp - gfs.temp);
    const windSpread = Math.abs(icon.wind - gfs.wind);

    const tempVariance = [icon.temp, ecmwf.temp, gfs.temp].reduce((a, b) => a + Math.abs(b - weighted.temp), 0) / 3;
    const windVariance = [icon.wind, ecmwf.wind, gfs.wind].reduce((a, b) => a + Math.abs(b - weighted.wind), 0) / 3;

    // Confidence: high if variance is low
    const maxVariance = 15;
    const confidence = Math.max(0, Math.min(100, 100 - ((tempVariance + windVariance) / 2 / maxVariance * 100)));

    return {
        temp: Math.round(weighted.temp * 10) / 10,
        humidity: Math.round(weighted.humidity),
        precipitation: Math.round(weighted.precipitation * 10) / 10,
        wind: Math.round(weighted.wind),
        confidence: Math.round(confidence),
        models: [icon, ecmwf, gfs],
        tempRange: {
            min: Math.min(icon.temp, ecmwf.temp, gfs.temp),
            max: Math.max(icon.temp, ecmwf.temp, gfs.temp)
        }
    };
}

// Display merged weather data
function displayWeather(data) {
    const { temp, humidity, precipitation, wind, confidence, tempRange, models } = data;

    document.getElementById('temp-display').textContent = `${temp}°C`;
    document.getElementById('temp-range').textContent = `${Math.round(tempRange.min)}° bis ${Math.round(tempRange.max)}°C`;
    document.getElementById('humidity-display').textContent = `${humidity}%`;
    document.getElementById('precipitation-display').textContent = `${precipitation}mm`;
    document.getElementById('wind-display').textContent = `${wind} km/h`;

    // Display weather icon & description
    const weatherCode = models[0].current.weather_code;
    const weatherInfo = WEATHER_CODES[weatherCode] || { icon: 'Cloud', desc: 'Wetter unbekannt' };
    updateWeatherIcon(weatherInfo.icon);
    document.getElementById('weather-description').textContent = weatherInfo.desc;

    // Display temperature trend
    const trend = calculateTemperatureTrend(models);
    displayTemperatureTrend(trend, models);

    // Sparkline for temperature models
    drawTempSparkline(models.map(m => m.temp));

    // Confidence badge
    const badge = document.getElementById('confidence-badge');
    badge.className = 'confidence-badge';
    if (confidence > 75) {
        badge.classList.add('confidence-high');
        document.getElementById('confidence-text').textContent = '✓ Hohe Vorhersage-Sicherheit';
    } else if (confidence > 50) {
        badge.classList.add('confidence-medium');
        document.getElementById('confidence-text').textContent = '⚠ Modelle teilweise uneinig';
    } else {
        badge.classList.add('confidence-low');
        document.getElementById('confidence-text').textContent = '✗ Modelle uneinig';
    }
    document.getElementById('confidence-value').textContent = confidence;

    // Quick stats
    const visibility = Math.round(10 / Math.max(0.1, precipitation) * 10) / 10;
    document.getElementById('visibility-stat').textContent = `${Math.min(visibility, 10).toFixed(1)} km`;
    document.getElementById('uv-stat').textContent = getUVIndex(temp, humidity);
    document.getElementById('dewpoint-stat').textContent = `${calculateDewpoint(temp, humidity).toFixed(1)}°C`;
    document.getElementById('precipitation-prob').textContent = `Wahrscheinlichkeit: ${calculatePrecipitationProb(models).toFixed(0)}%`;
}

// Display model comparison
function displayModelComparison(icon, ecmwf, gfs, confidence) {
    const models = [
        { label: 'ICON-D2 (DWD)', temp: icon.temp, wind: icon.wind, weight: '50%' },
        { label: 'ECMWF-IFS', temp: ecmwf.temp, wind: ecmwf.wind, weight: '30%' },
        { label: 'GFS', temp: gfs.temp, wind: gfs.wind, weight: '20%' }
    ];

    let html = '';
    models.forEach(m => {
        html += `
            <div class="bg-gray-700 rounded p-3 flex justify-between items-center">
                <div>
                    <p class="font-semibold text-sm">${m.label}</p>
                    <p class="text-xs text-gray-400">Gewichtung: <span class="text-amber-400">${m.weight}</span></p>
                </div>
                <div class="text-right">
                    <p class="text-sm"><span class="font-bold">${m.temp.toFixed(1)}</span>°C</p>
                    <p class="text-xs text-gray-400">${m.wind.toFixed(1)} km/h</p>
                </div>
            </div>
        `;
    });

    document.getElementById('model-comparison').innerHTML = html;
}

// Hourly forecast for next 24h
function displayHourlyForecast(icon, ecmwf, gfs) {
    const times = icon.hourly.time.slice(0, 24);
    const temps = icon.hourly.temperature_2m.slice(0, 24);
    const precip = icon.hourly.precipitation.slice(0, 24);

    let html = '';
    times.forEach((time, i) => {
        const hour = new Date(time + 'Z').getHours();
        html += `
            <div class="bg-gray-700 rounded-lg p-2 text-center text-sm min-w-max">
                <p class="font-semibold text-xs text-amber-300">${hour.toString().padStart(2, '0')}:00</p>
                <p class="text-lg font-bold">${temps[i].toFixed(0)}°</p>
                <p class="text-xs text-gray-400">${precip[i] > 0 ? precip[i].toFixed(1) + 'mm' : '—'}</p>
            </div>
        `;
    });

    document.getElementById('hourly-forecast').innerHTML = html;
}

// Helper: Calculate UV Index (simple estimation)
function getUVIndex(temp, humidity) {
    // Simplified estimation based on temperature
    const base = Math.max(0, (temp - 10) / 5);
    return Math.min(base, 11).toFixed(1);
}

// Helper: Calculate Dewpoint (Magnus approximation)
function calculateDewpoint(temp, humidity) {
    const a = 17.27;
    const b = 237.7;
    const alpha = ((a * temp) / (b + temp)) + Math.log(humidity / 100);
    return (b * alpha) / (a - alpha);
}

// Helper: Calculate precipitation probability from models
function calculatePrecipitationProb(models) {
    const probs = models.map(m => m.current.precipitation > 0 ? 80 : 20);
    return probs.reduce((a, b) => a + b) / probs.length;
}

// Render Lucide Icon for weather
function updateWeatherIcon(iconName) {
    const iconEl = document.getElementById('weather-icon');
    iconEl.innerHTML = '';

    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('width', '64');
    svg.setAttribute('height', '64');
    svg.setAttribute('viewBox', '0 0 24 24');
    svg.setAttribute('fill', 'none');
    svg.setAttribute('stroke', 'currentColor');
    svg.setAttribute('stroke-width', '2');
    svg.setAttribute('stroke-linecap', 'round');
    svg.setAttribute('stroke-linejoin', 'round');
    svg.classList.add('lucide', `lucide-${iconName}`);

    iconEl.appendChild(svg);
    lucide.createIcons();
}

// Calculate temperature trend across 3 models
function calculateTemperatureTrend(models) {
    if (models.length < 2) return { trend: 'stable', strength: 0 };

    const temps = models.map(m => m.temp);
    const avg = temps.reduce((a, b) => a + b) / temps.length;

    // Compare first vs last to detect trend
    const change = temps[temps.length - 1] - temps[0];
    const strength = Math.abs(change);

    if (strength < 0.5) return { trend: 'stable', strength: 0, change };
    if (change > 0) return { trend: 'rising', strength, change };
    return { trend: 'falling', strength, change };
}

// Display temperature trend with arrow and text
function displayTemperatureTrend(trend, models) {
    const trendEl = document.getElementById('trend-arrow');
    const textEl = document.getElementById('trend-text');

    const temps = models.map(m => m.temp);
    const min = Math.min(...temps);
    const max = Math.max(...temps);
    const spread = max - min;

    let arrow = '—';
    let text = 'Stabil';
    let color = 'text-gray-300';

    if (trend.trend === 'rising') {
        arrow = '↑';
        text = `Steigend (+${trend.change.toFixed(1)}°C)`;
        color = 'text-orange-400';
    } else if (trend.trend === 'falling') {
        arrow = '↓';
        text = `Fallend (${trend.change.toFixed(1)}°C)`;
        color = 'text-blue-400';
    } else {
        text = `Stabil (Spanne: ±${(spread / 2).toFixed(1)}°C)`;
    }

    trendEl.textContent = arrow;
    trendEl.className = color;
    textEl.textContent = text;
    textEl.className = `text-sm ${color}`;
}

// Draw temperature sparkline (3 model comparison)
function drawTempSparkline(temps) {
    const svg = document.getElementById('temp-sparkline');
    if (!svg) return;

    svg.innerHTML = '';

    const min = Math.min(...temps);
    const max = Math.max(...temps);
    const range = max - min || 1;
    const width = 100;
    const height = 32;
    const padding = 2;

    const points = temps.map((temp, i) => {
        const x = (i / (temps.length - 1 || 1)) * (width - 2 * padding) + padding;
        const y = height - ((temp - min) / range) * (height - 2 * padding) - padding;
        return `${x},${y}`;
    });

    const polyline = document.createElementNS('http://www.w3.org/2000/svg', 'polyline');
    polyline.setAttribute('points', points.join(' '));
    polyline.setAttribute('fill', 'none');
    polyline.setAttribute('stroke', '#fbbf24');
    polyline.setAttribute('stroke-width', '2');
    polyline.setAttribute('stroke-linecap', 'round');
    polyline.setAttribute('stroke-linejoin', 'round');

    svg.setAttribute('viewBox', `0 0 ${width} ${height}`);
    svg.appendChild(polyline);

    // Dots for each model
    temps.forEach((_, i) => {
        const x = (i / (temps.length - 1 || 1)) * (width - 2 * padding) + padding;
        const y = height - ((temps[i] - min) / range) * (height - 2 * padding) - padding;

        const circle = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
        circle.setAttribute('cx', x);
        circle.setAttribute('cy', y);
        circle.setAttribute('r', '1.5');
        circle.setAttribute('fill', '#fbbf24');
        svg.appendChild(circle);
    });
}

// Periodic refresh every 10 minutes
setInterval(() => {
    if (currentLat && currentLon) {
        fetchWeather();
    }
}, 10 * 60 * 1000);
