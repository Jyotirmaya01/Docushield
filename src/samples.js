/**
 * DocuShield Presets & Test Specimens for SIH Demonstration
 * Generic Schema Compliant: Passport, National ID, and Visa
 *
 * Explicitly maps to the System Architecture branches:
 * 1. Column C: Frequent-Crosser Fast Lane (Pre-approved ledger match)
 * 2. Column A: Full 7-Stage Pipeline (First-time valid passport)
 * 3. Column B: Direct Officer Review (Known prior flag in ledger)
 * 4. Column A -> B: Structural CNN Tamper Flag
 * 5. Non-MRZ Visa Screening: Field Consistency & Date Logic (MRZ Bypassed)
 * 6. A3a: Capture Quality Gate Retake Loop (Blur / extreme glare)
 */

export const SAMPLE_SPECIMENS = [
  {
    id: 'specimen-frequent-crosser',
    title: 'Specimen 1: Frequent Crosser (National ID)',
    subtitle: 'Ramesh Thapa · 14 Clean Crossings in Ledger',
    type: 'NATIONAL_ID',
    document_type: 'national_id',
    badge: 'COLUMN C: FAST LANE',
    badgeColor: 'primary',
    issueDate: '2023-01-10',
    visualFields: {
      fullName: 'RAMESH THAPA',
      documentNumber: 'NP-FC-991204',
      nationality: 'NPL',
      dateOfBirth: '1984-06-19',
      expiryDate: '2028-01-09',
      sex: 'M',
      documentType: 'national_id'
    },
    extra_fields: {
      address: 'Ward 4, Thamel, Kathmandu, Nepal',
      id_card_type: 'CITIZENSHIP_CARD',
      parent_or_guardian_name: 'Bir Bahadur Thapa'
    },
    mrzLines: [
      'P<NPLTHAPA<<RAMESH<<<<<<<<<<<<<<<<<<<<<<<<<<',
      'NP-FC-9912<2NPL8406193M2801095<<<<<<<<<<<<<<<4'
    ],
    photoUrl: 'https://images.unsplash.com/photo-1506794778202-cad84cf45f1d?w=300&auto=format&fit=crop&q=80',
    simulatedTamperScore: 0.04,
    simulatedFaceMatch: 97.2,
    hasAdversarialInjection: false,
    qualityResult: {
      passed: true,
      laplacianVariance: 172,
      overexposedPct: 1.8,
      underexposedPct: 6.2,
      framingScore: 98
    }
  },
  {
    id: 'specimen-genuine-ind',
    title: 'Specimen 2: First-Time Indian Passport',
    subtitle: 'Rahul Sharma · Clean 7-Stage Pipeline',
    type: 'PASSPORT',
    document_type: 'passport',
    badge: 'COLUMN A: FULL PIPELINE',
    badgeColor: 'secondary',
    issueDate: '2020-04-12',
    visualFields: {
      fullName: 'RAHUL SHARMA',
      documentNumber: 'Z3918204',
      nationality: 'IND',
      dateOfBirth: '1992-07-14',
      expiryDate: '2030-04-11',
      sex: 'M',
      documentType: 'passport'
    },
    extra_fields: {
      issuing_authority: 'RPO DELHI',
      place_of_birth: 'NEW DELHI',
      passport_type: 'REGULAR'
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
    id: 'specimen-prior-flagged',
    title: 'Specimen 3: Known Flagged Subject',
    subtitle: 'Vikram Singh · Prior Alert in Ledger',
    type: 'PASSPORT',
    document_type: 'passport',
    badge: 'COLUMN B: DIRECT OFFICER REVIEW',
    badgeColor: 'error',
    issueDate: '2022-09-15',
    visualFields: {
      fullName: 'VIKRAM SINGH',
      documentNumber: 'IND-FL-402911',
      nationality: 'IND',
      dateOfBirth: '1987-03-21',
      expiryDate: '2032-09-14',
      sex: 'M',
      documentType: 'passport'
    },
    extra_fields: {
      issuing_authority: 'RPO CHANDIGARH',
      place_of_birth: 'AMRITSAR',
      passport_type: 'REGULAR'
    },
    mrzLines: [
      'P<INDSINGH<<VIKRAM<<<<<<<<<<<<<<<<<<<<<<<<<<',
      'IND-FL-402<7IND8703212M3209141<<<<<<<<<<<<<<<9'
    ],
    photoUrl: 'https://images.unsplash.com/photo-1500648767791-00dcc994a43e?w=300&auto=format&fit=crop&q=80',
    simulatedTamperScore: 0.72,
    simulatedFaceMatch: 79.5,
    hasAdversarialInjection: false,
    qualityResult: {
      passed: true,
      laplacianVariance: 155,
      overexposedPct: 2.5,
      underexposedPct: 7.1,
      framingScore: 94
    }
  },
  {
    id: 'specimen-tampered-npl',
    title: 'Specimen 4: Tampered National ID',
    subtitle: 'Sunil Thapa · Photo Spliced & Format Mismatch',
    type: 'NATIONAL_ID',
    document_type: 'national_id',
    badge: 'A3d: CNN TAMPER DETECTED',
    badgeColor: 'tertiary',
    issueDate: '2021-08-10',
    visualFields: {
      fullName: 'SUNIL THAPA',
      documentNumber: 'NP882194',
      nationality: 'NPL',
      dateOfBirth: '1988-11-23',
      expiryDate: '2026-08-09',
      sex: 'M',
      documentType: 'national_id'
    },
    extra_fields: {
      address: 'Pokhara Ward 9, Kaski District, Nepal',
      id_card_type: 'NATIONAL_IDENTITY_CARD',
      parent_or_guardian_name: 'Narayan Thapa'
    },
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
    id: 'specimen-valid-visa',
    title: 'Specimen 5: Standard Entry Visa (Non-MRZ)',
    subtitle: 'Alexander Chen · Clean Visa, MRZ Skipped',
    type: 'VISA',
    document_type: 'visa',
    badge: 'NON-MRZ VISA PIPELINE',
    badgeColor: 'secondary',
    issueDate: '2023-01-15',
    visualFields: {
      fullName: 'ALEXANDER CHEN',
      documentNumber: 'V9942183',
      nationality: 'GBR',
      dateOfBirth: '1995-03-30',
      expiryDate: '2028-01-14',
      sex: 'M',
      documentType: 'visa'
    },
    extra_fields: {
      visa_type: 'TOURIST',
      linked_passport_number: 'GBR-8830192',
      sponsor_name: 'MINISTRY OF EXTERNAL AFFAIRS',
      number_of_entries_allowed: 'MULTIPLE',
      issuing_country: 'IND'
    },
    mrzLines: [], // Visa templates typically don't have MRZ zone -> triggers MRZ Skip!
    photoUrl: 'https://images.unsplash.com/photo-1534528741775-53994a69daeb?w=300&auto=format&fit=crop&q=80',
    simulatedTamperScore: 0.05,
    simulatedFaceMatch: 96.4,
    hasAdversarialInjection: false,
    qualityResult: {
      passed: true,
      laplacianVariance: 158,
      overexposedPct: 2.2,
      underexposedPct: 7.8,
      framingScore: 95
    }
  },
  {
    id: 'specimen-injection-visa',
    title: 'Specimen 6: Adversarial Injected Visa',
    subtitle: 'Alexander Chen · Prompt Injection in Margin',
    type: 'VISA',
    document_type: 'visa',
    badge: 'A3f: ADVERSARIAL INJECTION',
    badgeColor: 'tertiary',
    issueDate: '2023-01-15',
    visualFields: {
      fullName: 'ALEXANDER CHEN',
      documentNumber: 'V9942183-ADV',
      nationality: 'GBR',
      dateOfBirth: '1995-03-30',
      expiryDate: '2028-01-14',
      sex: 'M',
      documentType: 'visa'
    },
    extra_fields: {
      visa_type: 'BUSINESS',
      linked_passport_number: 'GBR-8830192',
      sponsor_name: 'TECH DYNAMICS GLOBAL',
      number_of_entries_allowed: 'SINGLE',
      issuing_country: 'IND'
    },
    mrzLines: [],
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
    id: 'specimen-blurry-glare',
    title: 'Specimen 7: Low Quality / Glare Scan',
    subtitle: 'Pooja Verma · Severe Glare & Motion Blur',
    type: 'PASSPORT',
    document_type: 'passport',
    badge: 'A3a: QUALITY GATE RETAKE LOOP',
    badgeColor: 'outline',
    issueDate: '2024-05-10',
    visualFields: {
      fullName: 'POOJA VERMA',
      documentNumber: 'K5549102',
      nationality: 'IND',
      dateOfBirth: '1998-12-05',
      expiryDate: '2034-05-09',
      sex: 'F',
      documentType: 'passport'
    },
    extra_fields: {
      issuing_authority: 'RPO MUMBAI',
      place_of_birth: 'MUMBAI',
      passport_type: 'REGULAR'
    },
    mrzLines: [
      'P<INDVERMA<<POOJA<<<<<<<<<<<<<<<<<<<<<<<<<<<',
      'K5549102<2IND9812051F3405094<<<<<<<<<<<<<<<1'
    ],
    photoUrl: 'https://images.unsplash.com/photo-1494790108377-be9c29b29330?w=300&auto=format&fit=crop&q=80',
    simulatedTamperScore: 0.12,
    simulatedFaceMatch: 88.0,
    hasAdversarialInjection: false,
    qualityResult: {
      passed: false,               // Triggers A3a retake loop
      laplacianVariance: 38,       // Blurry (<80)
      overexposedPct: 22.4,        // Heavy glare (>15%)
      underexposedPct: 4.1,
      framingScore: 62,
      failureReason: 'Extreme surface glare & camera motion blur detected.'
    }
  }
];
