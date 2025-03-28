// scripts/generateShapes.ts
import * as opentype from 'opentype.js';
import fs from 'fs';
import path from 'path';
// NOTE: Vec2 from physicsCore isn't strictly needed here if we use the local Point class.
// import { Vec2 } from '../src/physicsCore';
import simplify from 'simplify-js'; // Ensure you have created src/types/declarations.d.ts

// Helper Point class for vector math within this script
class Point {
    constructor(public x: number = 0, public y: number = 0) {}
    add(p: Point) { return new Point(this.x + p.x, this.y + p.y); }
    sub(p: Point) { return new Point(this.x - p.x, this.y - p.y); }
    mul(scalar: number) { return new Point(this.x * scalar, this.y * scalar); }
    div(scalar: number) { return new Point(this.x / scalar, this.y / scalar); }
    magSq() { return this.x * this.x + this.y * this.y; }
    mag() { return Math.sqrt(this.magSq()); }
    normalize() { const m = this.mag(); return m === 0 ? new Point() : this.div(m); }
    distSq(p: Point) { const dx = this.x - p.x; const dy = this.y - p.y; return dx * dx + dy * dy; }
    dist(p: Point) { return Math.sqrt(this.distSq(p)); }
    dot(p: Point) { return this.x * p.x + this.y * p.y; }
    // Rotate by 90 degrees (for normal approximation)
    perp() { return new Point(-this.y, this.x); }
}

// Interface defining the structure of the output data
interface SoftBodyData {
    points: { x: number; y: number }[]; // Use plain objects for final output
    isLoop: boolean;
    pinnedIndices?: number[];
}

// --- Configuration ---
const TARGET_CHARS = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789$!?+-=";
// !!! IMPORTANT: Make sure this path points to your actual font file !!!
const FONT_PATH = path.resolve(__dirname, '../fonts/Roboto-Regular.ttf'); // <--- ADJUST FONT PATH
// Output file path
const OUTPUT_PATH = path.resolve(__dirname, '../src/letterShapes.ts');
// Parameters for generation (tune these)
const TARGET_HEIGHT = 100; // Target pixel height for scaling font units
const POINTS_PER_UNIT_LENGTH = 0.1; // Density of sampling on outline (relative to ORIGINAL font units)
const SIMPLIFICATION_TOLERANCE = 2.0; // RDP simplification tolerance (in scaled pixels)
const AVG_STROKE_WIDTH_GUESS = 15; // Heuristic guess for stroke width (in scaled pixels)

// --- Helper Functions --- (samplePathCommands, calculateNormals, findOppositePointIndex, orderPoints - unchanged from previous version)

/**
 * Samples points densely along OpenType path commands.
 * @param commands - Array of path commands from opentype.js
 * @param pointsPerUnitLength - Desired density of points (relative to command coordinates)
 * @returns An array of contours, where each contour is an array of Point instances.
 */
