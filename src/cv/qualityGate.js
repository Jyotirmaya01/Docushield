/**
 * DocuShield Computer Vision Capture & Quality Gate
 * Implements:
 * 1. Laplacian Variance Blur Detection
 * 2. Grayscale Luminance Histogram Glare & Underexposure Analysis
 * 3. Document Framing & Corner Alignment Check
 *
 * Core Ethical Rule: Gating failures trigger a friendly retake prompt,
 * NEVER rejecting the document itself.
 */

import { CONFIG } from '../config.js';

export class QualityGate {
  /**
   * Analyzes an ImageData or HTMLCanvasElement
   * @param {HTMLCanvasElement|ImageData} source 
   * @returns {Object} Quality gate diagnostic results
   */
  static analyzeImageQuality(source) {
    let imageData;
    if (source instanceof HTMLCanvasElement) {
      const ctx = source.getContext('2d');
      imageData = ctx.getImageData(0, 0, source.width, source.height);
    } else if (source instanceof ImageData) {
      imageData = source;
    } else {
      throw new Error('Invalid image source for quality analysis');
    }

    const { width, height, data } = imageData;
    const totalPixels = width * height;

    // 1. Build grayscale array and histogram
    const grayscale = new Uint8ClampedArray(totalPixels);
    const histogram = new Uint32Array(256);
    let overexposedCount = 0;
    let underexposedCount = 0;

    for (let i = 0; i < totalPixels; i++) {
      const r = data[i * 4];
      const g = data[i * 4 + 1];
      const b = data[i * 4 + 2];
      // Standard luminance formula
      const lum = Math.round(0.299 * r + 0.587 * g + 0.114 * b);
      grayscale[i] = lum;
      histogram[lum]++;

      if (lum >= 246) overexposedCount++;
      if (lum <= 32) underexposedCount++;
    }

    const overexposedPct = (overexposedCount / totalPixels) * 100;
    const underexposedPct = (underexposedCount / totalPixels) * 100;

    // 2. Laplacian Variance Blur Check
    // Kernel: [0, 1, 0; 1, -4, 1; 0, 1, 0]
    let lapSum = 0;
    let lapSqSum = 0;
    let sampleCount = 0;

    // Sample step for real-time mobile performance
    const step = width > 600 ? 2 : 1;

    for (let y = 1; y < height - 1; y += step) {
      const rowOffset = y * width;
      const topOffset = (y - 1) * width;
      const botOffset = (y + 1) * width;

      for (let x = 1; x < width - 1; x += step) {
        const center = grayscale[rowOffset + x];
        const top = grayscale[topOffset + x];
        const bot = grayscale[botOffset + x];
        const left = grayscale[rowOffset + x - 1];
        const right = grayscale[rowOffset + x + 1];

        const lap = top + bot + left + right - 4 * center;
        lapSum += lap;
        lapSqSum += lap * lap;
        sampleCount++;
      }
    }

    const mean = sampleCount > 0 ? lapSum / sampleCount : 0;
    const laplacianVariance = sampleCount > 0 ? (lapSqSum / sampleCount) - (mean * mean) : 0;

    // 3. Document Framing & Alignment estimation
    // Check contrast along the expected 80% inner rectangle perimeter
    const marginX = Math.round(width * 0.1);
    const marginY = Math.round(height * 0.15);
    let borderEdgeSum = 0;
    let borderSampleCount = 0;

    for (let x = marginX; x < width - marginX; x += 4) {
      borderEdgeSum += Math.abs(grayscale[marginY * width + x] - grayscale[(marginY + 5) * width + x]);
      borderEdgeSum += Math.abs(grayscale[(height - marginY) * width + x] - grayscale[(height - marginY - 5) * width + x]);
      borderSampleCount += 2;
    }
    for (let y = marginY; y < height - marginY; y += 4) {
      borderEdgeSum += Math.abs(grayscale[y * width + marginX] - grayscale[y * width + marginX + 5]);
      borderEdgeSum += Math.abs(grayscale[y * width + width - marginX] - grayscale[y * width + width - marginX - 5]);
      borderSampleCount += 2;
    }

    const avgEdgeContrast = borderSampleCount > 0 ? borderEdgeSum / borderSampleCount : 0;
    const framingScore = Math.min(100, Math.round((avgEdgeContrast / 30) * 100));

    // 4. Evaluate against thresholds
    const isSharp = laplacianVariance >= CONFIG.THRESHOLDS.MIN_LAPLACIAN_VAR;
    const isLightingGood = overexposedPct <= CONFIG.THRESHOLDS.MAX_OVEREXPOSURE_PCT &&
                           underexposedPct <= CONFIG.THRESHOLDS.MAX_UNDEREXPOSURE_PCT;
    const isFramed = framingScore >= 45;

    const checks = {
      blur: {
        passed: isSharp,
        variance: Math.round(laplacianVariance),
        threshold: CONFIG.THRESHOLDS.MIN_LAPLACIAN_VAR,
        status: isSharp ? 'SHARP (PASSED)' : 'BLURRED (RETAKE RECOMMENDED)'
      },
      glare: {
        passed: overexposedPct <= CONFIG.THRESHOLDS.MAX_OVEREXPOSURE_PCT,
        percent: Math.round(overexposedPct * 10) / 10,
        threshold: CONFIG.THRESHOLDS.MAX_OVEREXPOSURE_PCT,
        status: overexposedPct <= CONFIG.THRESHOLDS.MAX_OVEREXPOSURE_PCT ? 'BALANCED' : 'HOTSPOT / GLARE DETECTED'
      },
      exposure: {
        passed: underexposedPct <= CONFIG.THRESHOLDS.MAX_UNDEREXPOSURE_PCT,
        percent: Math.round(underexposedPct * 10) / 10,
        threshold: CONFIG.THRESHOLDS.MAX_UNDEREXPOSURE_PCT,
        status: underexposedPct <= CONFIG.THRESHOLDS.MAX_UNDEREXPOSURE_PCT ? 'SUFFICIENT' : 'UNDEREXPOSED'
      },
      framing: {
        passed: isFramed,
        score: framingScore,
        status: isFramed ? 'ALIGNED' : 'REALIGN EDGES'
      }
    };

    const passedAll = isSharp && isLightingGood && isFramed;

    let retakePrompt = null;
    let guidanceAdvice = null;

    if (!passedAll) {
      if (!isSharp) {
        retakePrompt = 'CAPTURE MOTION BLUR DETECTED';
        guidanceAdvice = 'Stabilize device camera against the document boundary and hold steady.';
      } else if (overexposedPct > CONFIG.THRESHOLDS.MAX_OVEREXPOSURE_PCT) {
        retakePrompt = 'LIGHTING GLARE INTERFERENCE';
        guidanceAdvice = 'Tilt document away from overhead lamp to eliminate specular glare on MRZ.';
      } else if (underexposedPct > CONFIG.THRESHOLDS.MAX_UNDEREXPOSURE_PCT) {
        retakePrompt = 'LOW AMBIENT ILLUMINATION';
        guidanceAdvice = 'Increase checkpoint lighting or enable the device torch.';
      } else if (!isFramed) {
        retakePrompt = 'DOCUMENT OUTSIDE ALIGNMENT GUIDE';
        guidanceAdvice = 'Position all 4 corners of the document inside the tactical viewfinder brackets.';
      }
    }

    return {
      passed: passedAll,
      checks,
      retakePrompt,
      guidanceAdvice,
      laplacianVariance: Math.round(laplacianVariance),
      overexposedPct: Math.round(overexposedPct * 10) / 10,
      underexposedPct: Math.round(underexposedPct * 10) / 10,
      framingScore
    };
  }
}
