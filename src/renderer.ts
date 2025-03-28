// src/renderer.ts
import { PhysicsEngine, SoftBody } from './physicsEngine.js';
import { Particle } from './physicsCore.js';

export class Renderer {
    private canvas: HTMLCanvasElement;
    private ctx: CanvasRenderingContext2D;
    private letterWidth: number;
    private activeColor: string = '#3366cc';
    private sleepingColor: string = '#aabbdd';
    private pinnedColor: string = '#cc3333';
    private particleRadius: number = 2; // For drawing pinned points

    constructor(canvasId: string, letterWidth: number) {
        this.canvas = document.getElementById(canvasId) as HTMLCanvasElement;
        if (!this.canvas) throw new Error(`Canvas element with id "${canvasId}" not found.`);
        this.ctx = this.canvas.getContext('2d')!;
        if (!this.ctx) throw new Error("Could not get 2D context");
        this.letterWidth = letterWidth;
    }

    resize(width: number, height: number) {
        this.canvas.width = width;
        this.canvas.height = height;
    }

    clear() {
        this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
        // Optional: Draw background or bounds
        // this.ctx.strokeStyle = '#eee';
        // this.ctx.strokeRect(0, 0, this.canvas.width, this.canvas.height);
    }

    draw(engine: PhysicsEngine) {
        this.clear();
        const allBodies = engine.getAllSoftBodies();
        const activeIds = engine.getActiveSoftBodyIds();

        allBodies.forEach((body, id) => {
            const isActive = activeIds.has(id);
            this.drawSoftBody(body, isActive);
        });
    }

    private drawSoftBody(body: SoftBody, isActive: boolean) {
        if (body.particles.length < 1) return;

        const color = isActive ? this.activeColor : this.sleepingColor;
        this.ctx.strokeStyle = color;
        this.ctx.lineWidth = this.letterWidth;
        this.ctx.lineCap = 'round';
        this.ctx.lineJoin = 'round';

        // Draw the spine path
        this.ctx.beginPath();
        this.ctx.moveTo(body.particles[0].pos.x, body.particles[0].pos.y);
        for (let i = 1; i < body.particles.length; i++) {
            this.ctx.lineTo(body.particles[i].pos.x, body.particles[i].pos.y);
        }
        if (body.isLoop) {
            this.ctx.closePath();
        }
        this.ctx.stroke();

        // Optionally draw points for pinned particles
        this.ctx.fillStyle = this.pinnedColor;
        body.particles.forEach(p => {
            if (p.isStatic) { // Only draw explicitly pinned ones, not just sleeping
                 this.ctx.beginPath();
                 this.ctx.arc(p.pos.x, p.pos.y, this.particleRadius, 0, Math.PI * 2);
                 this.ctx.fill();
            }
        });
    }
}