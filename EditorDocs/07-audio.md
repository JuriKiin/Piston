# Audio

Sound goes through the engine's **audio service**, available as `Piston.audio`. Game code and components never use the browser's audio API directly, which is what lets other platforms supply their own.

## Overlapping sounds
Every play starts its **own voice**. Many sounds, and many copies of the same clip, play together without cutting each other off. A single clip is capped at 16 simultaneous copies; past that the oldest copy stops, so rapid repeats cannot pile up forever. Clips are loaded and decoded once, then shared.

## Buses
Sounds belong to a **bus**: `sfx`, `music` or `ui`. All sit under a `master` bus. Each has a volume and a mute.

```js
Piston.audio.setBusVolume('music', 0.4);
Piston.audio.setBusMuted('sfx', true);
Piston.audio.stopAll('sfx');
```

## Playing from code
```js
const voice = Piston.audio.play('./assets/hit.wav', { volume: 0.8, bus: 'sfx', pitch: 1.2 });
voice.setVolume(0.5);
voice.stop();
```

## The AudioSource component
Put **AudioSource** on an entity to play from it. Fields: Clip (file chooser), Volume, Pitch, Bus, Loop, Allow overlap, Play On Start.

```js
const src = entity.getComponent(AudioSource);
src.play();                                              // its own clip
src.playOneShot('./assets/pop.wav', { volume: 0.6 });    // another clip through the same bus
src.stop();                                              // stops every voice this source started
```
Turn **Allow overlap** off to make a source restart instead of layering, for example a looping engine hum.

## Browsers and autoplay
Browsers only allow sound after the player has clicked or pressed a key. The engine unlocks audio on the first gesture automatically, so a sound requested earlier simply starts once the page is allowed to make noise.

## Formats
Use `.wav`, `.mp3`, `.ogg` or `.m4a`. Keep short effects as `.wav` or `.ogg`.
