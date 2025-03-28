// scripts/generateShapes.ts
import * as opentype from 'opentype.js';
import fs from 'fs';
import path from 'path';
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
    perp() { return new Point(-this.y, this.x); } // Rotate +90 deg
}

// Interface defining the structure of the output data
// Note: Consider moving this interface definition to physicsEngine.ts and importing it
interface LetterShapeData {
    points: { x: number; y: number }[]; // Use plain objects for final output
    isLoop: boolean;
    pinnedIndices?: number[];
}

// Interface for path segments
interface Segment { 
    type: 'L' | 'C' | 'Q'; 
    p0: Point; 
    p1?: Point; 
    p2?: Point; 
    p3: Point; 
    length: number; 
}

// --- Configuration ---
const TARGET_CHARS = "ABCDEFGHIJKLMNOPQRSTUVWXYZ"; // Process all characters
const FONT_PATH = path.resolve(__dirname, '../../fonts/Roboto/static/Roboto-Regular.ttf');
const OUTPUT_PATH = path.resolve(__dirname, '../../src/letterShapes.ts');
const TARGET_HEIGHT = 70; // Target height in pixels
const LARGE_REF_SIZE = 1000; // Work in large coordinates to avoid precision issues
const AVG_STROKE_WIDTH_GUESS = 100; // UN-SCALED guess for stroke width in large coords
const FINAL_SPINE_POINTS = 20; // Fixed number of points for final spine
const FALLBACK_CHARS = new Set(['N', 'X', 'M', 'W', 'K', 'E', 'F', 'T', 'A', 'H', 'Y', 'Z', 'V']);

const SIMPLIFICATION_TOLERANCE = 2.0; // Tolerance relative to LARGE_REF_SIZE
const TARGET_SAMPLES_PER_CONTOUR = 150;

// Parameters for Midpoint Strategy (tune these)
const TARGET_HEIGHT_SCALED = TARGET_HEIGHT / LARGE_REF_SIZE;          // Target pixel height for scaling
const TARGET_SAMPLES_PER_CONTOUR_SCALED = TARGET_SAMPLES_PER_CONTOUR; // Fixed number of points to sample per contour
const SIMPLIFICATION_TOLERANCE_SCALED = SIMPLIFICATION_TOLERANCE; // RDP simplification tolerance (pixels) - higher = less points

// --- Helper Functions ---

/**
 * Samples points densely along OpenType path commands.
 */
