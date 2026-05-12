# ⚙️ GitHub Pages Setup (Wichtig!)

Der Deploy läuft über GitHub Actions. Es wird kein `gh-pages`-Branch benötigt.

## 1️⃣ GitHub Pages aktivieren

1. Gehe zu deinem Repository: `https://github.com/dein-username/wetterapp`
2. Klicke auf **Settings** (Einstellungen)
3. Wähle im linken Menü: **Pages**
4. Unter "Build and deployment":
   - **Source**: `GitHub Actions`
   - Speichere die Einstellung

## 2️⃣ Überprüfe die Repository-Einstellungen

Stelle sicher, dass:
- ✅ Dein Repository ist **public** (privat geht auch, aber braucht Pro)
- ✅ GitHub Pages ist **enabled**
- ✅ Source ist auf **"GitHub Actions"** gesetzt

## 3️⃣ Deploy manuell triggern

```bash
# Code pushen
git push origin main
```

Oder manuell über GitHub:
1. Gehe zu **Actions** Tab
2. Wähle **"Deploy to GitHub Pages"** Workflow
3. Klicke **"Run workflow"**

## 4️⃣ Ergebnis überprüfen

Nach dem Deploy:
1. Gehe zurück zu **Settings → Pages**
2. Du solltest eine URL sehen wie:
   ```
   Your site is live at https://dein-username.github.io/wetterapp/
   ```

## 🔍 Troubleshooting

### ❌ "Cannot find any run with github.run_id"
**Lösung**: 
- In Settings → Pages Source auf **"GitHub Actions"** setzen
- Danach den Workflow erneut starten oder neu pushen

### ❌ 404 - Deployment failed
**Lösung**:
- Repository muss **public** sein
- GitHub Pages muss aktiviert sein und auf **GitHub Actions** stehen
- Warte 2-3 Minuten nach dem Push

### ❌ Die Seite ist leer/zeigt alte Version
**Lösung**:
```bash
# Hard Refresh im Browser
Strg+Shift+R (Windows/Linux)
Cmd+Shift+R (Mac)
```

## 📋 Kompletter Setup-Prozess

```
1. Repository auf GitHub erstellen
2. Code pushen: git push origin main
3. Settings → Pages → Source = "GitHub Actions"
4. Warten (~2 Min)
5. Seite verfügbar unter: https://username.github.io/wetterapp/
```

## 🎯 Nach dem Setup

Die App ist dann:
- ✅ **Live** unter deiner GitHub Pages URL
- ✅ **Installierbar** auf Android/iOS/Desktop
- ✅ **Offline-fähig** (PWA mit Service Worker)
- ✅ **Auto-Update** bei jedem Push (via GitHub Actions)

---

**Brauchst du Hilfe?** Überprüfe die GitHub Actions Logs:
1. Gehe zum **Actions** Tab
2. Öffne den **"Deploy to GitHub Pages"** Run
3. Schau dir die Error-Details an

