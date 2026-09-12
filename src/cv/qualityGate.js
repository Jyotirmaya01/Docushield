/**
 * DocuShield Computer Vision Capture & Quality Gate
 * Implements:
 * 1. OpenCV.js Laplacian Variance Blur Detection (cv.Laplacian + cv.meanStdDev)
 * 2. Grayscale Luminance Histogram Glare & Underexposure Analysis (cv.calcHist / luminance)
 * 3. Document Framing & Corner Alignment Check
 *
 * Core Ethical Rule: Gating failures trigger a friendly non-punitive retake prompt,
 * NEVER rejecting the document itself.
 */

import { CONFIG } from '../config.js';

export class QualityGate {
  /**
   * Check if OpenCV.js runtime is ready and compiled in window
   * @returns {boolean}
   */
  static isOpenCVReady() {
    return typeof window !== 'undefined' &&
           typeof window.cv !== 'undefined' &&
           typeof window.cv.Mat === 'function';
  }

  /**
   * Computes Laplacian variance using OpenCV.js (cv.Laplacian + cv.meanStdDev)
   * Kernel: 3x3 discrete Laplacian operator (ksize=1 -> aperture 3x3)
   * @param {HTMLCanvasElement|ImageData} source
   * @returns {number|null} Variance of Laplacian or null if cv not available
   */
  static computeLaplacianVarianceCV(source) {
    if (!QualityGate.isOpenCVReady()) return null;

    let src = null;
    let gray = null;
    let lap = null;
    let mean = null;
    let stddev = null;

    try {
      if (source instanceof HTMLCanvasElement) {
        src = window.cv.imread(source);
      } else if (source instanceof ImageData) {
        src = window.cv.matFromImageData(source);
      } else {
        return null;
      }

      gray = new window.cv.Mat();
      window.cv.cvtColor(src, gray, window.cv.COLOR_RGBA2GRAY, 0);

      lap = new window.cv.Mat();
      // cv.Laplacian with CV_64F to preserve signed derivatives and prevent overflow
      window.cv.Laplacian(gray, lap, window.cv.CV_64F, 1, 1, 0, window.cv.BORDER_DEFAULT);

      mean = new window.cv.Mat();
      stddev = new window.cv.Mat();
      window.cv.meanStdDev(lap, mean, stddev);

      // Variance is square of standard deviation
      const sigma = stddev.doubleAt(0, 0);
      const variance = sigma * sigma;

      return variance;
    } catch (err) {
      console.warn('[QualityGate] OpenCV.js blur calculation error, using fallback:', err);
      return null;
    } finally {
      if (src) src.delete();
      if (gray) gray.delete();
      if (lap) lap.delete();
      if (mean) mean.delete();
      if (stddev) stddev.delete();
    }
  }

  /**
   * Computes glare and underexposure percentages via OpenCV.js histogram
   * @param {HTMLCanvasElement|ImageData} source
   * @returns {{overexposedPct: number, underexposedPct: number}|null}
   */
  static computeHistogramCV(source) {
    if (!QualityGate.isOpenCVReady()) return null;

    let src = null;
    let gray = null;
    let hist = null;
    let matVec = null;
    let mask = null;

    try {
      if (source instanceof HTMLCanvasElement) {
        src = window.cv.imread(source);
      } else if (source instanceof ImageData) {
        src = window.cv.matFromImageData(source);
      } else {
        return null;
      }

      gray = new window.cv.Mat();
      window.cv.cvtColor(src, gray, window.cv.COLOR_RGBA2GRAY, 0);

      hist = new window.cv.Mat();
      mask = new window.cv.Mat();
      matVec = new window.cv.MatVector();
      matVec.push_back(gray);

      // cv.calcHist(images, channels, mask, hist, histSize, ranges)
      window.cv.calcHist(matVec, [0], mask, hist, [256], [0, 256]);

      const totalPixels = gray.rows * gray.cols;
      let overexposedCount = 0;
      let underexposedCount = 0;

      for (let i = 0; i <= 32; i++) {
        underexposedCount += hist.data32F[i];
      }
      for (let i = 246; i < 256; i++) {
        overexposedCount += hist.data32F[i];
      }

      return {
        overexposedPct: (overexposedCount / totalPixels) * 100,
        underexposedPct: (underexposedCount / totalPixels) * 100
      };
    } catch (err) {
      console.warn('[QualityGate] OpenCV.js histogram calculation error, using fallback:', err);
      return null;
    } finally {
      if (src) src.delete();
      if (gray) gray.delete();
      if (hist) hist.delete();
      if (mask) mask.delete();
      if (matVec) matVec.delete();
    }
  }