function samplePathCommands(commands: opentype.PathCommand[]): Point[][] {
    // console.log("  [samplePathCommands] Starting Pass 1: Calculate lengths...");
    const rawContours: Segment[][] = [];
    let currentRawContour: Segment[] = [];
    let currentPos = new Point();
    let startPos = new Point();
    // Keep minimum distance check to avoid pure duplicates if segments are zero-length
    const MIN_DIST_SQ = 0.0001 * 0.0001; // Even smaller threshold

    // --- Pass 1 Logic (unchanged from previous attempt) ---
    for (const cmd of commands) {
        switch (cmd.type) {
            case 'M':
                if (currentRawContour.length > 0) rawContours.push(currentRawContour);
                currentRawContour = [];
                currentPos = new Point(cmd.x, cmd.y);
                startPos = currentPos;
                break;
            case 'L': {
                const p0 = currentPos;
                const p3 = new Point(cmd.x, cmd.y);
                const length = p3.dist(p0);
                if (length > Math.sqrt(MIN_DIST_SQ)) {
                    currentRawContour.push({ type: 'L', p0, p3, length });
                    currentPos = p3;
                }
                break;
            }
            case 'C': {
                const p0 = currentPos;
                const p1 = new Point(cmd.x1, cmd.y1);
                const p2 = new Point(cmd.x2, cmd.y2);
                const p3 = new Point(cmd.x, cmd.y);
                // Approx length
                const chord = p3.dist(p0);
                const controlNet = p1.dist(p0) + p2.dist(p1) + p3.dist(p2);
                const length = (chord + controlNet) / 2;
                if (length > Math.sqrt(MIN_DIST_SQ)) {
                    currentRawContour.push({ type: 'C', p0, p1, p2, p3, length });
                    currentPos = p3;
                }
                break;
            }
            case 'Q': {
                const p0 = currentPos;
                const p1 = new Point(cmd.x1, cmd.y1);
                const p3 = new Point(cmd.x, cmd.y); // p2 in quadratic terms, but using p3 for consistency
                // Approx length
                const chord = p3.dist(p0);
                const controlNet = p1.dist(p0) + p3.dist(p1);
                const length = (chord + controlNet) / 2;
                if (length > Math.sqrt(MIN_DIST_SQ)) {
                    currentRawContour.push({ type: 'Q', p0, p1, p3: p3, length }); // Store p2 as p3
                    currentPos = p3;
                }
                break;
            }
            case 'Z':
                if (currentRawContour.length > 0) {
                    const p0 = currentPos;
                    const p3 = startPos;
                    const length = p3.dist(p0);
                    if (length > Math.sqrt(MIN_DIST_SQ)) { // Closing segment
                        currentRawContour.push({ type: 'L', p0, p3, length });
                    }
                    rawContours.push(currentRawContour);
                    currentRawContour = [];
                }
                currentPos = startPos;
                break;
        }
    }
    if (currentRawContour.length > 0) rawContours.push(currentRawContour);
    // console.log(`  [samplePathCommands] Pass 1 finished. Found ${rawContours.length} raw contours.`);

    // console.log("  [samplePathCommands] Starting Pass 2: Sample points...");
    const finalContours: Point[][] = [];

    for (let contourIdx = 0; contourIdx < rawContours.length; contourIdx++) {
        const rawContour = rawContours[contourIdx];
        const totalLength = rawContour.reduce((sum, seg) => sum + seg.length, 0);
        // console.log(`  [samplePathCommands] Processing raw contour ${contourIdx}, totalLength: ${totalLength.toFixed(4)}`);

        if (totalLength === 0 || totalLength < Math.sqrt(MIN_DIST_SQ)) {
            // console.log(`  [samplePathCommands] Skipping raw contour ${contourIdx} due to zero or tiny length.`);
            continue;
        }

        // Avoid division by zero if TARGET_SAMPLES is 1 or less
        if (TARGET_SAMPLES_PER_CONTOUR <= 0) continue;
        const stepLength = totalLength / TARGET_SAMPLES_PER_CONTOUR;
        if (stepLength <= 0) {
            // console.log(`  [samplePathCommands] Skipping raw contour ${contourIdx} due to zero or negative stepLength.`);
            continue; // Avoid potential issues with zero step length
        }
        // console.log(`  [samplePathCommands] stepLength: ${stepLength.toFixed(6)}`);

        let currentContourPoints: Point[] = [];

        // Define addPoint helper within the loop scope to access currentContourPoints
        function addPointLocal(p: Point): boolean {
            if (currentContourPoints.length === 0 || p.distSq(currentContourPoints[currentContourPoints.length - 1]) > MIN_DIST_SQ) {
                currentContourPoints.push(p);
                return true;
            }
            return false;
        }

        let distanceCovered = 0;

        if (rawContour.length > 0) {
            addPointLocal(rawContour[0].p0); // Add first point
        }

        for (let segmentIdx = 0; segmentIdx < rawContour.length; segmentIdx++) {
            const segment = rawContour[segmentIdx];
            // Skip zero-length segments explicitly (already somewhat handled in pass 1)
            if (segment.length <= 0) continue;

            // console.log(`  [samplePathCommands]   Processing segment ${segmentIdx} (type ${segment.type}, length ${segment.length.toFixed(4)})`);
            let distanceAlongSegment = 0;
            let loopDetector = 0; // Safety counter for the while loop

            // --- WHILE LOOP START ---
            while (distanceAlongSegment < segment.length) {
                loopDetector++;
                if (loopDetector > TARGET_SAMPLES_PER_CONTOUR * 5 + 50) { // Generous safety break
                    console.error(`  [samplePathCommands] !!! Safety break triggered in segment ${segmentIdx} of contour ${contourIdx}. distanceAlongSegment=${distanceAlongSegment}, segment.length=${segment.length}. Breaking.`);
                    distanceAlongSegment = segment.length; // Force exit
                    break; // Exit while loop
                }

                // Calculate distance needed to reach the *center* of the next sampling interval
                const nextSampleTargetDistance = (Math.floor(distanceCovered / stepLength) + 0.5) * stepLength;
                let distanceToNextSample = nextSampleTargetDistance - distanceCovered;

                // If distanceToNextSample is very small or negative, it means we're at or past the target.
                // Advance to the *next* interval target.
                if (distanceToNextSample < stepLength * 0.01) {
                    distanceToNextSample += stepLength;
                }

                const epsilon = 1e-9; // Small value for float comparisons

                // Check if the next sample point falls within the *remaining* part of this segment
                if (distanceToNextSample < segment.length - distanceAlongSegment - epsilon) {
                    // Yes, sample point is within this segment
                    distanceAlongSegment += distanceToNextSample;
                    distanceCovered += distanceToNextSample;

                    // Calculate t (proportion along the *current* segment)
                    const t = distanceAlongSegment / segment.length;

                    // Log occasionally inside the loop
                    // if (loopDetector % 20 === 0) {
                    //     console.log(`    [samplePathCommands] Inner loop iter ${loopDetector}, t=${t.toFixed(3)}, distCovered=${distanceCovered.toFixed(3)}`);
                    // }

                    let pt: Point;
                    // Calculate point based on segment type and t
                    if (segment.type === 'L') {
                        pt = segment.p0.add(segment.p3.sub(segment.p0).mul(t));
                    } else if (segment.type === 'C') {
                        const it = 1 - t; const b0=it*it*it, b1=3*it*it*t, b2=3*it*t*t, b3=t*t*t;
                        pt = segment.p0.mul(b0).add(segment.p1!.mul(b1)).add(segment.p2!.mul(b2)).add(segment.p3.mul(b3));
                    } else { // 'Q'
                        const it = 1 - t; const b0=it*it, b1=2*it*t, b2=t*t;
                        pt = segment.p0.mul(b0).add(segment.p1!.mul(b1)).add(segment.p3.mul(b2));
                    }
                    addPointLocal(pt);

                } else {
                    // No more sample points within the remainder of this segment.
                    // Advance distanceCovered to the end of this segment.
                    const remainingDistanceInSegment = segment.length - distanceAlongSegment;
                    if(remainingDistanceInSegment > -epsilon) { // Avoid subtracting if already past end
                        distanceCovered += remainingDistanceInSegment;
                    }
                    distanceAlongSegment = segment.length; // Move to end of segment for loop termination
                }
            }
            // --- WHILE LOOP END ---

            // Ensure endpoint of segment is added if distinct
            addPointLocal(segment.p3);
        } // End loop over segments

        // Post-processing for the contour
        if (currentContourPoints.length > 1 && currentContourPoints[0].distSq(currentContourPoints[currentContourPoints.length - 1]) < MIN_DIST_SQ) {
            currentContourPoints.pop(); // Remove duplicate closing point
        }
        if (currentContourPoints.length > 2) {
            // console.log(`  [samplePathCommands] Finished contour ${contourIdx}. Sampled points: ${currentContourPoints.length}`);
            finalContours.push(currentContourPoints);
        } else {
            // console.log(`  [samplePathCommands] Discarding contour ${contourIdx} with too few points (${currentContourPoints.length}) after sampling.`);
        }
    } // End loop over rawContours

    // console.log(`  [samplePathCommands] Pass 2 finished. Generated ${finalContours.length} final contours.`);
    return finalContours;
}