function samplePathCommands(commands: opentype.PathCommand[], pointsPerUnitLength: number): Point[][] {
    const contours: Point[][] = [];
    let currentContour: Point[] = [];
    let currentPos = new Point();
    let startPos = new Point(); // Keep track of the start of the current contour

    for (const cmd of commands) {
        switch (cmd.type) {
            case 'M': // MoveTo
                if (currentContour.length > 0) {
                    contours.push(currentContour);
                }
                currentContour = [];
                currentPos = new Point(cmd.x, cmd.y);
                startPos = currentPos; // Store the start position
                currentContour.push(currentPos);
                break;
            case 'L': // LineTo
                {
                    if (currentContour.length === 0) currentContour.push(currentPos); // Ensure start point is added
                    const targetPos = new Point(cmd.x, cmd.y);
                    // Calculate length based on CURRENT command coordinates
                    const segmentVec = targetPos.sub(currentPos);
                    const length = segmentVec.mag();
                    // Use length relative to current coords for numSamples
                    const numSamples = Math.max(1, Math.ceil(length * pointsPerUnitLength));
                    for (let i = 1; i <= numSamples; i++) {
                        currentContour.push(currentPos.add(segmentVec.mul(i / numSamples)));
                    }
                    currentPos = targetPos;
                }
                break;
            case 'C': // BezierCurveTo (Cubic)
                {
                     if (currentContour.length === 0) currentContour.push(currentPos); // Ensure start point is added
                    const p1 = new Point(cmd.x1, cmd.y1);
                    const p2 = new Point(cmd.x2, cmd.y2);
                    const p3 = new Point(cmd.x, cmd.y);
                    const p0 = currentPos;
                    // Estimate curve length (approximation using current coords)
                    const chord = p3.sub(p0).mag();
                    const controlNet = p1.sub(p0).mag() + p2.sub(p1).mag() + p3.sub(p2).mag();
                    const length = (chord + controlNet) / 2;
                    const numSamples = Math.max(1, Math.ceil(length * pointsPerUnitLength));
                    for (let i = 1; i <= numSamples; i++) {
                        const t = i / numSamples;
                        const it = 1 - t;
                        const b0 = it * it * it;
                        const b1 = 3 * it * it * t;
                        const b2 = 3 * it * t * t;
                        const b3 = t * t * t;
                        const pt = p0.mul(b0).add(p1.mul(b1)).add(p2.mul(b2)).add(p3.mul(b3));
                        currentContour.push(pt);
                    }
                    currentPos = p3;
                }
                break;
            case 'Q': // QuadraticCurveTo
                 {
                    if (currentContour.length === 0) currentContour.push(currentPos); // Ensure start point is added
                    const p1 = new Point(cmd.x1, cmd.y1);
                    const p2 = new Point(cmd.x, cmd.y);
                    const p0 = currentPos;
                    // Estimate curve length (using current coords)
                    const chord = p2.sub(p0).mag();
                    const controlNet = p1.sub(p0).mag() + p2.sub(p1).mag();
                    const length = (chord + controlNet) / 2;
                    const numSamples = Math.max(1, Math.ceil(length * pointsPerUnitLength));
                    for (let i = 1; i <= numSamples; i++) {
                        const t = i / numSamples;
                        const it = 1 - t;
                        const b0 = it * it;
                        const b1 = 2 * it * t;
                        const b2 = t * t;
                        const pt = p0.mul(b0).add(p1.mul(b1)).add(p2.mul(b2));
                        currentContour.push(pt);
                    }
                    currentPos = p2;
                }
                break;
            case 'Z': // ClosePath
                 if (currentContour.length > 0) {
                    // Connect back to start if not already close (using current coords)
                    if (currentPos.distSq(startPos) > 0.01) {
                        const segmentVec = startPos.sub(currentPos);
                        const length = segmentVec.mag();
                         const numSamples = Math.max(1, Math.ceil(length * pointsPerUnitLength));
                        for (let i = 1; i <= numSamples; i++) {
                            currentContour.push(currentPos.add(segmentVec.mul(i / numSamples)));
                        }
                    }
                    // Ensure the very first point isn't duplicated at the end if it's a loop
                     if (currentContour.length > 1 && currentContour[0].distSq(currentContour[currentContour.length - 1]) < 0.01) {
                        currentContour.pop();
                    }
                    contours.push(currentContour);
                    currentContour = []; // Start a new contour if more commands follow
                }
                currentPos = startPos; // Reset position
                break;
        }
    }
    // Add the last contour if it wasn't explicitly closed
    if (currentContour.length > 0) {
        contours.push(currentContour);
    }

    // Filter out tiny or degenerate contours
    return contours.filter(c => c.length > 2);
}

/**
 * Calculates approximate vertex normals for a polyline (contour).
 * (No changes needed in this function)
 */