  /**
   * Analyzes an ImageData or HTMLCanvasElement for blur, glare, and framing
   * @param {HTMLCanvasElement|ImageData} source 
   * @returns {Object} Quality gate diagnostic results
   */
  static analyzeImageQuality(source) {
    let imageData;
    if (typeof HTMLCanvasElement !== 'undefined' && source instanceof HTMLCanvasElement) {
      const ctx = source.getContext('2d');
      imageData = ctx.getImageData(0, 0, source.width, source.height);
    } else if ((typeof ImageData !== 'undefined' && source instanceof ImageData) || (source && typeof source.width === 'number' && typeof source.height === 'number' && source.data)) {
      imageData = source;
    } else {
      throw new Error('Invalid image source for quality analysis');
    }

    const { width, height, data } = imageData;
    const totalPixels = width * height;

    let engine = 'pure-js';
    let laplacianVariance = null;
    let overexposedPct = null;
    let underexposedPct = null;

    // ── 1. Try OpenCV.js WebAssembly Engine ──
    const cvVariance = QualityGate.computeLaplacianVarianceCV(source);
    const cvHist = QualityGate.computeHistogramCV(source);

    if (cvVariance !== null && cvHist !== null) {
      engine = 'opencv.js';
      laplacianVariance = cvVariance;
      overexposedPct = cvHist.overexposedPct;
      underexposedPct = cvHist.underexposedPct;
    }

    // ── 2. Fallback: Fast Typed-Array Pure JS Processing ──
    const grayscale = new Uint8ClampedArray(totalPixels);
    const histogram = new Uint32Array(256);
    let jsOverexposedCount = 0;
    let jsUnderexposedCount = 0;

    for (let i = 0; i < totalPixels; i++) {
      const r = data[i * 4];
      const g = data[i * 4 + 1];
      const b = data[i * 4 + 2];
      // Standard ITU-R BT.601 luminance formula
      const lum = Math.round(0.299 * r + 0.587 * g + 0.114 * b);
      grayscale[i] = lum;
      histogram[lum]++;

      if (lum >= 246) jsOverexposedCount++;
      if (lum <= 32) jsUnderexposedCount++;
    }

    if (overexposedPct === null) {
      overexposedPct = (jsOverexposedCount / totalPixels) * 100;
      underexposedPct = (jsUnderexposedCount / totalPixels) * 100;
    }

    if (laplacianVariance === null) {
      // Discrete 3x3 Laplacian Kernel: [0, 1, 0; 1, -4, 1; 0, 1, 0]
      let lapSum = 0;
      let lapSqSum = 0;
      let sampleCount = 0;

      // Sample step for real-time mobile/laptop performance
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
      laplacianVariance = sampleCount > 0 ? (lapSqSum / sampleCount) - (mean * mean) : 0;
    }

    // ── 3. Document Framing & Alignment Estimation ──
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

    // ── 3b. Detail & Text Visibility Check (High-frequency text edge gradient) ──
    // Check interior document zone (20% to 80% height, 15% to 85% width)
    const innerYStart = Math.round(height * 0.20);
    const innerYEnd = Math.round(height * 0.80);
    const innerXStart = Math.round(width * 0.15);
    const innerXEnd = Math.round(width * 0.85);

    let textEdgePixels = 0;
    let interiorSampleCount = 0;
    let minInnerLum = 255;
    let maxInnerLum = 0;

    for (let y = innerYStart; y < innerYEnd; y += 2) {
      const rowOffset = y * width;
      for (let x = innerXStart; x < innerXEnd; x += 2) {
        interiorSampleCount++;
        const lum = grayscale[rowOffset + x];
        if (lum < minInnerLum) minInnerLum = lum;
        if (lum > maxInnerLum) maxInnerLum = lum;

        const nextLum = grayscale[rowOffset + x + 1];
        if (Math.abs(lum - nextLum) > 20) {
          textEdgePixels++;
        }
      }
    }

    const detailDensityPct = interiorSampleCount > 0 ? (textEdgePixels / interiorSampleCount) * 100 : 0;
    const innerContrastRange = maxInnerLum - minInnerLum;

    // A document is detected if boundary contrast or text edge density is present
    const isDocumentDetected = (framingScore >= 35 || detailDensityPct >= 1.5) && innerContrastRange >= 50;

    // ── 4. Evaluate against Operational Thresholds ──
    const isSharp = laplacianVariance >= CONFIG.THRESHOLDS.MIN_LAPLACIAN_VAR;
    const isLightingGood = overexposedPct <= CONFIG.THRESHOLDS.MAX_OVEREXPOSURE_PCT &&
                           underexposedPct <= CONFIG.THRESHOLDS.MAX_UNDEREXPOSURE_PCT;
    const isFramed = framingScore >= 45;

    // Details are properly visible when sharp, legible text edge transitions exist, and illumination is balanced
    const hasDetailsVisible = isSharp && isLightingGood && detailDensityPct >= 1.8;

    const checks = {
      blur: {
        passed: isSharp,
        variance: Math.round(laplacianVariance),
        threshold: CONFIG.THRESHOLDS.MIN_LAPLACIAN_VAR,
        status: isSharp ? 'SHARP (PASSED)' : 'BLURRED (RETAKE RECOMMENDED)',
        engine
      },
      glare: {
        passed: overexposedPct <= CONFIG.THRESHOLDS.MAX_OVEREXPOSURE_PCT,
        percent: Math.round(overexposedPct * 10) / 10,
        threshold: CONFIG.THRESHOLDS.MAX_OVEREXPOSURE_PCT,
        status: overexposedPct <= CONFIG.THRESHOLDS.MAX_OVEREXPOSURE_PCT ? 'BALANCED' : 'HOTSPOT / GLARE DETECTED',
        engine
      },
      exposure: {
        passed: underexposedPct <= CONFIG.THRESHOLDS.MAX_UNDEREXPOSURE_PCT,
        percent: Math.round(underexposedPct * 10) / 10,
        threshold: CONFIG.THRESHOLDS.MAX_UNDEREXPOSURE_PCT,
        status: underexposedPct <= CONFIG.THRESHOLDS.MAX_UNDEREXPOSURE_PCT ? 'SUFFICIENT' : 'UNDEREXPOSED',
        engine
      },
      framing: {
        passed: isFramed,
        score: framingScore,
        status: isFramed ? 'ALIGNED' : 'REALIGN EDGES'
      },
      details: {
        passed: hasDetailsVisible,
        density: Math.round(detailDensityPct * 10) / 10,
        status: hasDetailsVisible ? 'LEGIBLE (PASSED)' : (detailDensityPct >= 1.8 ? 'BLURRED (HOLD STEADY)' : 'NO DETAILS DETECTED')
      },
      documentPresence: {
        detected: isDocumentDetected,
        status: isDocumentDetected ? 'DOCUMENT IN FRAME' : 'NO DOCUMENT'
      }
    };

    const passedAll = isSharp && isLightingGood && isFramed;
    const readyForAutoCapture = passedAll && isDocumentDetected && hasDetailsVisible;

    let retakePrompt = null;
    let guidanceAdvice = null;

    if (!passedAll) {
      if (!isSharp) {
        retakePrompt = 'CAPTURE MOTION BLUR DETECTED';
        guidanceAdvice = `Image Laplacian variance (${Math.round(laplacianVariance)}) is below minimum sharpness threshold (${CONFIG.THRESHOLDS.MIN_LAPLACIAN_VAR}). Stabilize device camera and hold steady.`;
      } else if (overexposedPct > CONFIG.THRESHOLDS.MAX_OVEREXPOSURE_PCT) {
        retakePrompt = 'LIGHTING GLARE INTERFERENCE';
        guidanceAdvice = `Surface specular glare (${Math.round(overexposedPct * 10) / 10}%) exceeds threshold (${CONFIG.THRESHOLDS.MAX_OVEREXPOSURE_PCT}%). Tilt document away from overhead illumination.`;
      } else if (underexposedPct > CONFIG.THRESHOLDS.MAX_UNDEREXPOSURE_PCT) {
        retakePrompt = 'LOW AMBIENT ILLUMINATION';
        guidanceAdvice = `Underexposed shadows (${Math.round(underexposedPct * 10) / 10}%) exceed threshold. Increase checkpoint lighting or enable device torch.`;
      } else if (!isFramed) {
        retakePrompt = 'DOCUMENT OUTSIDE ALIGNMENT GUIDE';
        guidanceAdvice = 'Position all 4 corners of the document inside the tactical viewfinder brackets.';
      }
    }

    return {
      passed: passedAll,
      engine,
      checks,
      retakePrompt,
      guidanceAdvice,
      laplacianVariance: Math.round(laplacianVariance),
      overexposedPct: Math.round(overexposedPct * 10) / 10,
      underexposedPct: Math.round(underexposedPct * 10) / 10,
      framingScore,
      detailDensityPct: Math.round(detailDensityPct * 10) / 10,
      hasDocument: isDocumentDetected,
      detailsVisible: hasDetailsVisible,
      readyForAutoCapture
    };
  }
}