/**
 * Calculates approximate vertex normals for a polyline contour using angle bisector method.
 */
function calculateNormals(points: Point[]): Point[] {
    console.log(`  [calculateNormals] Calculating for ${points.length} points.`);
    const normals: Point[] = [];
    const n = points.length;
    if (n < 2) return [];

    const minMagSq = 1e-12; // Smaller threshold for zero check

    for (let i = 0; i < n; i++) {
        const p_curr = points[i];
        const p_prev = points[(i - 1 + n) % n];
        const p_next = points[(i + 1) % n];

        let vec_in = p_curr.sub(p_prev);
        let vec_out = p_next.sub(p_curr);

        // Handle zero-length segments robustly
        if (vec_in.magSq() < minMagSq) vec_in = vec_out.mul(-1); // Use reverse of next segment
        if (vec_out.magSq() < minMagSq) vec_out = vec_in.mul(-1); // Use reverse of previous segment

        // If still zero, use fallback
        if (vec_in.magSq() < minMagSq && vec_out.magSq() < minMagSq) {
            if(i<5) console.log(`  [calculateNormals] Warning: Zero vectors around index ${i}. Using default normal.`);
            normals.push(new Point(0, 1)); continue;
        }
        // Ensure vectors used for angle have non-zero length
        if (vec_in.magSq() < minMagSq) vec_in = new Point(-vec_out.x, -vec_out.y); // Last resort copy
         if (vec_out.magSq() < minMagSq) vec_out = new Point(-vec_in.x, -vec_in.y); // Last resort copy


        vec_in = vec_in.normalize();
        vec_out = vec_out.normalize();

        // --- Angle Bisector Method ---
        // Calculate tangent at the vertex (average of incoming and outgoing directions)
        let tangent = vec_in.add(vec_out).normalize();

        // Handle cases where tangent is zero (segments are exactly opposite)
        if (tangent.magSq() < minMagSq) {
            // If segments are anti-parallel, normal is perpendicular to either segment
            tangent = vec_in; // Use one of the segments
             if(i<5) console.log(`  [calculateNormals] Anti-parallel segments at index ${i}.`);
        }

        // Normal is perpendicular to the tangent
        let final_normal = tangent.perp(); // Rotate tangent +90 degrees

        // --- Ensure consistent winding (Optional but Recommended) ---
        // Heuristic: Check cross product of vec_in and vec_out.
        // For CCW winding (typical outer contour), cross product z-component should be positive.
        // cross_z = vec_in.x * vec_out.y - vec_in.y * vec_out.x;
        // If cross_z is negative, it might indicate a CW contour or a concave corner.
        // We could flip the normal based on this, but let's skip for now to see effect of bisector.

         // Check for NaN
        if (isNaN(final_normal.x) || isNaN(final_normal.y)) {
             console.error(`  [calculateNormals] !!! NaN normal calculated for index ${i}. Using fallback.`);
             final_normal = new Point(0, 1);
        }

        if (i < 10) { // Log more normals now
             console.log(`  [calculateNormals] Index ${i}: p_prev=(${p_prev.x.toFixed(1)},${p_prev.y.toFixed(1)}), p_curr=(${p_curr.x.toFixed(1)},${p_curr.y.toFixed(1)}), p_next=(${p_next.x.toFixed(1)},${p_next.y.toFixed(1)}) -> Normal=(${final_normal.x.toFixed(3)}, ${final_normal.y.toFixed(3)})`);
        }

        normals.push(final_normal);
    }
    console.log(`  [calculateNormals] Finished calculations.`);
    return normals;
}

