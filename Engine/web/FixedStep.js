/**
 * Fixed-timestep accumulator. The game loop feeds it the real time of each display frame and it answers "how many simulation steps
 * of exactly `step` seconds should run now". Simulation speed is therefore independent of the display refresh rate: a 144 Hz
 * monitor runs about 2.4 display frames per step, a 30 Hz one runs 2 steps per display frame, and the world advances the same.
 *
 * Two practical details:
 *  - Frame times that are within `snap` (default 5 %) of a whole number of steps are treated as exactly that number. A 60 Hz display
 *    delivers 16.7 +/- 1 ms, and without this a 60 Hz sim on a 60 Hz display would run 0 or 2 steps now and then (visible stutter).
 *  - A stall (tab switch, breakpoint, GC) runs at most `maxSteps` steps and drops the rest, so the game never tries to "catch up".
 */
export class FixedStep {
    constructor({ hz = 60, maxSteps = 5, snap = 0.05 } = {}) {
        this.maxSteps = maxSteps;
        this.snap = snap;
        this.accumulator = 0;
        this.setRate(hz);
    }

    /** Simulation rate in steps per second (clamped to 1..1000). */
    setRate(hz) {
        const v = Number(hz);
        this.hz = Number.isFinite(v) ? Math.min(1000, Math.max(1, v)) : 60;
        this.step = 1 / this.hz;
    }

    /** Forgets accumulated time (call while paused/editing and on scene loads so no burst of steps follows). */
    reset() { this.accumulator = 0; }

    /** Adds `seconds` of real time and returns how many fixed steps to run (0..maxSteps). */
    advance(seconds) {
        let dt = Number.isFinite(seconds) && seconds > 0 ? seconds : 0;
        const ratio = dt / this.step, whole = Math.round(ratio);
        if (whole >= 1 && Math.abs(ratio - whole) < this.snap) dt = whole * this.step;
        this.accumulator += dt;
        let steps = 0;
        while (this.accumulator >= this.step - 1e-9 && steps < this.maxSteps) { this.accumulator -= this.step; steps++; }
        if (this.accumulator >= this.step - 1e-9) this.accumulator = 0; // over the cap: drop the backlog
        if (this.accumulator < 0) this.accumulator = 0;
        return steps;
    }
}
