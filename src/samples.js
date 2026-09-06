/**
 * DocuShield Presets & Test Specimens for SIH Demonstration
 * Provides genuine and tampered scenarios for instant 1-click evaluation.
 */

export const SAMPLE_SPECIMENS = [
  {
    id: 'specimen-genuine-ind',
    title: 'Specimen 1: Genuine Indian Passport',
    subtitle: 'Rahul Sharma · Clean Verification Flow',
    type: 'PASSPORT',
    badge: 'EXPECT: AUTO-APPROVE',
    badgeColor: 'secondary',
    issueDate: '2020-04-12',
    visualFields: {
      fullName: 'RAHUL SHARMA',
      documentNumber: 'Z3918204',
      nationality: 'IND',
      dateOfBirth: '1992-07-14',
      expiryDate: '2030-04-11',
      sex: 'M',
      documentType: 'PASSPORT'
    },
    mrzLines: [
      'P<INDSHARMA<<RAHUL<<<<<<<<<<<<<<<<<<<<<<<<<<',
      'Z3918204<8IND9207145M3004113<<<<<<<<<<<<<<<8'
    ],
    photoUrl: 'https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?w=300&auto=format&fit=crop&q=80',
    simulatedTamperScore: 0.06,
    simulatedFaceMatch: 98.4,
    hasAdversarialInjection: false,
    qualityResult: {
      passed: true,
      laplacianVariance: 165,
      overexposedPct: 2.1,
      underexposedPct: 8.4,
      framingScore: 96
    }
  },
  {
    id: 'specimen-tampered-npl',
    title: 'Specimen 2: Tampered Border Permit',
    subtitle: 'Sunil Thapa · Photo Spliced & MRZ Mismatch',
    type: 'TRAVEL_PERMIT',
    badge: 'EXPECT: FLAGGED (TAMPER)',
    badgeColor: 'tertiary',
    issueDate: '2021-08-10',
    visualFields: {
      fullName: 'SUNIL THAPA',
      documentNumber: 'NP882194',
      nationality: 'NPL',
      dateOfBirth: '1988-11-23',
      expiryDate: '2026-08-09',
      sex: 'M',
      documentType: 'TRAVEL_DOC'
    },
    // Intentionally altered check digits and mismatched document number
    mrzLines: [
      'P<NPLTHAPA<<SUNIL<<<<<<<<<<<<<<<<<<<<<<<<<<<',
      'NP882194<9NPL8811234M2608092<<<<<<<<<<<<<<<7'
    ],
    photoUrl: 'https://images.unsplash.com/photo-1500648767791-00dcc994a43e?w=300&auto=format&fit=crop&q=80',
    simulatedTamperScore: 0.84, // high CNN tamper probability
    simulatedFaceMatch: 64.2,   // low face similarity
    hasAdversarialInjection: false,
    qualityResult: {
      passed: true,
      laplacianVariance: 142,
      overexposedPct: 4.8,
      underexposedPct: 12.0,
      framingScore: 91
    }
  },
  {
    id: 'specimen-injection-visa',
    title: 'Specimen 3: Adversarial Injected Visa',
    subtitle: 'Prompt Injection / Hidden Margin Text',
    type: 'VISA',
    badge: 'EXPECT: FLAGGED (INJECTION)',
    badgeColor: 'tertiary',
    issueDate: '2023-01-15',
    visualFields: {
      fullName: 'ALEXANDER CHEN',
      documentNumber: 'V9942183',
      nationality: 'GBR',
      dateOfBirth: '1995-03-30',
      expiryDate: '2028-01-14',
      sex: 'M',
      documentType: 'VISA'
    },
    mrzLines: [
      'P<GBRCHEN<<ALEXANDER<<<<<<<<<<<<<<<<<<<<<<<<',
      'V9942183<4GBR9503308M2801147<<<<<<<<<<<<<<<8'
    ],
    photoUrl: 'https://images.unsplash.com/photo-1534528741775-53994a69daeb?w=300&auto=format&fit=crop&q=80',
    simulatedTamperScore: 0.22,
    simulatedFaceMatch: 92.1,
    hasAdversarialInjection: true, // triggers injection defense
    qualityResult: {
      passed: true,
      laplacianVariance: 138,
      overexposedPct: 3.5,
      underexposedPct: 10.2,
      framingScore: 89
    }
  },
  {
    id: 'specimen-date-anomaly',
    title: 'Specimen 4: Chronological Date Anomaly',
    subtitle: 'Pooja Verma · Expiry Precedes Issue Date',
    type: 'PASSPORT',
    badge: 'EXPECT: FLAGGED (DATE LOGIC)',
    badgeColor: 'tertiary',
    issueDate: '2024-05-10',
    visualFields: {
      fullName: 'POOJA VERMA',
      documentNumber: 'K5549102',
      nationality: 'IND',
      dateOfBirth: '1998-12-05',
      expiryDate: '2023-05-09', // Chronological impossibility!
      sex: 'F',
      documentType: 'PASSPORT'
    },
    mrzLines: [
      'P<INDVERMA<<POOJA<<<<<<<<<<<<<<<<<<<<<<<<<<<',
      'K5549102<2IND9812051F2305094<<<<<<<<<<<<<<<1'
    ],
    photoUrl: 'https://images.unsplash.com/photo-1494790108377-be9c29b29330?w=300&auto=format&fit=crop&q=80',
    simulatedTamperScore: 0.18,
    simulatedFaceMatch: 95.0,
    hasAdversarialInjection: false,
    qualityResult: {
      passed: true,
      laplacianVariance: 150,
      overexposedPct: 3.0,
      underexposedPct: 9.1,
      framingScore: 94
    }
  }
];