/**
 * Finds a plausible "opposite" point on the same contour using heuristics.
 * *** MODIFIED FOR LARGE COORDINATES ***
 */
function findOppositePointIndexLarge(
    currentIndex: number,
    points: Point[], // These points have LARGE coordinates
    normals: Point[],
    strokeWidthGuess: number, // UN-SCALED guess
    charForDebug: string | null = null
): number {
    const p_i = points[currentIndex];
    const n_i = normals[currentIndex];
    const n = points.length;
    let bestMatchIndex = -1;
    let bestScore = -Infinity;

    const searchSkip = Math.max(5, Math.floor(n * 0.1));

    // Bounds based on UN-SCALED guess (coords are large)
    const minDistSq = (strokeWidthGuess * 0.3) ** 2; // Keep 30% min
    const maxDistSq = (strokeWidthGuess * 4.0) ** 2; // Try 400% max (400^2 = 160000)

    // Disable debug logging
    const enableDebugLog = false;

    for (let offset = searchSkip; offset <= n - searchSkip; offset++) {
        const j = (currentIndex + offset) % n;
        if (j === currentIndex) continue;

        const p_j = points[j];
        const distSq = p_i.distSq(p_j);
        const dist = Math.sqrt(distSq);

        // Check 1: Distance Bounds (with new MaxDistSq)
        if (distSq > maxDistSq || distSq < minDistSq) {
            continue;
        }

        // Check 2: Normal/Score Check
        const n_j = normals[j];
        const normalDot = n_i.dot(n_j);
        const distanceFactor = 1.0 - Math.abs(dist - strokeWidthGuess) / strokeWidthGuess;
        const normalFactor = (-normalDot + 1) / 2;
        const score = (normalFactor * 0.7) + (distanceFactor * 0.3);

        if (normalDot < 0.0 && score > bestScore) { // Strict normal check
            bestScore = score;
            bestMatchIndex = j;
        }
    } // End loop

    return bestMatchIndex;
}

