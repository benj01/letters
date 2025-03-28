// src/main.ts
import { PhysicsEngine } from './physicsEngine.js';
import { Renderer } from './renderer.js';
import { letterShapes } from './letterShapes.js';
import { Vec2 } from './physicsCore.js';

const canvasId = 'physicsCanvas';
const canvas = document.getElementById(canvasId) as HTMLCanvasElement;
if (!canvas) throw new Error(`Canvas element with id "${canvasId}" not found.`);

const width = 800;
const height = 600;
canvas.width = width;
canvas.height = height;

const engine = new PhysicsEngine(width, height);
const renderer = new Renderer(canvasId, 12); // Letter stroke width = 12px

// --- Simulation Parameters ---
engine.gravity = new Vec2(0, 400);
engine.solverIterations = 6;
engine.bounceFactor = 0.3;
engine.drag = 0.02;

// --- Create Letter Bodies ---
const startY = 50;
const spacingX = 80;
let currentX = 50;

const lettersToCreate = ['L', 'O', 'C', 'S', 'I'];

lettersToCreate.forEach(char => {
    if (letterShapes[char]) {
        const shape = letterShapes[char];
        engine.createSoftBody(
            `${char}-${currentX}`, // Unique ID
            shape.points.map(p => new Vec2(p.x, p.y)), // Convert points to Vec2
            new Vec2(currentX, startY),
            shape.isLoop,
            shape.pinnedIndices || []
        );
        currentX += spacingX;
    }
});

// --- Mouse Interaction ---
canvas.addEventListener('mousedown', (event) => {
    const rect = canvas.getBoundingClientRect();
    const mouseX = event.clientX - rect.left;
    const mouseY = event.clientY - rect.top;
    const clickPos = new Vec2(mouseX, mouseY);
    const disturbRadius = 50; // Wake up bodies within this radius

    console.log(`Click at (${mouseX}, ${mouseY}), disturbing radius ${disturbRadius}`);
    engine.disturbArea(clickPos, disturbRadius);

    // Optional: Add a temporary upward force
    // engine.getActiveParticles().forEach(p => {
    //    const distSq = p.pos.sub(clickPos).lengthSq();
    //    if (distSq < disturbRadius * disturbRadius) {
    //        const forceMag = 30000 * (1 - Math.sqrt(distSq) / disturbRadius);
    //        const forceDir = p.pos.sub(clickPos).normalize();
    //        p.addForce(forceDir.mul(forceMag));
    //    }
    // });
});


// --- Animation Loop ---
let lastTime = 0;
const fixedDeltaTime = 1 / 60; // Target 60 FPS physics updates

function animate(currentTime: number) {
    requestAnimationFrame(animate);

    const elapsed = (currentTime - (lastTime || currentTime)) / 1000; // Time in seconds
    lastTime = currentTime;

    // Use fixed time step for physics stability
    // Accumulate time and run fixed updates
    // Note: Simple version without accumulation for clarity
    const dt = fixedDeltaTime; // Use fixed step directly
    // const dt = Math.min(elapsed, fixedDeltaTime * 3); // Or clamp variable step

    engine.update(dt);
    renderer.draw(engine);
}

// Start the simulation
console.log("Starting simulation...");
requestAnimationFrame(animate);