# Allowance

Family chore + allowance tracker. Self-hosted on the Mac mini, LAN-only.

## Foundation (this checkpoint)

Just the SvelteKit + Tailwind + Drizzle scaffold. No DB yet, no auth, no real screens — just `npm run dev` boots a placeholder page.

### Run it

```powershell
cd H:\dev\allowance
npm install
copy .env.example .env
npm run dev
```

Then open http://localhost:5173. You should see "Allowance / Project scaffolded."

The dev server also binds to `0.0.0.0` so you can reach it from other devices on the LAN at `http://<your-pc-ip>:5173`.

## Stack

- SvelteKit + Node adapter
- TypeScript
- SQLite via better-sqlite3, Drizzle ORM
- TailwindCSS
- Self-hosted on Mac mini (eventually); LAN-only auth

## Architecture decisions (locked, see memory)

- Pure chores model, weekly payout = kid's age in dollars conditional on responsibility
- Per-chore expiry rule (vanish or roll-forward)
- Kid mid-week sees "On track" or "N chores behind" — no live $ amount
- Append-only ledger; debit descriptions visible to kid
- Piggy bank physically holds cash equal to app balance
- Either parent device approves, no coordination UI
- **Parent phones:** regular PWA + web push
- **Kid Fire tablets:** WebView wrapper APK with local AlarmManager notifications (Silk push doesn't work on Fire OS)

## Wishlist (deferred)

- **Profile icons for everyone** — emoji picker for each person, displayed on tiles, headers, and the claim screen. Schema already has `persons.avatar_url`. Build after launch.

## Roadmap

- [x] Project scaffold
- [ ] Database schema (families, persons, chores, chore_instances, payout_cycles, ledger_entries, devices, push_subscriptions)
- [ ] First migration + seed for dev
- [ ] Onboarding: create family, add kids with birthdates, claim devices
- [ ] Parent PIN auth + session cookies
- [ ] Chore admin (CRUD with recurrence + expiry rule)
- [ ] Daily chore instance generation
- [ ] Kid home view (today's chores + "on track / N behind")
- [ ] Mark-done flow → parent approval queue
- [ ] Sunday review screen (one-tap payout per kid)
- [ ] Debit recording with descriptions
- [ ] History views (kid + parent)
- [ ] Web push for parents
- [ ] Nightly JSON backup of the ledger
- [ ] Wrapper APK template for kid tablets
- [ ] Mac mini deploy (git remote + post-receive hook + PM2)
