// src/physicsCore.ts

/** Basic 2D Vector class */
export class Vec2 {
    x: number;
    y: number;

    constructor(x = 0, y = 0) {
        this.x = x;
        this.y = y;
    }

    add(v: Vec2): Vec2 { return new Vec2(this.x + v.x, this.y + v.y); }
    sub(v: Vec2): Vec2 { return new Vec2(this.x - v.x, this.y - v.y); }
    mul(scalar: number): Vec2 { return new Vec2(this.x * scalar, this.y * scalar); }
    div(scalar: number): Vec2 {
        if (scalar === 0) return new Vec2();
        return new Vec2(this.x / scalar, this.y / scalar);
    }
    length(): number { return Math.sqrt(this.x * this.x + this.y * this.y); }
    lengthSq(): number { return this.x * this.x + this.y * this.y; }
    normalize(): Vec2 {
        const len = this.length();
        return len === 0 ? new Vec2() : this.div(len);
    }
    clone(): Vec2 { return new Vec2(this.x, this.y); }
}

/** Represents a point mass in the simulation */
export class Particle {
    pos: Vec2;
    prevPos: Vec2;
    acc: Vec2;
    mass: number;
    invMass: number; // Inverse mass (1/mass). 0 for static/infinite mass objects.
    isStatic: boolean;
    id: number; // Unique ID for potential debugging/tracking

    private static nextId = 0;

    constructor(x: number, y: number, mass = 1) {
        this.id = Particle.nextId++;
        this.pos = new Vec2(x, y);
        this.prevPos = new Vec2(x, y); // For Verlet integration
        this.acc = new Vec2();
        this.mass = mass;
        this.invMass = mass === 0 ? 0 : 1 / mass;
        this.isStatic = mass === 0;
    }

    updatePosition(dt: number, drag: number) {
        if (this.isStatic) return;

        // Verlet integration
        const velocity = this.pos.sub(this.prevPos).mul(1.0 - drag); // Apply drag
        this.prevPos = this.pos.clone();
        this.pos = this.pos.add(velocity).add(this.acc.mul(dt * dt));

        // Reset acceleration
        this.acc = new Vec2();
    }

    addForce(force: Vec2) {
        if (this.isStatic) return;
        // F = ma => a = F/m = F * invMass
        this.acc = this.acc.add(force.mul(this.invMass));
    }

    applyCorrection(correction: Vec2, weight = 1.0) {
         if (this.isStatic) return;
         this.pos = this.pos.add(correction.mul(weight * this.invMass));
    }

    pin() {
        this.isStatic = true;
        this.invMass = 0;
        this.mass = 0;
    }
}

/** Interface for all constraints */
export interface Constraint {
    solve(): void;
    getP1(): Particle;
    getP2(): Particle | null; // Some constraints might only involve one particle (e.g., pinning)
}

/** Maintains a fixed distance between two particles */
export class DistanceConstraint implements Constraint {
    p1: Particle;
    p2: Particle;
    restLength: number;
    stiffness: number; // How strongly the constraint is enforced per iteration (0 to 1)

    constructor(p1: Particle, p2: Particle, restLength: number, stiffness = 0.5) {
        this.p1 = p1;
        this.p2 = p2;
        this.restLength = restLength;
        this.stiffness = stiffness;
    }

    solve(): void {
        const delta = this.p2.pos.sub(this.p1.pos);
        const currentLengthSq = delta.lengthSq();
        if (currentLengthSq < 1e-9) return; // Avoid division by zero / instability

        const currentLength = Math.sqrt(currentLengthSq);
        const error = currentLength - this.restLength;

        // Avoid division by zero if length is very small
        if (currentLength < 1e-6) return;

        const direction = delta.div(currentLength);

        const totalInvMass = this.p1.invMass + this.p2.invMass;
        if (totalInvMass === 0) return; // Both particles are static

        // Calculate correction magnitude, scaled by stiffness and inverse masses
        const scalar = error / totalInvMass * this.stiffness;
        const correctionVec = direction.mul(scalar);

        // Apply corrections weighted by inverse mass
        this.p1.applyCorrection(correctionVec, this.p1.invMass);
        this.p2.applyCorrection(correctionVec.mul(-1), this.p2.invMass);
    }

     getP1(): Particle { return this.p1; }
     getP2(): Particle | null { return this.p2; }
}