# 🌤️ Wetterapp Deutschland

Eine moderne Progressive Web App (PWA) für deutsche Wetter-Vorhersagen mit **Multi-Modell-Logik** und interaktiver Kartendarstellung.

## ✨ Features

- **Multi-Modell-Vorhersagen**: Kombiniert ICON-D2 (50%), ECMWF (30%) und GFS (20%)
- **Confidence-Score**: Zeigt Sicherheit der Vorhersage basierend auf Modell-Übereinstimmung
- **Temperatur-Tendenzen**: Visualisiert Temperaturtrends über 3 Modelle mit Sparkline
- **Weather Icons**: Lucide Icons für alle WMO-Wettercodes
- **Interaktive Karte**: Leaflet.js mit Geolocation und RainViewer-Radar
- **Radar-Overlay**: Niederschlagsradar mit Opacity-Slider
- **PWA-Ready**: Installierbar auf Android, iOS und Desktop
- **Offline-First**: Service Worker mit Cache-Strategien
- **Dark-Mode**: Minimalistisches, mobil-optimiertes Design


## 🔧 Technologie-Stack

- **Frontend**: HTML5, CSS (Tailwind CDN), Vanilla JavaScript
- **Kartierung**: Leaflet.js + Stadia Maps Basislayer
- **Radar**: RainViewer API
- **Wetter-Daten**: Open-Meteo (kostenlos, keine API-Keys nötig)
- **Icons**: Lucide Icons (CDN)
- **PWA**: Service Worker, Manifest, Cache Strategies

## 📊 Modell-Gewichtung

| Modell | Gewicht | Provider |
|--------|---------|----------|
| ICON-D2 | 50% | Deutscher Wetterdienst (DWD) |
| ECMWF-IFS | 30% | European Centre for Medium-Range Weather Forecasts |
| GFS | 20% | National Centers for Environmental Prediction |

## 🌡️ Temperatur-Trend Berechnung

Die Sparkline zeigt die Temperatur-Divergenz zwischen den 3 Modellen:
- **↑ Steigend**: Modelle einig auf steigende Tendenz
- **↓ Fallend**: Modelle einig auf fallende Tendenz  
- **—  Stabil**: Modelle zeigen keine klare Tendenz

## 🎨 Weather Code zu Icon Mapping

WMO-Codes werden automatisch zu Lucide Icons konvertiert:
- 0 → ☀️ Sonnig
- 1-3 → ☁️ Bewölkt
- 45-48 → 🌫️ Nebel
- 51-82 → 🌧️ Regen/Schnee/Schauer
- 95-99 → ⚡ Gewitter

## ⚙️ Confidence-Score

Der Score basiert auf der Abweichung zwischen Modellen:
- **> 75%**: Grün ✓ Hohe Sicherheit
- **50-75%**: Orange ⚠ Teilweise unsicher
- **< 50%**: Rot ✗ Modelle uneinig

## 🔗 Datenquellen

- **Open-Meteo**: Wetter-Vorhersagen (kostenlos)
- **RainViewer**: Niederschlags-Radar (kostenlos)
- **Stadia Maps**: Basiskarten (kostenpflichtig ab 100k Requests/Tag)
- **Lucide Icons**: SVG Icon Library

## 📝 Lizenz

MIT - Frei verwendbar für private und kommerzielle Projekte

## 🤝 Contributing

Verbesserungsvorschläge, Bug-Reports und Pull Requests sind willkommen!


