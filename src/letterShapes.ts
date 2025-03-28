// src/letterShapes.ts
import { Vec2 } from './physicsCore.js';

interface LetterDefinition {
    points: { x: number, y: number }[];
    isLoop: boolean;
    // Optional: Suggest pinned points for stability/hanging
    pinnedIndices?: number[];
}

// Scale factor for coordinates
const s = 40; // Approx height

export const letterShapes: { [key: string]: LetterDefinition } = {
    'L': {
        points: [
            { x: 0, y: 0 }, { x: 0, y: s }, { x: s * 0.6, y: s }
        ],
        isLoop: false,
        pinnedIndices: [0] // Pin top-left
    },
    'I': {
        points: [
            { x: 0, y: 0 }, { x: 0, y: s }
        ],
        isLoop: false,
        pinnedIndices: [0] // Pin top
    },
    'C': {
        points: [ // Approximate C shape
            { x: s * 0.6, y: s * 0.1 }, { x: s * 0.2, y: 0 }, { x: 0, y: s * 0.2 },
            { x: 0, y: s * 0.8 }, { x: s * 0.2, y: s }, { x: s * 0.6, y: s * 0.9 }
        ],
        isLoop: false,
        // pinnedIndices: [0] // Optional pinning
    },
    'O': {
        points: [ // Diamond approximation for simplicity
             { x: s * 0.3, y: 0 }, { x: s * 0.6, y: s * 0.5 },
             { x: s * 0.3, y: s }, { x: 0, y: s * 0.5 }
        ],
        isLoop: true,
        // pinnedIndices: [0] // Optional pinning
    },
    'S': {
         points: [
             { x: s * 0.6, y: s * 0.1 }, { x: s * 0.1, y: 0 }, { x: 0, y: s * 0.4 },
             { x: s * 0.6, y: s * 0.6 }, { x: s * 0.5, y: s}, { x: 0, y: s * 0.9 }
         ],
         isLoop: false,
    }
    // Add more letters here...
    // 'E', 'T', 'B' etc. would require multiple chains or more complex setup
};