/**
 * Orders points using nearest neighbor, biased towards forward direction.
 */
function orderPoints(points: Point[]): Point[] {
    if (points.length < 2) return points;

    const ordered: Point[] = [];
    const remaining = new Set<number>(points.map((p, i) => i));
    let currentIdx = 0; // Start at index 0

    ordered.push(points[currentIdx]);
    remaining.delete(currentIdx);

    let lastDirection = new Point(1, 0); // Initial direction guess (e.g., right)

    while (remaining.size > 0) {
        let bestCandidateIdx = -1;
        let minScore = Infinity; // Lower score is better (distance penalized by direction)

        const currentPoint = points[currentIdx]; // The point we are extending from

        // Update direction based on last added segment (if available)
        if (ordered.length > 1) {
            const prevPoint = ordered[ordered.length - 2]; // Point before current
            const currentSegment = currentPoint.sub(prevPoint);
            if (currentSegment.magSq() > 1e-6) {
                lastDirection = currentSegment.normalize();
            }
            // If points were identical, keep previous lastDirection
        }

        for (const candidateIdx of remaining) {
            const candidatePoint = points[candidateIdx];
            const connectionVector = candidatePoint.sub(currentPoint);
            const distSq = connectionVector.magSq();

            if (distSq < 1e-9) continue; // Skip identical points

            const connectionDir = connectionVector.normalize();

            // Calculate directional alignment (dot product)
            // Should be close to 1 if candidate is in the 'forward' direction
            const alignment = lastDirection.dot(connectionDir);

            // Calculate score: Lower is better.
            // Penalize distance heavily.
            // Penalize points that are 'behind' (alignment < 0) significantly.
            // Give a smaller penalty for points off to the side (0 < alignment < 0.7).
            // Favor points directly ahead (alignment > 0.7).
            let score = distSq; // Base score is distance squared

            if (alignment < -0.1) { // Strongly backward
                score *= 100.0; // Heavy penalty
            } else if (alignment < 0.7) { // Sideways
                score *= (2.0 - alignment); // Moderate penalty (factor between 1.3 and 2.1)
            } else { // Forward
                score *= (1.0 - alignment * 0.5); // Small bonus/penalty (factor between 0.5 and 0.65)
            }

            if (score < minScore) {
                minScore = score;
                bestCandidateIdx = candidateIdx;
            }
        } // End loop through candidates

        if (bestCandidateIdx !== -1) {
            currentIdx = bestCandidateIdx; // Move to the best candidate
            ordered.push(points[currentIdx]);
            remaining.delete(currentIdx);
        } else {
            // Failsafe: If no suitable candidate found (e.g., isolated point),
            // just pick the absolute nearest remaining point.
            let nearestDistSq = Infinity;
            let fallbackIdx = -1;
            for (const idx of remaining) {
                const dSq = currentPoint.distSq(points[idx]);
                if (dSq < nearestDistSq) {
                    nearestDistSq = dSq;
                    fallbackIdx = idx;
                }
            }
            if(fallbackIdx !== -1) {
                currentIdx = fallbackIdx;
                ordered.push(points[currentIdx]);
                remaining.delete(currentIdx);
            } else {
                console.error("  [orderPoints] Fallback failed. Cannot order remaining points.");
                break; // Cannot proceed
            }
        }
    } // End while remaining

    return ordered;
}

