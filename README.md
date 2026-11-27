# Spillerstatistikk ishockey

Viser kamper, mål, assist, poeng, +/−, utvisningsminutter og skudd for en spiller fra live.hockey.no,
basert på en `playerId` eller en spillerlenke.

React + Vite + TypeScript + Tailwind.

## Utvikling

```bash
npm install
npm run dev
```

I dev går API-kall via Vite-proxyen (`/api`), se `vite.config.ts`.

## Produksjon

API-et (`sf34-terminlister-prod-app.azurewebsites.net`) tillater kun CORS fra `https://live.hockey.no`,
så GitHub Pages-versjonen går via en Cloudflare Worker (`worker/`).

1. Deploy workeren:
   ```bash
   cd worker
   npx wrangler login
   npx wrangler deploy
   ```
   Noter URL-en, f.eks. `https://playerstats-proxy.<konto>.workers.dev`.
2. Sett worker-URL-en i `.env.production` (eller som Actions-variabel `API_BASE`, som overstyrer).
3. *Settings → Pages* → *Source: GitHub Actions*.
4. Push til `main` (eller kjør workflowen manuelt) for å bygge og deploye.

Tillatte origins for workeren settes i `worker/wrangler.toml` (`ALLOWED_ORIGINS`).
