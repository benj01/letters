// src/main.ts
import { Vec2 } from './physicsCore.js';
import { PhysicsEngine } from './physicsEngine.js';
import { Renderer } from './renderer.js';
import { letterShapes } from './letterShapes.js';

const canvasId = 'physicsCanvas';
const canvas = document.getElementById(canvasId) as HTMLCanvasElement;
if (!canvas) {
    throw new Error(`Canvas with id '${canvasId}' not found`);
}

// --- Initialize Canvas ---
const width = window.innerWidth;
const height = window.innerHeight;
canvas.width = width;
canvas.height = height;

// --- Initialize Physics Engine ---
const engine = new PhysicsEngine(width, height);
engine.gravity = new Vec2(0, 400);
engine.solverIterations = 6;
engine.bounceFactor = 0.3;
engine.drag = 0.02;

// --- Initialize Renderer ---
const renderer = new Renderer(canvasId, 12); // Letter stroke width = 12px

// --- Character Selection ---
// Curved characters (should maintain their shape well)
const CURVED_CHARS = ['O', 'S', 'C', 'G'];
// Straight/corner characters (using fallback generation)
const STRAIGHT_CHARS = ['A', 'E', 'F', 'H', 'I', 'K', 'L', 'M', 'N', 'T', 'V', 'W', 'X', 'Y', 'Z'];
// Mixed characters (complex shapes)
const MIXED_CHARS = ['B', 'D', 'P', 'Q', 'R', 'J', 'U'];
// Other characters (special cases)
const OTHER_CHARS = ['$', '?', '!', '+', '-', '='];

// Select a subset of characters to demonstrate different behaviors
const lettersToCreate = [
    ...CURVED_CHARS,           // All curved chars
    ...STRAIGHT_CHARS.slice(0, 5),  // First 5 straight chars
    ...MIXED_CHARS.slice(0, 3),     // First 3 mixed chars
    ...OTHER_CHARS.slice(0, 2)      // First 2 other chars
];

// --- Letter Creation ---
const startY = 50;
const LETTER_SPACING = 80; // Reduced spacing to fit more letters
let currentX = 50;

lettersToCreate.forEach((char, index) => {
    const shapeData = letterShapes[char];
    if (!shapeData) {
        console.warn(`No shape data found for character: ${char}`);
        return;
    }

    const uniqueId = `letter-${char}-${index}`;
    const points = shapeData.points.map(p => new Vec2(p.x, p.y));
    engine.createSoftBody(
        uniqueId,
        points,
        new Vec2(currentX, startY),
        shapeData.isLoop,
        shapeData.pinnedIndices || []
    );
    currentX += LETTER_SPACING;
    console.log(`Created ${char} with ${points.length} points. Loop: ${shapeData.isLoop}`);
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