// src/physicsEngine.ts
import { Vec2, Particle, Constraint, DistanceConstraint } from './physicsCore.js';

interface WorldBounds {
    min: Vec2;
    max: Vec2;
}

export interface SoftBody {
    id: string;
    particles: Particle[];
    constraints: Constraint[];
    isLoop: boolean; // For rendering hints
}

export class PhysicsEngine {
    private particles: Particle[] = [];
    private constraints: Constraint[] = [];
    private softBodies: Map<string, SoftBody> = new Map();
    private activeBodyIds: Set<string> = new Set();
    private timeStationary: Map<string, number> = new Map(); // Time spent nearly still

    // Configuration
    public gravity: Vec2 = new Vec2(0, 500); // Pixels/s^2
    public solverIterations: number = 8;
    public worldBounds: WorldBounds;
    public drag: number = 0.01; // Air resistance factor
    public bounceFactor: number = 0.5; // Energy retained on collision (0-1)
    public sleepThresholdSq: number = (0.5 * 0.5); // Squared pixel/second velocity to trigger sleep check
    public sleepTimeLimit: number = 1.0; // Seconds before sleeping

    constructor(width: number, height: number) {
        // Add a small padding to the bounds
        const padding = 5;
        this.worldBounds = {
            min: new Vec2(padding, padding),
            max: new Vec2(width - padding, height - padding)
        };
    }

    addParticle(p: Particle): Particle {
        this.particles.push(p);
        return p;
    }

    addConstraint(c: Constraint): Constraint {
        this.constraints.push(c);
        return c;
    }

    createSoftBody(id: string, points: Vec2[], position: Vec2, isLoop: boolean, pinnedIndices: number[] = [], structuralStiffness = 0.9, bendingStiffness = 0.1): SoftBody {
        if (this.softBodies.has(id)) {
            console.warn(`SoftBody with id ${id} already exists. Overwriting.`);
            // Ideally, remove old particles/constraints first
        }

        const bodyParticles: Particle[] = [];
        const bodyConstraints: Constraint[] = [];

        // 1. Add particles
        points.forEach((pt, index) => {
            const p = this.addParticle(new Particle(position.x + pt.x, position.y + pt.y));
            if (pinnedIndices.includes(index)) {
                p.pin();
            }
            bodyParticles.push(p);
        });

        // 2. Add structural constraints (p_i to p_{i+1})
        for (let i = 0; i < bodyParticles.length - 1; i++) {
            const p1 = bodyParticles[i];
            const p2 = bodyParticles[i + 1];
            const dist = p1.pos.sub(p2.pos).length();
            const constraint = new DistanceConstraint(p1, p2, dist, structuralStiffness);
            this.addConstraint(constraint);
            bodyConstraints.push(constraint);
        }
        // Close loop if needed
        if (isLoop && bodyParticles.length > 1) {
            const p1 = bodyParticles[bodyParticles.length - 1];
            const p2 = bodyParticles[0];
            const dist = p1.pos.sub(p2.pos).length();
            const constraint = new DistanceConstraint(p1, p2, dist, structuralStiffness);
            this.addConstraint(constraint);
            bodyConstraints.push(constraint);
        }

        // 3. Add bending constraints (p_i to p_{i+2})
        if (bendingStiffness > 0 && bodyParticles.length > 2) {
             const limit = isLoop ? bodyParticles.length : bodyParticles.length - 2;
             for (let i = 0; i < limit; i++) {
                const p1 = bodyParticles[i];
                const p3 = bodyParticles[(i + 2) % bodyParticles.length]; // Wrap around for loops
                const dist = p1.pos.sub(p3.pos).length();
                if (dist > 1e-4) { // Avoid zero-length constraints
                    const constraint = new DistanceConstraint(p1, p3, dist, bendingStiffness);
                    this.addConstraint(constraint);
                    bodyConstraints.push(constraint);
                }
            }
        }

        const softBody: SoftBody = { id, particles: bodyParticles, constraints: bodyConstraints, isLoop };
        this.softBodies.set(id, softBody);
        this.activeBodyIds.add(id);
        this.timeStationary.set(id, 0);

        console.log(`Created SoftBody '${id}' with ${bodyParticles.length} particles, ${bodyConstraints.length} constraints.`);
        return softBody;
    }