/**
 * Resamples a polyline to have a specific number of points evenly spaced along its length.
 */
function resamplePath(points: Point[], numPoints: number): Point[] {
    if (points.length < 2 || numPoints < 2) {
        return points; // Cannot resample
    }

    const newPoints: Point[] = [points[0]]; // Start with the first point
    let totalLength = 0;
    const lengths: number[] = []; // Cumulative lengths

    // Calculate cumulative lengths
    lengths.push(0);
    for (let i = 1; i < points.length; i++) {
        totalLength += points[i].dist(points[i - 1]);
        lengths.push(totalLength);
    }

    if (totalLength === 0) return [points[0], points[points.length - 1]]; // Handle zero-length path

    const interval = totalLength / (numPoints - 1);
    let currentDist = 0;
    let segmentIndex = 0;

    for (let i = 1; i < numPoints - 1; i++) { // Generate intermediate points
        const targetDist = i * interval;

        // Find the segment where the target distance falls
        while (segmentIndex < lengths.length - 1 && lengths[segmentIndex + 1] < targetDist) {
            segmentIndex++;
        }

        // Interpolate within the segment
        const lengthBeforeSegment = lengths[segmentIndex];
        const segmentLength = lengths[segmentIndex + 1] - lengthBeforeSegment;
        const distIntoSegment = targetDist - lengthBeforeSegment;

        let t = 0;
        if (segmentLength > 1e-6) { // Avoid division by zero
            t = distIntoSegment / segmentLength;
        }

        const p0 = points[segmentIndex];
        const p1 = points[segmentIndex + 1];
        newPoints.push(p0.add(p1.sub(p0).mul(t)));
    }

    newPoints.push(points[points.length - 1]); // Add the last point
    return newPoints;
}

/**
 * Generates a simple spine (vertical or horizontal line) based on the bounding box of the path.
 * Used as a fallback for characters where midpoint averaging fails.
 */
function generateSimpleFallbackSpine(path: opentype.Path, numPoints: number): Point[] {
    // Calculate bounding box from the (already scaled) path commands
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const cmd of path.commands) {
        if ('x' in cmd) { minX = Math.min(minX, cmd.x); maxX = Math.max(maxX, cmd.x); }
        if ('y' in cmd) { minY = Math.min(minY, cmd.y); maxY = Math.max(maxY, cmd.y); }
        if ('x1' in cmd) { minX = Math.min(minX, cmd.x1!); maxX = Math.max(maxX, cmd.x1!); } // Include control points
        if ('y1' in cmd) { minY = Math.min(minY, cmd.y1!); maxY = Math.max(maxY, cmd.y1!); }
        if ('x2' in cmd) { minX = Math.min(minX, cmd.x2!); maxX = Math.max(maxX, cmd.x2!); }
        if ('y2' in cmd) { minY = Math.min(minY, cmd.y2!); maxY = Math.max(maxY, cmd.y2!); }
    }

    const width = maxX - minX;
    const height = maxY - minY;
    if (width < 1e-3 && height < 1e-3) return []; // Path is essentially a point

    const centerX = minX + width / 2;
    const centerY = minY + height / 2; // Y is already flipped if path was transformed

    const points: Point[] = [];
    const numSegments = numPoints - 1;
    const numVerticalPoints = numPoints; // Use full count for vertical
    const aspectRatio = width > 1e-3 ? height / width : Infinity;

    // Always add vertical points first
    const stepY = height / Math.max(1, numVerticalPoints - 1);
    for (let i = 0; i < numVerticalPoints; i++) {
        points.push(new Point(centerX, minY + i * stepY));
    }

    // Add horizontal points if wide enough (e.g., aspect ratio < 1.5 or 2.0)
    const horizontalThresholdRatio = 1.8;
    if (aspectRatio < horizontalThresholdRatio && width > 0) {
        const numHorizontalPoints = numPoints; // Or maybe fewer? numPoints / 2?
        const stepX = width / Math.max(1, numHorizontalPoints - 1);
        // Add horizontal points, skipping the center one if already added by vertical
        for (let i = 0; i < numHorizontalPoints; i++) {
            const x = minX + i * stepX;
            // Avoid adding point near exact center if vertical line already did
            if (Math.abs(x - centerX) > stepX * 0.1) {
                points.push(new Point(x, centerY));
            }
        }
    }

    // Order the combined points (essential if both vertical/horizontal added)
    // Use the existing orderPoints function
    if (points.length >= 2) {
        console.log(`  [Fallback] Ordering ${points.length} generated points.`);
        return orderPoints(points);
    } else {
        return points;
    }
}