function calculateNormals(points: Point[]): Point[] {
    const normals: Point[] = [];
    const n = points.length;
    if (n < 2) return [];
    const isClosed = n > 2 && points[0].distSq(points[n - 1]) < 0.01;

    for (let i = 0; i < n; i++) {
        const p_curr = points[i];
        const p_prev = points[(i - 1 + n) % n];
        const p_next = points[(i + 1) % n];

        let vec1: Point, vec2: Point;

         if (!isClosed && i === 0) {
            vec1 = p_next.sub(p_curr).normalize();
            vec2 = vec1;
        } else if (!isClosed && i === n - 1) {
            vec1 = p_curr.sub(p_prev).normalize();
            vec2 = vec1;
        } else {
             vec1 = p_curr.sub(p_prev).normalize();
             vec2 = p_next.sub(p_curr).normalize();
        }

        if (vec1.magSq() < 1e-9) vec1 = vec2;
        if (vec2.magSq() < 1e-9) vec2 = vec1;
         if (vec1.magSq() < 1e-9 && vec2.magSq() < 1e-9) {
             normals.push(new Point(0, 1));
             continue;
         }

        const n1 = vec1.perp();
        const n2 = vec2.perp();
        let normal = n1.add(n2).normalize();

        if (normal.magSq() < 0.1) {
           normal = n1;
           if (normal.magSq() < 0.1) {
                normal = new Point(0, 1);
           }
        }
        if (isNaN(normal.x) || isNaN(normal.y)) {
             console.warn("NaN detected during normal calculation, using fallback.");
             normal = new Point(0, 1);
        }
        normals.push(normal);
    }
    return normals;
}


/**
 * Finds a plausible "opposite" point on the same contour.
 * (No changes needed in this function)
 */
function findOppositePointIndex(currentIndex: number, points: Point[], normals: Point[], strokeWidthGuess: number): number {
    const p_i = points[currentIndex];
    const n_i = normals[currentIndex];
    const n = points.length;
    let bestMatchIndex = -1;
    let bestScore = -Infinity;

    const searchSkip = Math.max(5, Math.floor(n * 0.1));
    const minDistSq = (strokeWidthGuess * 0.2) ** 2;
    const maxDistSq = (strokeWidthGuess * 2.5) ** 2;

    for (let offset = searchSkip; offset <= n - searchSkip; offset++) {
       const j = (currentIndex + offset) % n;
       if (j === currentIndex) continue;

        const p_j = points[j];
        const distSq = p_i.distSq(p_j);

        if (distSq > maxDistSq || distSq < minDistSq) {
            continue;
        }

        const n_j = normals[j];
        const normalDot = n_i.dot(n_j);

        const distanceFactor = 1.0 - Math.abs(Math.sqrt(distSq) - strokeWidthGuess) / strokeWidthGuess;
        const normalFactor = (-normalDot + 1) / 2;
        const score = (normalFactor * 0.7) + (distanceFactor * 0.3);

         if (normalDot < 0.0 && score > bestScore) {
            bestScore = score;
            bestMatchIndex = j;
        }
    }

     if (bestMatchIndex === -1 && n > 10) {
         const fallbackIndex = (currentIndex + Math.floor(n / 2)) % n;
         const distSqFallback = p_i.distSq(points[fallbackIndex]);
         if (distSqFallback < maxDistSq * 2 && distSqFallback > minDistSq * 0.5) {
            bestMatchIndex = fallbackIndex;
         }
     }
    return bestMatchIndex;
}

/**
 * Orders a list of potentially unordered points using a nearest-neighbor approach.
 * (No changes needed in this function)
 */
function orderPoints(points: Point[]): Point[] {
    if (points.length < 2) return points;

    const ordered: Point[] = [];
    const remaining = new Set<number>(points.map((p, i) => i));
    let currentIdx = 0;

    ordered.push(points[currentIdx]);
    remaining.delete(currentIdx);

    while (remaining.size > 0) {
        let nearestDistSq = Infinity;
        let nearestIdx = -1;
        const currentPoint = points[currentIdx];

        for (const idx of remaining) {
            const distSq = currentPoint.distSq(points[idx]);
            if (distSq < nearestDistSq) {
                nearestDistSq = distSq;
                nearestIdx = idx;
            }
        }

        if (nearestIdx !== -1) {
            currentIdx = nearestIdx;
            ordered.push(points[currentIdx]);
            remaining.delete(currentIdx);
        } else {
            console.warn("Ordering failed to find nearest point. Remaining:", remaining.size);
            break;
        }
    }
    return ordered;
}