    update(dt: number): void {
        if (dt <= 0) return;

        const activeParticles = this.getActiveParticles();
        const activeConstraints = this.getActiveConstraints();

        // 1. Apply forces
        for (const p of activeParticles) {
            if (!p.isStatic) {
                p.addForce(this.gravity);
            }
        }

        // 2. Predict positions (Verlet integration)
        for (const p of activeParticles) {
            p.updatePosition(dt, this.drag);
        }

        // 3. Solve constraints iteratively (PBD)
        for (let i = 0; i < this.solverIterations; ++i) {
            for (const c of activeConstraints) {
                c.solve();
            }
            // Apply boundary constraints within the solver loop for stability
             this.applyBoundaryConstraints(activeParticles, dt);
        }

        // 4. Check for sleeping state
        this.updateSleepingState(dt);
    }

    private applyBoundaryConstraints(particlesToCheck: Particle[], dt: number): void {
        const { min, max } = this.worldBounds;
        for (const p of particlesToCheck) {
            if (p.isStatic) continue;

            const velocity = p.pos.sub(p.prevPos);
            let changed = false;

            if (p.pos.x < min.x) { p.pos.x = min.x; p.prevPos.x = p.pos.x + velocity.x * this.bounceFactor; changed = true; }
            if (p.pos.x > max.x) { p.pos.x = max.x; p.prevPos.x = p.pos.x + velocity.x * this.bounceFactor; changed = true; }
            if (p.pos.y < min.y) { p.pos.y = min.y; p.prevPos.y = p.pos.y + velocity.y * this.bounceFactor; changed = true; }
            if (p.pos.y > max.y) { p.pos.y = max.y; p.prevPos.y = p.pos.y + velocity.y * this.bounceFactor; changed = true; }
        }
    }

     private updateSleepingState(dt: number): void {
        const bodiesToSleep: string[] = [];
        const invDt = 1.0 / dt; // For velocity calculation

        this.activeBodyIds.forEach(id => {
            const body = this.softBodies.get(id);
            if (!body) return;

            let maxVelocitySq = 0;
            for (const p of body.particles) {
                if (!p.isStatic) {
                    const velocitySq = p.pos.sub(p.prevPos).lengthSq() * invDt * invDt;
                    if (velocitySq > maxVelocitySq) {
                        maxVelocitySq = velocitySq;
                    }
                }
            }

            if (maxVelocitySq < this.sleepThresholdSq) {
                const stationaryTime = (this.timeStationary.get(id) || 0) + dt;
                this.timeStationary.set(id, stationaryTime);
                if (stationaryTime > this.sleepTimeLimit) {
                    bodiesToSleep.push(id);
                }
            } else {
                this.timeStationary.set(id, 0); // Reset timer if moving
            }
        });

        // Put bodies to sleep
        bodiesToSleep.forEach(id => {
            this.activeBodyIds.delete(id);
            // console.log(`Body ${id} going to sleep`);
            // Optionally snap velocities to zero firmly
            // const body = this.softBodies.get(id);
            // body?.particles.forEach(p => { if (!p.isStatic) p.prevPos = p.pos.clone(); });
        });
    }

    wakeUpBody(id: string): void {
        if (this.softBodies.has(id) && !this.activeBodyIds.has(id)) {
            this.activeBodyIds.add(id);
            this.timeStationary.set(id, 0);
            // console.log(`Body ${id} woken up`);
        }
    }

    disturbArea(center: Vec2, radius: number): void {
        const radiusSq = radius * radius;
        this.softBodies.forEach((body, id) => {
            if (this.activeBodyIds.has(id)) return; // Already active

            for (const p of body.particles) {
                if (p.pos.sub(center).lengthSq() < radiusSq) {
                    this.wakeUpBody(id);
                    return; // Wake up this body and check the next one
                }
            }
        });
    }

    // Getters for rendering/debugging
    getAllSoftBodies(): Map<string, SoftBody> { return this.softBodies; }
    getActiveSoftBodyIds(): Set<string> { return this.activeBodyIds; }
    getParticles(): Particle[] { return this.particles; } // Use with caution, prefer body access

    private getActiveParticles(): Particle[] {
        const active: Particle[] = [];
        this.activeBodyIds.forEach(id => {
            const body = this.softBodies.get(id);
            if (body) active.push(...body.particles);
        });
        return active;
    }

     private getActiveConstraints(): Constraint[] {
        const active: Constraint[] = [];
        this.activeBodyIds.forEach(id => {
            const body = this.softBodies.get(id);
            if (body) active.push(...body.constraints);
        });
        return active;
    }
}