# Investor AI — V1

Aktsiate ja fondide jälgija + portfell. Next.js + Supabase + Alpha Vantage.

## 1. Supabase seadistamine

1. Mine [supabase.com](https://supabase.com) ja loo uus projekt (eraldi projekt, mitte teacher-ai oma)
2. Ava **Authentication → Providers** ja lülita sisse **Email** (parooliga sisselogimine)
3. Ava **SQL Editor** ja käivita `supabase/schema.sql` sisu
   - Kui sul on juba vana V1 andmebaas (ilma kasutajateta), käivita hoopis `supabase/migrate-multitenant.sql`
4. Mine **Settings > API** ja kopeeri `Project URL` ning `anon public` võti

## 2. Alpha Vantage võti

Kui sul juba pole: [alphavantage.co/support/#api-key](https://www.alphavantage.co/support/#api-key) — tasuta, kohe kasutatav.

## 3. Kohalik käivitamine

```bash
npm install
cp .env.example .env.local
# täida .env.local väärtused Supabase ja Alpha Vantage andmetega
npm run dev
```

Ava [http://localhost:3000](http://localhost:3000)

## 4. GitHubi ja Vercelisse

```bash
git init
git add .
git commit -m "Investor AI V1"
gh repo create investor-ai --private --source=. --push
```

Seejärel Vercelis: **New Project** → vali see repo → **Environment Variables** alla lisa samad kolm muutujat, mis `.env.local`-is → Deploy.

## Mida see V1 juba teeb

- Sisselogimine (Supabase Auth): iga kasutaja näeb ainult oma andmeid
- Jälgimisnimekiri: lisa/eemalda sümboleid, päris hinnad, salvestatud Supabasesse (kasutajapõhine + RLS)
- Portfell: osalused (kogus + ostuhind), automaatne kasum/kahjumi arvestus
- AI vestlus: isiklikud vestlused (Supabase + RLS), mobiilis hamburger-menüü

## Järgmine samm (V2)

Vaata `investor-app-spec.md` — järgmisena tuleb "Analüüs" sakk ühe aktsia süvavaatega (fundamentaalid + tehnika + uudised).

**Tähtis piirang:** Alpha Vantage tasuta tase lubab 25 päringut päevas. Kui watchlist/portfell kasvab suureks, tasub kaaluda tasulist taset või päringute vahemällu salvestamist (cache).

**Soovitus:** `/api/chat` on endiselt sessioonita (sõnumid tulevad päringu kehas). Kui tahad kvoodi/kiirusepiirangut kasutaja kaupa, lisa API-le Bearer tokeni kontroll.
