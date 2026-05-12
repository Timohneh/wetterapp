# 🔧 GitHub Pages Deploy Checklist

Verwende diese Checkliste, um den Deploy-Fehler zu beheben:

## ✅ Repository-Einstellungen

- [ ] Repository ist **public** (auf GitHub)
  - Wenn privat: Benötigt GitHub Pro für Pages
  
- [ ] Settings → Pages ist konfiguriert:
  - [ ] **Source** = "GitHub Actions" ← **KRITISCH!**
  
- [ ] GitHub Actions sind aktiviert:
  - [ ] Settings → Actions → "Allow all actions"

## ✅ Code-Status

- [ ] `.github/workflows/deploy.yml` existiert
- [ ] Alle Dateien sind gepusht:
  ```bash
  git status  # Keine uncommitted changes
  git push origin main
  ```

## ✅ Workflow überprüfen

1. Gehe zum **Actions** Tab in GitHub
2. Suche nach "Deploy to GitHub Pages"
3. Überprüfe den neuesten Run:
   - [ ] Status ist "completed" (oder "failed")
   - [ ] Klick drauf um Details zu sehen
   - [ ] Notiere Fehler-Meldung

## 🔴 Wenn immer noch Fehler auftritt

### Fehler: "Cannot find any run with github.run_id"
```
→ Source MUSS "GitHub Actions" sein
→ Nicht "Deploy from a branch" verwenden
```

Behebung:
1. Settings → Pages
2. Ändere Source zu **"GitHub Actions"**
3. Speichere
4. Mache einen neuen Push oder triggere Workflow manuell

### Fehler: "Failed to create deployment (status: 404)"
```
→ Normalerweise: GitHub Pages nicht aktiviert
→ Oder: Repository nicht public
```

Behebung:
1. Stelle sicher, Repository ist **public**
2. Settings → Pages → Source = "GitHub Actions"
3. Warte 2-3 Minuten
4. Versuche erneut

## 🟢 Wenn erfolgreich deployed

Du solltest sehen:
```
✅ Deploy to GitHub Pages (Status: Success)
   Your site is live at https://username.github.io/wetterapp/
```

## 🧪 Test lokal (falls Remote nicht funktioniert)

```bash
# Mit Python 3
python -m http.server 8000

# Oder mit Node.js
npx http-server

# Dann öffne: http://localhost:8000
```

Wenn lokal funktioniert aber nicht auf GitHub:
→ Das Problem ist die GitHub Pages Konfiguration, nicht der Code!

## 📞 Manuelle Trigger (wenn Auto-Deploy fehlschlägt)

1. Gehe zu GitHub → **Actions** Tab
2. Wähle **"Deploy to GitHub Pages"** Workflow
3. Klick **"Run workflow"**
4. Wähle **main** Branch
5. Klick **"Run workflow"**

---

**Brauchst du weitere Hilfe?**
- Überprüfe die [GITHUB_PAGES_SETUP.md](GITHUB_PAGES_SETUP.md) für detaillierte Anleitung
- Schau in Actions → Workflow Run für Error-Messages