// --- Main Generation Logic ---
async function generateShapes() {
    console.log(`Loading font: ${FONT_PATH}`);
    if (!fs.existsSync(FONT_PATH)) {
        console.error(`\n!!! ERROR: Font file not found at: ${FONT_PATH}`); process.exit(1);
    }
    const font = await opentype.load(FONT_PATH);
    console.log(`Font loaded: ${font.names.fontFamily?.en || 'Unknown Font Name'}`);
    console.log(`Font unitsPerEm: ${font.unitsPerEm}`); // Log unitsPerEm

    const shapes: { [key: string]: LetterShapeData } = {};
    const scaleLarge = LARGE_REF_SIZE / font.unitsPerEm;
    console.log(`Scale factor to ${LARGE_REF_SIZE}: ${scaleLarge.toFixed(4)}`);

    for (const char of TARGET_CHARS) {
        console.log(`\nProcessing: ${char}`);
        const glyph = font.charToGlyph(char);
        if (!glyph) { console.warn(`  - Glyph not found: '${char}'`); continue; }

        // Get path in native font units first
        const path = glyph.getPath(0, 0, font.unitsPerEm);
        if (!path || path.commands.length === 0) { console.warn(`  - No path data: '${char}'`); continue; }

        // --- Transform Path to LARGE scale ---
        for (const cmd of path.commands) {
            switch (cmd.type) {
                case 'M': case 'L':
                    cmd.x *= scaleLarge; cmd.y *= -scaleLarge; break;
                case 'C':
                    cmd.x *= scaleLarge; cmd.y *= -scaleLarge; cmd.x1 *= scaleLarge; cmd.y1 *= -scaleLarge; cmd.x2 *= scaleLarge; cmd.y2 *= -scaleLarge; break;
                case 'Q':
                    cmd.x *= scaleLarge; cmd.y *= -scaleLarge; cmd.x1 *= scaleLarge; cmd.y1 *= -scaleLarge; break;
            }
        }

        let finalPoints: { x: number; y: number }[];
        let isLoop = false;

        if (FALLBACK_CHARS.has(char)) {
            console.log(`  - Using fallback generation for '${char}'`);
            const fallbackPointsLarge = generateSimpleFallbackSpine(path, FINAL_SPINE_POINTS);
            if (fallbackPointsLarge.length < 2) { console.warn(`  - Fallback failed: '${char}'`); continue; }

            // Downscale fallback points
            const downScaleFactor = TARGET_HEIGHT / LARGE_REF_SIZE;
            finalPoints = fallbackPointsLarge.map(p => ({
                x: parseFloat((p.x * downScaleFactor).toFixed(2)),
                y: parseFloat((p.y * downScaleFactor).toFixed(2))
            }));
            isLoop = false; // Fallback is never a loop

        } else {
            // --- Proceed with Midpoint Averaging & Resampling ---
            console.log(`  - Using midpoint generation for '${char}'`);
            const contours = samplePathCommands(path.commands);
            if (contours.length === 0) { console.warn(`  - No contours sampled: '${char}'`); continue; }

            // --- Select Contour (Simplistic: Longest) ---
            let longestContour: Point[] = [];
            contours.forEach(c => { if (c.length > longestContour.length) longestContour = c; });
            if (longestContour.length < 3) { console.warn(`  - Contour too short: '${char}'`); continue; }
            console.log(`  - Sampled contour points: ${longestContour.length}`);

            // --- Generate Midpoints ---
            const outlinePoints = longestContour;
            const normals = calculateNormals(outlinePoints);
            if (normals.length !== outlinePoints.length) { console.error(`  - Normal mismatch: '${char}'`); continue; }

            const midPoints: Point[] = [];
            const usedOpposites = new Set<number>();
            for (let i = 0; i < outlinePoints.length; i++) {
                if (usedOpposites.has(i)) continue;
                const oppositeIndex = findOppositePointIndexLarge(i, outlinePoints, normals, AVG_STROKE_WIDTH_GUESS);
                if (oppositeIndex !== -1 && oppositeIndex !== i && !usedOpposites.has(oppositeIndex)) {
                    midPoints.push(outlinePoints[i].add(outlinePoints[oppositeIndex]).div(2));
                    usedOpposites.add(i); usedOpposites.add(oppositeIndex);
                }
            }
            if (midPoints.length < 2) { console.warn(`  - Few midpoints (${midPoints.length}): '${char}'`); continue; }
            console.log(`  - Generated midpoints: ${midPoints.length}`);

            // --- Order and Resample Midpoints ---
            const orderedMidPoints = orderPoints(midPoints);
            if (orderedMidPoints.length < 2) { console.warn(`  - Too few ordered points: '${char}'`); continue; }

            console.log(`  - Resampling ${orderedMidPoints.length} midpoints to ${FINAL_SPINE_POINTS} points.`);
            const resampledPointsLarge = resamplePath(orderedMidPoints, FINAL_SPINE_POINTS);
            console.log(`  - Resampled points count: ${resampledPointsLarge.length}`);
            if (resampledPointsLarge.length < 2) { console.warn(`  - Resampling failed or produced too few points: '${char}'`); continue; }

            // --- Downscale ---
            const downScaleFactor = TARGET_HEIGHT / LARGE_REF_SIZE;
            finalPoints = resampledPointsLarge.map(p => ({
                x: parseFloat((p.x * downScaleFactor).toFixed(2)),
                y: parseFloat((p.y * downScaleFactor).toFixed(2))
            }));

            // --- Check Loop ---
            if (finalPoints.length > 2) {
                const first = finalPoints[0];
                const last = finalPoints[finalPoints.length - 1];
                const closeThresholdSq = (AVG_STROKE_WIDTH_GUESS * downScaleFactor * 0.1) ** 2;
                const dx = first.x - last.x;
                const dy = first.y - last.y;
                if ((dx*dx + dy*dy) < closeThresholdSq) {
                    isLoop = true;
                    finalPoints.pop();
                    if (finalPoints.length < (isLoop ? 3 : 2)) { console.warn(`  - Loop check made path too short: '${char}'`); continue; }
                }
            }
        }

        // --- Save Result ---
        shapes[char] = { points: finalPoints, isLoop: isLoop };
        console.log(`  -> Final Spine points: ${finalPoints.length}. Loop: ${isLoop}.`);

    } // End char loop

    // --- Output File Generation ---
    console.log(`\nGenerating output file: ${OUTPUT_PATH}`);
    const importPath = './physicsEngine'; // Simplified import path

    let outputContent = `// Generated by scripts/generateShapes.ts\n`;
    outputContent += `// Font: ${font.names.fontFamily?.en || 'Unknown Font Name'} (using ${path.basename(FONT_PATH)})\n`;
    outputContent += `// Generated at: ${new Date().toISOString()}\n\n`;
    // Define interface inline or import from physicsEngine if defined there
    outputContent += `export interface LetterShapeData {\n`;
    outputContent += `    points: { x: number; y: number }[];\n`;
    outputContent += `    isLoop: boolean;\n`;
    outputContent += `    pinnedIndices?: number[];\n`;
    outputContent += `}\n\n`;
    // outputContent += `import type { LetterShapeData } from '${importPath}'; // Alternative if defined elsewhere\n\n`;
    outputContent += `export const letterShapes: { [key: string]: LetterShapeData } = {\n`;

    const sortedChars = Object.keys(shapes).sort();
    for (const char of sortedChars) {
        // ... (rest of file writing logic - unchanged) ...
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
        console.error(`\n❌ Error writing output file: ${err}`); process.exit(1);
    }
}

// --- Execute Script ---
generateShapes().catch(err => {
    console.error("\n❌ An unexpected error occurred during shape generation:", err); process.exit(1);
});