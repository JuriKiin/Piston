# Neon Warden: boss balance pass

**No human played this.** Everything below comes from a scripted bot (`bench/bot.js`), so it says how an imperfect machine player fares, not how a person feels it. Expect a human to find it different, probably harder in the first tries and easier once the patterns are learned.

## The complaint and what could be reproduced
The report was a boss phase with about 300 magenta orbs on screen at 0:29. The bot could not reproduce a count anywhere near that: before this pass, a bot that never shot and only dodged (immortal, 90 s) saw 45-59 orbs at its peak and about 24 on average. So the exact screenshot is unexplained (a debug jump, a different build or a stress script are possible); the pass below targets the design problem instead: eleven segments fired independently with no telegraph, so volleys overlapped unpredictably, and nothing limited the count.

## What changed (Boss.js, Enemies.js, Projectiles.js)
* **One volley at a time.** Segments no longer fire on their own timers. The Warden picks one segment (two in phase 3) every 2.2 / 1.7 / 1.35 s; the chosen segment pulses and brightens for 0.9 s, then fires one ring of 7 / 8 / 9 orbs.
* **Slower, sparser orbs.** Ring speed 150 / 170 / 195 (was 250). Head fan: 3 / 4 / 5 orbs (was 5 / 7), speed 240 / 270 / 300 (was 360), a 0.55 s telegraph (head flashes and snarls) before it fires, every 3.2 / 2.7 / 2.3 s (was 2.0-2.8 s, shortened by aggression).
* **Hard cap on live orbs** per phase: 32 / 44 / 56 (`Orb.cap`; `Orb.spawn` returns null beyond it). The shockwave ring is every 8-10 s and the laser every 10-13 s, both already telegraphed.
* **Longer fight so the lower density still tests the player.** Warden HP 60 to 150, segments 5 to 8, tail 8 to 12. (With sparse patterns and the old HP a decent bot won 93 % in 30 s.)
* Turrets: fan speed 340 to 250, cooldown 1.6-2.8 s (was 1.0-2.0).

## The bot (`bench/bot.js`)
Decides only every ~0.22 s (randomised), sees orbs with 18 px of position noise and only within 300 px, picks one of 16 move directions plus "stay" by simulating 0.55 s ahead against straight-line orb paths, makes a random move 8 % of the time, dashes when it predicts a hit (60 % of the time), aims at the Warden's head with a lagging, wobbling cursor, and only holds the trigger a fraction of the time. The player is **not** invulnerable (5 HP). Each fight starts at the boss with full HP (waves skipped), on a fake clock with rendering and audio off.

## Results (30 fights each, boss phase only)
| Bot | Win rate | Avg time on win | Avg of per-fight peak live orbs | Avg live orbs | Avg hits taken |
|---|---|---|---|---|---|
| "Decent" (fires 60 %, aim noise 0.2 rad, reaction 0.22 s), seed 1 | **40 %** | 43 s | 26 | 8.5 | 3.8 |
| same, seed 2 | **57 %** | 43 s | 26 | 8.4 | 3.8 |
| Weak (fires 40 %, aim noise 0.3, reaction 0.3 s) | 0 % | n/a | 30 | 10 | 4.0 |
| Strong (fires 90 %, aim noise 0.1, reaction 0.15 s) | 93 % | 29 s | 27 | 8.8 | 2.8 |

Before the pass (same bot family, old patterns): fires 35 %, aim 0.25: 50 % win (6 fights, peak 38 orbs); fires 15 %, aim 0.35: 0 % (peak 49); a near-perfect shooter won 100 % in 14 s. Intermediate step (patterns retuned, old HP): decent bot 100 % and 85 %.

Caveats: 30 fights give a win-rate error of about +-18 points; the bot dodges better than most people in some ways (it sees every orb velocity exactly) and worse in others (no anticipation of telegraphs, no use of the dash for offence); the waves before the boss were not part of the test.