// --- Main Generation Logic ---
async function generateShapes() {
    console.log(`Loading font: ${FONT_PATH}`);
    if (!fs.existsSync(FONT_PATH)) {
        console.error(`\n!!! ERROR: Font file not found at: ${FONT_PATH}`);
        console.error(`!!! Please update FONT_PATH in scripts/generateShapes.ts`);
        process.exit(1);
    }
    const font = await opentype.load(FONT_PATH);
    console.log(`Font loaded: ${font.names.fontFamily?.en || 'Unknown Font Name'}`);

    const shapes: { [key: string]: SoftBodyData } = {};

    const scale = TARGET_HEIGHT / font.unitsPerEm;
    console.log(`Font units per Em: ${font.unitsPerEm}, Target height: ${TARGET_HEIGHT}px, Scale factor: ${scale.toFixed(4)}`);

    for (const char of TARGET_CHARS) {
        console.log(`Processing: ${char}`);
        const glyph = font.charToGlyph(char);
        if (!glyph) {
            console.warn(`  - Glyph not found for character: '${char}'`);
            continue;
        }
        const path = glyph.getPath(0, 0, 1); // Get path with y=0 baseline, scale 1

         if (!path || path.commands.length === 0) {
            console.warn(`  - Glyph for '${char}' has no path data.`);
             continue;
         }

        // *** FIX APPLIED HERE: Manually transform path commands ***
        // Apply scaling and flip Y-axis (Canvas is Y-down) MANUALLY
        // Transformation: newX = scale * x, newY = -scale * y
        for (const cmd of path.commands) {
            // Check if properties exist before assigning (for type safety with 'any' potential)
            if (cmd.x !== undefined) cmd.x *= scale;
            if (cmd.y !== undefined) cmd.y *= -scale;
            if (cmd.x1 !== undefined) cmd.x1 *= scale;
            if (cmd.y1 !== undefined) cmd.y1 *= -scale;
            if (cmd.x2 !== undefined) cmd.x2 *= scale;
            if (cmd.y2 !== undefined) cmd.y2 *= -scale;
        }
        // *** End of FIX ***


        // Sample points densely from the *transformed* contours
        // POINTS_PER_UNIT_LENGTH is relative to original font units, so pass it directly
        const contours = samplePathCommands(path.commands, POINTS_PER_UNIT_LENGTH);

        if (contours.length === 0) {
            console.warn(`  - No usable contours found after sampling for: '${char}'`);
            continue;
        }

        let longestContour: Point[] = [];
        contours.forEach(contour => {
            if (contour.length > longestContour.length) {
                longestContour = contour;
            }
        });

        if (longestContour.length < 3) {
            console.warn(`  - Longest contour too short for: '${char}' (${longestContour.length} points)`);
            continue;
        }
        console.log(`  - Longest contour has ${longestContour.length} points.`);

        const outlinePoints = longestContour;
        const normals = calculateNormals(outlinePoints);
        if (normals.length !== outlinePoints.length) {
            console.error(`  - ERROR: Normal calculation mismatch for '${char}'. Skipping.`);
            continue;
        }

        const midPoints: Point[] = [];
        const n = outlinePoints.length;
        const usedOpposites = new Set<number>();

        for (let i = 0; i < n; i++) {
             if (usedOpposites.has(i)) continue;
             // Stroke width guess is in *scaled* pixels, which matches outlinePoints units now
            const oppositeIndex = findOppositePointIndex(i, outlinePoints, normals, AVG_STROKE_WIDTH_GUESS);

            if (oppositeIndex !== -1 && oppositeIndex !== i && !usedOpposites.has(oppositeIndex)) {
                const p_i = outlinePoints[i];
                const p_j = outlinePoints[oppositeIndex];
                midPoints.push(p_i.add(p_j).div(2));
                usedOpposites.add(i);
                usedOpposites.add(oppositeIndex);
            }
        }

        if (midPoints.length < 2) {
             console.warn(`  - WARNING: Not enough midpoints generated for '${char}' (${midPoints.length}). Skipping.`);
             continue;
        }
         console.log(`  - Generated ${midPoints.length} midpoints.`);

        const orderedMidPoints = orderPoints(midPoints);
        const simplifiedPlainObjects = simplify(orderedMidPoints, SIMPLIFICATION_TOLERANCE, true);
        const simplifiedPoints: Point[] = simplifiedPlainObjects.map(p => new Point(p.x, p.y));

        if (simplifiedPoints.length < 2) {
             console.warn(`  - WARNING: Simplification resulted in too few points for '${char}' (${simplifiedPoints.length}). Skipping.`);
             continue;
        }

        let isLoop = false;
        if (simplifiedPoints.length > 2) {
            const first = simplifiedPoints[0];
            const last = simplifiedPoints[simplifiedPoints.length - 1];
            const closeThresholdSq = (SIMPLIFICATION_TOLERANCE * 2.5) ** 2;

            if (first.distSq(last) < closeThresholdSq) {
                isLoop = true;
                simplifiedPoints.pop();
                if (simplifiedPoints.length < (isLoop ? 3 : 2)) { // Check needed minimum length
                    console.warn(`  - WARNING: Loop closure check made path too short for '${char}'. Skipping.`);
                     continue;
                }
            }
        }

        const finalPoints = simplifiedPoints.map(p => ({
            x: parseFloat(p.x.toFixed(2)),
            y: parseFloat(p.y.toFixed(2))
         }));

        let pinnedIndices: number[] = [];
        // Optional Pinning Logic (example: pin lowest points)
        // if (finalPoints.length > 0) {
        //     let minY = Infinity;
        //     finalPoints.forEach(p => minY = Math.min(minY, p.y));
        //     const pinThreshold = 5.0;
        //     finalPoints.forEach((p, i) => {
        //        if (p.y - minY < pinThreshold) {
        //           pinnedIndices.push(i);
        //        }
        //     });
        // }

        shapes[char] = {
            points: finalPoints,
            isLoop: isLoop,
            // ...(pinnedIndices.length > 0 && { pinnedIndices: pinnedIndices }) // Uncomment to include pinning
        };
        console.log(`  -> Generated spine with ${finalPoints.length} points. Loop: ${isLoop}. ${pinnedIndices.length} pinned.`);

    } // End character loop

    // --- Output File Generation --- (Ensure import path logic is correct for your structure)
    console.log(`\nGenerating output file: ${OUTPUT_PATH}`);
    const relativeImportPath = path.relative(path.dirname(OUTPUT_PATH), path.resolve(__dirname, '../src/physicsEngine')).replace(/\\/g, '/');
    const importPath = relativeImportPath.startsWith('.') ? relativeImportPath : `./${relativeImportPath}`;

    let outputContent = `// Generated by scripts/generateShapes.ts\n`;
    outputContent += `// Font: ${font.names.fontFamily?.en || 'Unknown Font Name'} (using ${path.basename(FONT_PATH)})\n`;
    outputContent += `// Generated at: ${new Date().toISOString()}\n\n`;
    outputContent += `import type { SoftBodyData } from '${importPath}';\n\n`;
    outputContent += `export const letterShapes: { [key: string]: SoftBodyData } = {\n`;

    const sortedChars = Object.keys(shapes).sort();
    for (const char of sortedChars) {
        const data = shapes[char];
        const escapedChar = char.replace(/\\/g, '\\\\').replace(/'/g, "\\'").replace(/`/g, "\\`");
        outputContent += `  '${escapedChar}': {\n`;
        outputContent += `    points: [\n`;
        data.points.forEach(p => {
            outputContent += `      { x: ${p.x}, y: ${p.y} },\n`;
        });
        outputContent += `    ],\n`;
        outputContent += `    isLoop: ${data.isLoop},\n`;
        if (data.pinnedIndices && data.pinnedIndices.length > 0) {
             outputContent += `    pinnedIndices: [${data.pinnedIndices.join(', ')}],\n`;
        }
        outputContent += `  },\n`;
    }
    outputContent += `};\n`;

    try {
        fs.writeFileSync(OUTPUT_PATH, outputContent);
        console.log(`\n✅ Shape data successfully written to ${OUTPUT_PATH}`);
    } catch (err) {
        console.error(`\n❌ Error writing output file: ${err}`);
        process.exit(1);
    }
}

// --- Execute Script ---
generateShapes().catch(err => {
    console.error("\n❌ An unexpected error occurred during shape generation:", err);
    process.exit(1);
});